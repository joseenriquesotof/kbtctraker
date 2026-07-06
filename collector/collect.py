#!/usr/bin/env python3
"""Poll Kalshi's KXBTC15M (BTC 15-minute up/down) market and CoinGecko's BTC
spot price, then append a raw snapshot to a monthly JSONL file.

Designed to run every few minutes from a scheduler (GitHub Actions cron).
Every market object returned by Kalshi is stored verbatim (plus a couple of
injected fields) so nothing is lost even if a field name changes upstream --
`aggregate.py` is the only place that has to know the current schema.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from kalshi_client import fetch_markets, fetch_btc_spot_usd  # noqa: E402

SERIES_TICKER = "KXBTC15M"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(REPO_ROOT, "data", "raw")


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot_path(ts: datetime) -> str:
    return os.path.join(RAW_DIR, f"snapshots-{ts.strftime('%Y-%m')}.jsonl")


def btc_price_path() -> str:
    return os.path.join(RAW_DIR, "btc_price.csv")


def collection_log_path(ts: datetime) -> str:
    return os.path.join(RAW_DIR, f"collection-log-{ts.strftime('%Y-%m')}.jsonl")


def append_btc_price(ts_iso: str, price: float | None) -> None:
    path = btc_price_path()
    is_new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        if is_new:
            f.write("ts_utc,btc_usd\n")
        f.write(f"{ts_iso},{price if price is not None else ''}\n")


def append_collection_log(ts: datetime, entry: dict) -> None:
    """Append one poll-attempt record so gaps can be diagnosed later: was it a
    missed run, a Kalshi error/rate-limit, or a genuinely empty market? This is
    a new append-only sidecar file -- it never touches the raw snapshots."""
    with open(collection_log_path(ts), "a") as f:
        f.write(json.dumps(entry, separators=(",", ":")) + "\n")


def main() -> int:
    os.makedirs(RAW_DIR, exist_ok=True)
    now = datetime.now(timezone.utc)
    ts_iso = utcnow_iso()

    btc_price = fetch_btc_spot_usd()
    append_btc_price(ts_iso, btc_price)

    errors = []
    markets_by_ticker: dict[str, dict] = {}
    fetches: dict[str, dict] = {}

    def run_fetch(status_query: str, primary: bool) -> None:
        result = {"ok": False, "count": 0, "error": None}
        try:
            batch = fetch_markets(SERIES_TICKER, status=status_query, limit=40)
            result["ok"] = True
            result["count"] = len(batch)
            for m in batch:
                if primary:
                    m["_source_status_query"] = status_query
                    markets_by_ticker[m.get("ticker", id(m))] = m
                else:
                    m.setdefault("_source_status_query", status_query)
                    markets_by_ticker.setdefault(m.get("ticker", id(m)), m)
        except RuntimeError as exc:
            result["error"] = str(exc)
            errors.append(f"{status_query} markets fetch failed: {exc}")
        fetches[status_query] = result

    run_fetch("open", primary=True)
    run_fetch("settled", primary=False)

    out_path = snapshot_path(now)
    written = 0
    with open(out_path, "a") as f:
        for m in markets_by_ticker.values():
            m["_ts"] = ts_iso
            m["_btc_spot_usd"] = btc_price
            f.write(json.dumps(m, separators=(",", ":")) + "\n")
            written += 1

    tickers = sorted(t for t in markets_by_ticker if isinstance(t, str))
    append_collection_log(now, {
        "_ts": ts_iso,
        "btc_price": btc_price,
        "btc_ok": btc_price is not None,
        "fetches": fetches,
        "markets_written": written,
        "tickers": tickers,
        "errors": errors,
    })

    print(f"[{ts_iso}] btc=${btc_price} markets_written={written} file={out_path}")
    for err in errors:
        print(f"[{ts_iso}] WARNING: {err}", file=sys.stderr)

    # Fail the run only if literally nothing could be fetched.
    if written == 0 and btc_price is None:
        print(f"[{ts_iso}] ERROR: collected nothing this run", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
