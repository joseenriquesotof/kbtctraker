#!/usr/bin/env python3
"""Turn the raw JSONL/CSV snapshots into docs/data.json for the static
dashboard. Pure stdlib -- no pandas, so it runs fast in CI with no deps.

Field extraction is defensive: Kalshi's exact field names for the 15-minute
BTC market are read from whatever the API actually returned (multiple
candidate keys are tried), since the raw payload is stored verbatim by
collect.py and this script is the only place that interprets it.
"""
from __future__ import annotations

import csv
import glob
import json
import os
import statistics
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(REPO_ROOT, "data", "raw")
OUT_PATH = os.path.join(REPO_ROOT, "docs", "data.json")

MAX_CHART_POINTS = 288  # ~24h at 5-minute cadence
MAX_RECENT_MARKETS = 60
GAP_CAP_SECONDS = 900  # cap time-weighting for any single sample gap


def _first(d: dict, *keys, default=None):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_ts(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def load_snapshots() -> list[dict]:
    rows = []
    for path in sorted(glob.glob(os.path.join(RAW_DIR, "snapshots-*.jsonl"))):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return rows


def load_btc_price_series() -> list[tuple[float, float]]:
    path = os.path.join(RAW_DIR, "btc_price.csv")
    out = []
    if not os.path.exists(path):
        return out
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            t = _parse_ts(row.get("ts_utc"))
            p = _num(row.get("btc_usd"))
            if t is not None and p is not None:
                out.append((t, p))
    out.sort(key=lambda x: x[0])
    return out


def yes_prob(m: dict) -> float | None:
    bid = _num(_first(m, "yes_bid"))
    ask = _num(_first(m, "yes_ask"))
    if bid is not None and ask is not None:
        return (bid + ask) / 2
    last = _num(_first(m, "last_price"))
    if last is not None:
        return last
    if bid is not None:
        return bid
    if ask is not None:
        return ask
    return None


def strike_of(m: dict):
    return _first(m, "floor_strike", "cap_strike", "strike_price")


def result_of(m: dict) -> str:
    r = (_first(m, "result", default="") or "").strip().lower()
    return r  # "yes", "no", or ""


def build_market_records(snapshots: list[dict]) -> dict[str, dict]:
    by_ticker: dict[str, list[dict]] = {}
    for s in snapshots:
        ticker = s.get("ticker")
        if not ticker:
            continue
        by_ticker.setdefault(ticker, []).append(s)

    records = {}
    for ticker, samples in by_ticker.items():
        samples.sort(key=lambda m: m.get("_ts", ""))
        probs = [(m.get("_ts"), yes_prob(m)) for m in samples]
        probs = [(t, p) for t, p in probs if p is not None]

        volumes = [_num(_first(m, "volume")) for m in samples]
        volumes = [v for v in volumes if v is not None]

        last = samples[-1]
        strike = None
        for m in samples:
            strike = strike_of(m)
            if strike is not None:
                break

        # time-weighted seconds leaning yes(>=50) vs no(<50)
        yes_secs = 0.0
        no_secs = 0.0
        for i in range(len(probs) - 1):
            t0, p0 = probs[i]
            t1, _ = probs[i + 1]
            e0, e1 = _parse_ts(t0), _parse_ts(t1)
            if e0 is None or e1 is None:
                continue
            dt = min(max(e1 - e0, 0), GAP_CAP_SECONDS)
            if p0 >= 50:
                yes_secs += dt
            else:
                no_secs += dt

        records[ticker] = {
            "ticker": ticker,
            "event_ticker": last.get("event_ticker"),
            "title": _first(last, "title", "subtitle", "yes_sub_title"),
            "strike": _num(strike),
            "open_time": _first(last, "open_time"),
            "close_time": _first(last, "close_time"),
            "status": _first(last, "status"),
            "result": result_of(last),
            "first_seen_ts": samples[0].get("_ts"),
            "last_seen_ts": last.get("_ts"),
            "yes_prob_first": probs[0][1] if probs else None,
            "yes_prob_last": probs[-1][1] if probs else None,
            "yes_prob_min": min(p for _, p in probs) if probs else None,
            "yes_prob_max": max(p for _, p in probs) if probs else None,
            "volume_max": max(volumes) if volumes else None,
            "open_interest": _num(_first(last, "open_interest")),
            "sample_count": len(samples),
            "yes_leaning_seconds": yes_secs,
            "no_leaning_seconds": no_secs,
        }
    return records


def rolling_volatility(btc_series: list[tuple[float, float]], window: int = 12):
    """Rolling stdev of log returns (%) over the trailing `window` samples."""
    out = []
    returns = []
    prev_price = None
    for t, p in btc_series:
        if prev_price and prev_price > 0 and p > 0:
            import math

            returns.append(math.log(p / prev_price))
        else:
            returns.append(None)
        prev_price = p
        window_rets = [r for r in returns[-window:] if r is not None]
        if len(window_rets) >= 3:
            out.append((t, statistics.pstdev(window_rets) * 100))
        else:
            out.append((t, None))
    return out


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    snapshots = load_snapshots()
    btc_series = load_btc_price_series()
    market_records = build_market_records(snapshots)

    now = datetime.now(timezone.utc).timestamp()

    # --- current market (open, closest close_time in the future) ---
    open_candidates = [
        r for r in market_records.values()
        if (r.get("status") or "").lower() == "open" and _parse_ts(r.get("close_time"))
    ]
    open_candidates.sort(key=lambda r: _parse_ts(r["close_time"]))
    current = open_candidates[0] if open_candidates else None

    current_btc = btc_series[-1][1] if btc_series else None
    current_block = None
    if current:
        strike = current.get("strike")
        dist_pct = None
        if strike and current_btc:
            dist_pct = (current_btc - strike) / strike * 100
        close_ts = _parse_ts(current.get("close_time"))
        seconds_remaining = max(0, int(close_ts - now)) if close_ts else None
        current_block = {
            **current,
            "btc_spot_usd": current_btc,
            "distance_to_strike_pct": dist_pct,
            "seconds_remaining": seconds_remaining,
        }

    # --- recent settled markets table ---
    settled = [
        r for r in market_records.values()
        if r.get("result") in ("yes", "no")
    ]
    settled.sort(key=lambda r: _parse_ts(r.get("close_time")) or 0, reverse=True)
    recent_markets = settled[:MAX_RECENT_MARKETS]

    # --- win-rate / streak stats ---
    chrono = sorted(settled, key=lambda r: _parse_ts(r.get("close_time")) or 0)
    up = sum(1 for r in chrono if r["result"] == "yes")
    down = sum(1 for r in chrono if r["result"] == "no")
    longest_streak = {"result": None, "length": 0}
    cur_streak = {"result": None, "length": 0}
    for r in chrono:
        if r["result"] == cur_streak["result"]:
            cur_streak["length"] += 1
        else:
            cur_streak = {"result": r["result"], "length": 1}
        if cur_streak["length"] > longest_streak["length"]:
            longest_streak = dict(cur_streak)
    current_streak = cur_streak

    total_yes_secs = sum(r["yes_leaning_seconds"] for r in settled)
    total_no_secs = sum(r["no_leaning_seconds"] for r in settled)
    total_secs = total_yes_secs + total_no_secs

    volumes = [r["volume_max"] for r in settled if r["volume_max"] is not None]

    summary = {
        "total_markets_tracked": len(market_records),
        "settled_count": len(settled),
        "up_wins": up,
        "down_wins": down,
        "up_win_rate_pct": (up / (up + down) * 100) if (up + down) else None,
        "avg_volume": (sum(volumes) / len(volumes)) if volumes else None,
        "longest_streak": longest_streak,
        "current_streak": current_streak,
        "pct_time_yes_leaning": (total_yes_secs / total_secs * 100) if total_secs else None,
        "pct_time_no_leaning": (total_no_secs / total_secs * 100) if total_secs else None,
    }

    # --- chart series (last MAX_CHART_POINTS btc price samples) ---
    btc_tail = btc_series[-MAX_CHART_POINTS:]
    vol_series = rolling_volatility(btc_series)[-MAX_CHART_POINTS:]

    # strike + yes_prob step-series: for each btc sample time, find the
    # market whose [open_time, close_time) window contains it.
    windows = [
        r for r in market_records.values()
        if _parse_ts(r.get("open_time")) and _parse_ts(r.get("close_time"))
    ]
    windows.sort(key=lambda r: _parse_ts(r["open_time"]))

    def market_at(t: float):
        for r in windows:
            o, c = _parse_ts(r["open_time"]), _parse_ts(r["close_time"])
            if o <= t < c:
                return r
        return None

    strike_series = []
    yes_prob_series = []
    for t, _ in btc_tail:
        m = market_at(t)
        strike_series.append((t, m.get("strike") if m else None))
        yes_prob_series.append((t, m.get("yes_prob_last") if m else None))

    series = {
        "timestamps": [iso(t) for t, _ in btc_tail],
        "btc_usd": [p for _, p in btc_tail],
        "strike_usd": [s for _, s in strike_series],
        "yes_prob_pct": [p for _, p in yes_prob_series],
        "volatility_pct": [v for _, v in vol_series],
    }

    out = {
        "generated_at": iso(now),
        "series_ticker": "KXBTC15M",
        "current": current_block,
        "summary": summary,
        "recent_markets": recent_markets,
        "series": series,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {OUT_PATH}: {len(market_records)} markets, {len(btc_tail)} price points")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
