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


def append_btc_price(ts_iso: str, price: float | None) -> None:
    path = btc_price_path()
    is_new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        if is_new:
            f.write("ts_utc,btc_usd\n")
        f.write(f"{ts_iso},{price if price is not None else ''}\n")


def main() -> int:
    os.makedirs(RAW_DIR, exist_ok=True)
    now = datetime.now(timezone.utc)
    ts_iso = utcnow_iso()

    btc_price = fetch_btc_spot_usd()
    append_btc_price(ts_iso, btc_price)

    errors = []
    markets_by_ticker: dict[str, dict] = {}

    try:
        for m in fetch_markets(SERIES_TICKER, status="open", limit=40):
            m["_source_status_query"] = "open"
            markets_by_ticker[m.get("ticker", id(m))] = m
    except RuntimeError as exc:
        errors.append(f"open markets fetch failed: {exc}")

    try:
        for m in fetch_markets(SERIES_TICKER, status="settled", limit=40):
            m.setdefault("_source_status_query", "settled")
            markets_by_ticker.setdefault(m.get("ticker", id(m)), m)
    except RuntimeError as exc:
        errors.append(f"settled markets fetch failed: {exc}")

    out_path = snapshot_path(now)
    written = 0
    with open(out_path, "a") as f:
        for m in markets_by_ticker.values():
            m["_ts"] = ts_iso
            m["_btc_spot_usd"] = btc_price
            f.write(json.dumps(m, separators=(",", ":")) + "\n")
            written += 1

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
