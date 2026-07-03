# kbtctraker

A dashboard that tracks Kalshi's **KXBTC15M** 15-minute Bitcoin up/down
market: current target (strike) price, live YES/NO probability, volume,
BTC volatility, win rate, streaks, and a history of settled markets — all
saved over time so you can go back and learn from it.

**Live dashboard:** once GitHub Pages is enabled (see setup below), it's
published at `https://<your-username>.github.io/kbtctraker/`.

## How it works

```
GitHub Actions (every 5 min)          docs/ (GitHub Pages)
┌───────────────────────┐             ┌─────────────────────┐
│ collector/collect.py   │──appends──▶│ data/raw/*.jsonl,csv │
│ (Kalshi + CoinGecko)   │             └──────────┬───────────┘
│ collector/aggregate.py │◀──reads────────────────┘
│ → docs/data.json       │
└──────────┬─────────────┘
           │ git commit + push
           ▼
      docs/index.html + app.js  (fetches data.json, renders charts)
```

- **`collector/collect.py`** polls Kalshi's public, unauthenticated market
  API for the `KXBTC15M` series (open + recently settled markets) plus
  BTC's spot price from CoinGecko, and appends what it gets, mostly
  verbatim, to `data/raw/snapshots-YYYY-MM.jsonl` and `data/raw/btc_price.csv`.
  Nothing is ever overwritten — it's an append-only log.
- **`collector/aggregate.py`** reads that raw log and computes the derived
  stats (volatility, time-weighted % spent above/below 50%, win rate,
  streaks, per-market summaries) into `docs/data.json`.
- **`.github/workflows/collect.yml`** runs both scripts every 5 minutes
  (GitHub's minimum cron resolution) and commits the results back to the
  repo. This is why it needs `contents: write` permission.
- **`docs/`** is a static, dependency-free HTML/JS dashboard (no build
  step, no CDN) that reads `docs/data.json` and renders it. It's meant to
  be served by GitHub Pages.

Why GitHub Actions and not a live server? Kalshi's API isn't reachable
from every environment, and this setup needs zero infrastructure — no
server to pay for or keep alive, just Actions + Pages, both free for a
public repo.

## One-time setup (do this after merging to `main`)

1. **Let Actions write to the repo**: Settings → Actions → General →
   Workflow permissions → select **"Read and write permissions"**, save.
   Without this the collector can fetch data but can't commit it.
2. **Enable the workflow**: Actions tab → if prompted, enable workflows
   for this repo. You can also trigger the first run manually via
   Actions → "Collect Kalshi BTC 15-min data" → "Run workflow", instead
   of waiting up to 5 minutes for the schedule.
3. **Enable GitHub Pages**: Settings → Pages → Build and deployment →
   Source: **Deploy from a branch** → Branch: `main`, folder: `/docs` →
   Save. The dashboard URL appears on that same settings page.
4. Wait for the first collector run (or trigger it manually), then reload
   the Pages URL — `docs/data.json` will exist and the dashboard will
   populate.

### Alternative: deploying the dashboard on Vercel

The repo includes a `vercel.json` with `"outputDirectory": "docs"`, so
importing the repo into Vercel serves the dashboard instead of a blank
page. Note that Vercel only hosts the static `docs/` folder — the actual
data collection still runs on the GitHub Actions schedule described
above and commits `docs/data.json` back to the branch; Vercel's Git
integration then redeploys automatically to pick it up (every commit the
collector makes triggers a redeploy, so expect frequent deployments on
whichever branch Vercel is tracking).

## Data notes & limitations

- **Resolution**: GitHub Actions cron tops out at 5-minute intervals (and
  can lag a few extra minutes under load), so each 15-minute Kalshi market
  is sampled roughly 2-3 times, not continuously. Good enough to see the
  shape of each window and to build up long-run stats; not a
  tick-by-tick trading feed.
- **Target/strike price**: shown as "Kalshi Target" — the BTC price the
  active contract settles against (Kalshi's `floor_strike`/`cap_strike`).
- **YES probability**: the mid of Kalshi's live yes bid/ask, in %. This
  is the market's own implied probability that BTC finishes above the
  target.
- **Volatility**: rolling standard deviation of BTC's 5-minute log
  returns, in %, from the CoinGecko price feed (independent of Kalshi's
  own settlement index, so it's an approximation).
- **Robustness**: `collect.py` stores each Kalshi market object almost
  verbatim (JSON Lines), and `aggregate.py` is the only place that
  interprets field names — trying several candidate keys defensively.
  If Kalshi changes a field name, historical raw data is unaffected; only
  the aggregation logic needs a fix.
- **Storage growth**: raw snapshots are partitioned into one file per
  month (`data/raw/snapshots-YYYY-MM.jsonl`) so individual files and git
  diffs stay manageable.

## Running locally

Requires only the Python standard library (no `pip install` needed).

```bash
python3 collector/collect.py      # one poll -> appends to data/raw/
python3 collector/aggregate.py    # rebuilds docs/data.json
python3 -m http.server -d docs 8080  # then open http://localhost:8080
```

Run `collect.py` on a loop (e.g. a local cron every 10-30s) for much
finer-grained data than the GitHub Actions schedule allows.
