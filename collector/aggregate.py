#!/usr/bin/env python3
"""Turn the raw JSONL/CSV snapshots into docs/data.json for the static
dashboard. Pure stdlib -- no pandas, so it runs fast in CI with no deps.

Field extraction is defensive: Kalshi's KXBTC15M payload uses dollar-string
prices (yes_bid_dollars: "0.5300") and *_fp volume fields, but older/cent
integer names (yes_bid, volume) are kept as fallbacks. Raw payloads are
stored verbatim by collect.py, and this script is the only place that
interprets them.
"""
from __future__ import annotations

import csv
import glob
import json
import math
import os
import statistics
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(REPO_ROOT, "data", "raw")
OUT_PATH = os.path.join(REPO_ROOT, "docs", "data.json")

MAX_CHART_POINTS = 288  # ~24h at 5-minute cadence
MAX_RECENT_MARKETS = 60
MAX_INSIGHT_MARKETS = 400
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


def _pct_field(m: dict, dollar_key: str, cent_key: str) -> float | None:
    """Kalshi returns prices as dollar-strings like "0.5300" (0-1) on most
    markets, but some endpoints/eras use cent integers (0-100) instead --
    try the dollar field first and scale it, then fall back to cents as-is.
    """
    dollars = _num(_first(m, dollar_key))
    if dollars is not None:
        return dollars * 100
    return _num(_first(m, cent_key))


def yes_prob(m: dict) -> float | None:
    bid = _pct_field(m, "yes_bid_dollars", "yes_bid")
    ask = _pct_field(m, "yes_ask_dollars", "yes_ask")
    if bid is not None and ask is not None:
        return (bid + ask) / 2
    last = _pct_field(m, "last_price_dollars", "last_price")
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


def is_live_status(status) -> bool:
    return (status or "").lower() in ("active", "open")


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
        last = samples[-1]
        open_ts = _parse_ts(_first(last, "open_time"))
        close_ts = _parse_ts(_first(last, "close_time"))

        strike = None
        for m in samples:
            strike = strike_of(m)
            if strike is not None:
                break

        # Only quotes taken while the market was live are meaningful --
        # settled markets quote 0/100 junk, which would pollute ranges.
        window: list[tuple[float, float]] = []
        for m in samples:
            t = _parse_ts(m.get("_ts"))
            p = yes_prob(m)
            if t is None or p is None:
                continue
            if open_ts is not None and close_ts is not None and not (open_ts <= t < close_ts):
                continue
            window.append((t, p))

        prob_timeline = []
        if open_ts is not None:
            prob_timeline = [
                [round((t - open_ts) / 60, 1), round(p, 1)] for t, p in window
            ]

        volumes = [_num(_first(m, "volume_fp", "volume")) for m in samples]
        volumes = [v for v in volumes if v is not None]

        # time-weighted seconds leaning yes(>=50) vs no(<50)
        yes_secs = 0.0
        no_secs = 0.0
        for i in range(len(window) - 1):
            t0, p0 = window[i]
            t1, _ = window[i + 1]
            dt = min(max(t1 - t0, 0), GAP_CAP_SECONDS)
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
            "yes_prob_first": round(window[0][1], 1) if window else None,
            "yes_prob_last": round(window[-1][1], 1) if window else None,
            "yes_prob_min": round(min(p for _, p in window), 1) if window else None,
            "yes_prob_max": round(max(p for _, p in window), 1) if window else None,
            "yes_bid_pct": _pct_field(last, "yes_bid_dollars", "yes_bid"),
            "yes_ask_pct": _pct_field(last, "yes_ask_dollars", "yes_ask"),
            "no_bid_pct": _pct_field(last, "no_bid_dollars", "no_bid"),
            "no_ask_pct": _pct_field(last, "no_ask_dollars", "no_ask"),
            "volume_max": max(volumes) if volumes else None,
            "open_interest": _num(_first(last, "open_interest_fp", "open_interest")),
            "sample_count": len(samples),
            "prob_timeline": prob_timeline,
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


def build_series(snapshots, btc_series):
    """Per-collector-run time series: BTC price, active market's strike,
    yes bid, no bid, and mid probability, all aligned on run timestamps."""
    price_map = {t: p for t, p in btc_series}
    vol_map = {t: v for t, v in rolling_volatility(btc_series)}

    # For each run timestamp, the snapshot of the market live at that moment.
    active_by_ts: dict[float, dict] = {}
    for s in snapshots:
        if not is_live_status(s.get("status")):
            continue
        t = _parse_ts(s.get("_ts"))
        if t is None:
            continue
        o, c = _parse_ts(s.get("open_time")), _parse_ts(s.get("close_time"))
        if o is not None and c is not None and o <= t < c:
            active_by_ts[t] = s
        else:
            active_by_ts.setdefault(t, s)

    all_ts = sorted(set(price_map) | set(active_by_ts))[-MAX_CHART_POINTS:]

    def rnd(v, digits=1):
        return round(v, digits) if v is not None else None

    series = {
        "timestamps": [],
        "btc_usd": [],
        "strike_usd": [],
        "yes_bid_pct": [],
        "no_bid_pct": [],
        "yes_prob_pct": [],
        "volatility_pct": [],
    }
    for t in all_ts:
        snap = active_by_ts.get(t)
        series["timestamps"].append(
            datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        series["btc_usd"].append(price_map.get(t))
        series["strike_usd"].append(rnd(_num(strike_of(snap)) if snap else None, 2))
        series["yes_bid_pct"].append(
            rnd(_pct_field(snap, "yes_bid_dollars", "yes_bid") if snap else None)
        )
        series["no_bid_pct"].append(
            rnd(_pct_field(snap, "no_bid_dollars", "no_bid") if snap else None)
        )
        series["yes_prob_pct"].append(rnd(yes_prob(snap) if snap else None))
        series["volatility_pct"].append(
            round(vol_map[t], 4) if vol_map.get(t) is not None else None
        )
    return series


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    snapshots = load_snapshots()
    btc_series = load_btc_price_series()
    market_records = build_market_records(snapshots)

    now = datetime.now(timezone.utc).timestamp()

    # --- current market: live status, prefer one still open now ---
    live = [
        r for r in market_records.values()
        if is_live_status(r.get("status")) and _parse_ts(r.get("close_time"))
    ]
    live.sort(key=lambda r: _parse_ts(r["close_time"]))
    still_open = [r for r in live if _parse_ts(r["close_time"]) > now - 60]
    current = still_open[0] if still_open else (live[-1] if live else None)

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

    # --- settled markets ---
    settled = [
        r for r in market_records.values()
        if r.get("result") in ("yes", "no")
    ]
    settled.sort(key=lambda r: _parse_ts(r.get("close_time")) or 0, reverse=True)
    recent_markets = settled[:MAX_RECENT_MARKETS]

    # Slim per-market records for the Insights tab (more history, fewer fields).
    insight_markets = [
        {
            "close_time": r["close_time"],
            "result": r["result"],
            "volume": r["volume_max"],
            "timeline": r["prob_timeline"],
        }
        for r in settled[:MAX_INSIGHT_MARKETS]
    ]

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

    out = {
        "generated_at": iso(now),
        "series_ticker": "KXBTC15M",
        "current": current_block,
        "summary": summary,
        "recent_markets": recent_markets,
        "insight_markets": insight_markets,
        "series": build_series(snapshots, btc_series),
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2)
    print(
        f"Wrote {OUT_PATH}: {len(market_records)} markets, "
        f"{len(out['series']['timestamps'])} series points, "
        f"{len(insight_markets)} insight markets"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
