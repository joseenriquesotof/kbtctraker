"""Thin client for Kalshi's public, unauthenticated market-data API.

Only read-only endpoints are used -- no API key or login required.
Docs: https://docs.kalshi.com/
"""
from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request
import json

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=usd"
)
USER_AGENT = "kbtctraker/1.0 (+https://github.com/joseenriquesotof/kbtctraker)"


def _get_json(url: str, retries: int = 3, timeout: int = 15) -> dict:
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_err = exc
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")


def fetch_markets(series_ticker: str, status: str | None = None, limit: int = 100) -> list[dict]:
    """Fetch markets for a series, optionally filtered by status.

    status: None (all), "open", "closed", or "settled".
    Paginates using the cursor until exhausted or limit reached.
    """
    markets: list[dict] = []
    cursor = None
    while len(markets) < limit:
        params = {
            "series_ticker": series_ticker,
            "limit": min(200, limit - len(markets)),
        }
        if status:
            params["status"] = status
        if cursor:
            params["cursor"] = cursor
        url = f"{KALSHI_BASE}/markets?{urllib.parse.urlencode(params)}"
        data = _get_json(url)
        batch = data.get("markets", [])
        markets.extend(batch)
        cursor = data.get("cursor")
        if not cursor or not batch:
            break
    return markets[:limit]


def fetch_btc_spot_usd() -> float | None:
    try:
        data = _get_json(COINGECKO_URL)
        return data.get("bitcoin", {}).get("usd")
    except RuntimeError:
        return None
