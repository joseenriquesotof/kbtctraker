// Cloudflare Worker: live KXBTC15M collector + aggregator.
//
// Every scheduled run (and every /refresh hit) takes ONE snapshot of the open
// and settled Kalshi markets plus BTC spot, then folds it into a persistent,
// accumulating state in KV. Unlike a naive per-snapshot rebuild, per-market
// probability/gap timelines GROW across runs, so the dashboard sees the full
// shape of each 15-minute window -- matching what collector/aggregate.py
// produces on the GitHub Actions path.
//
// KV keys:
//   markets.json  -> { [ticker]: accumulatedRecord }  (internal working state)
//   data.json     -> the public payload the dashboard fetches
//
// Binding expected: env.KBTC_DATA (KV namespace).

const SERIES_TICKER = "KXBTC15M";
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const COINBASE_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const LEGACY_DATA_URL = "https://joseenriquesotof.github.io/kbtctraker/data.json";

const DATA_KEY = "data.json";
const MARKETS_KEY = "markets.json";

const MAX_POINTS = 288;            // ~24h of series at 5-min cadence
const MAX_RECENT_MARKETS = 60;
const MAX_INSIGHT_MARKETS = 400;
const MAX_TRACKED_MARKETS = 600;   // KV size guard
const MAX_TIMELINE_POINTS = 64;    // a 15-min window at 2-min cadence is ~8
const GAP_CAP_SECONDS = 900;       // cap time-weighting for any single gap
const VOL_WINDOW = 12;             // rolling-volatility sample window

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function first(obj, keys, fallback = null) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return fallback;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(v, digits) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pctField(market, dollarKey, centKey) {
  const dollars = num(first(market, [dollarKey]));
  if (dollars !== null) return dollars * 100;
  return num(first(market, [centKey]));
}

function yesProbability(market) {
  const bid = pctField(market, "yes_bid_dollars", "yes_bid");
  const ask = pctField(market, "yes_ask_dollars", "yes_ask");
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  const last = pctField(market, "last_price_dollars", "last_price");
  if (last !== null) return last;
  if (bid !== null) return bid;
  if (ask !== null) return ask;
  return null;
}

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "kbtctraker-cloudflare-worker/2.0",
      "Accept": "application/json",
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchMarkets(status, limit = 40) {
  const params = new URLSearchParams({ series_ticker: SERIES_TICKER, status, limit: String(limit) });
  const data = await fetchJson(`${KALSHI_BASE}/markets?${params}`);
  return data.markets || [];
}

async function safeFetchMarkets(status, limit = 40) {
  try {
    return await fetchMarkets(status, limit);
  } catch (error) {
    console.log(`Kalshi ${status} fetch skipped: ${error.message || error}`);
    return null;
  }
}

async function fetchBtcSpotUsd() {
  try {
    const data = await fetchJson(COINGECKO_URL);
    const price = num(data?.bitcoin?.usd);
    if (price !== null) return price;
  } catch {
    /* fall through to Coinbase */
  }
  try {
    const data = await fetchJson(COINBASE_URL);
    return num(data?.data?.amount);
  } catch {
    return null;
  }
}

async function fetchLegacyData() {
  try {
    const data = await fetchJson(`${LEGACY_DATA_URL}?seed=${Date.now()}`);
    return data && data.generated_at ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// per-market accumulation
// ---------------------------------------------------------------------------

function strikeOf(market) {
  return num(first(market, ["floor_strike", "cap_strike", "strike_price"]));
}

// Append (minute, value) to a timeline, replacing the last point if it lands in
// the same rounded minute (two refreshes inside one minute shouldn't double up).
function appendPoint(timeline, minute, value) {
  const m = round(minute, 1);
  if (timeline.length) {
    const lastPt = timeline[timeline.length - 1];
    if (Math.abs(lastPt[0] - m) < 0.05) {
      lastPt[1] = value;
      return;
    }
  }
  timeline.push([m, value]);
  if (timeline.length > MAX_TIMELINE_POINTS) timeline.shift();
}

// Time-weighted seconds the market leaned YES (>=50) vs NO (<50), from timeline.
function leaningSeconds(timeline) {
  let yes = 0;
  let no = 0;
  for (let i = 0; i < timeline.length - 1; i++) {
    const dt = Math.max(0, Math.min((timeline[i + 1][0] - timeline[i][0]) * 60, GAP_CAP_SECONDS));
    if (timeline[i][1] >= 50) yes += dt;
    else no += dt;
  }
  return { yes, no };
}

function recomputeDerived(rec) {
  const probs = rec.prob_timeline.map((pt) => pt[1]).filter((p) => p !== null && p !== undefined);
  if (probs.length) {
    rec.yes_prob_first = round(probs[0], 1);
    rec.yes_prob_last = round(probs[probs.length - 1], 1);
    rec.yes_prob_min = round(Math.min(...probs), 1);
    rec.yes_prob_max = round(Math.max(...probs), 1);
  }
  const lean = leaningSeconds(rec.prob_timeline);
  rec.yes_leaning_seconds = lean.yes;
  rec.no_leaning_seconds = lean.no;
  rec.sample_count = rec.prob_timeline.length;
}

// Fold one live snapshot of a market into its accumulating record.
function upsertMarket(markets, market, nowIso, nowMs, btcSpotUsd) {
  const ticker = market.ticker;
  if (!ticker) return;

  const openMs = parseTime(market.open_time);
  const closeMs = parseTime(market.close_time);
  const strike = strikeOf(market);
  const yesProb = yesProbability(market);

  let rec = markets[ticker];
  if (!rec) {
    rec = {
      ticker,
      event_ticker: market.event_ticker,
      title: first(market, ["title", "subtitle", "yes_sub_title"], "BTC price up in next 15 mins?"),
      strike: null,
      open_time: market.open_time,
      close_time: market.close_time,
      status: "",
      result: "",
      first_seen_ts: nowIso,
      last_seen_ts: nowIso,
      yes_prob_first: null,
      yes_prob_last: null,
      yes_prob_min: null,
      yes_prob_max: null,
      yes_bid_pct: null,
      yes_ask_pct: null,
      no_bid_pct: null,
      no_ask_pct: null,
      volume_max: null,
      open_interest: null,
      sample_count: 0,
      prob_timeline: [],
      diff_timeline: [],
      yes_leaning_seconds: 0,
      no_leaning_seconds: 0,
    };
    markets[ticker] = rec;
  }

  // Refresh metadata from the latest snapshot.
  if (strike !== null) rec.strike = strike;
  if (market.open_time) rec.open_time = market.open_time;
  if (market.close_time) rec.close_time = market.close_time;
  rec.status = first(market, ["status"], rec.status || "");
  rec.result = String(first(market, ["result"], rec.result || "") || "").toLowerCase();
  rec.event_ticker = market.event_ticker || rec.event_ticker;
  rec.last_seen_ts = nowIso;
  rec.yes_bid_pct = pctField(market, "yes_bid_dollars", "yes_bid");
  rec.yes_ask_pct = pctField(market, "yes_ask_dollars", "yes_ask");
  rec.no_bid_pct = pctField(market, "no_bid_dollars", "no_bid");
  rec.no_ask_pct = pctField(market, "no_ask_dollars", "no_ask");

  const vol = num(first(market, ["volume_fp", "volume"]));
  if (vol !== null) rec.volume_max = Math.max(rec.volume_max ?? 0, vol);
  const oi = num(first(market, ["open_interest_fp", "open_interest"]));
  if (oi !== null) rec.open_interest = oi;

  // Only sample while the market is actually live -- settled markets quote
  // 0/100 junk that would pollute the timeline.
  const isLive = openMs !== null && closeMs !== null && openMs <= nowMs && nowMs < closeMs;
  if (isLive && yesProb !== null) {
    const minute = (nowMs - openMs) / 60000;
    appendPoint(rec.prob_timeline, minute, round(yesProb, 1));
    if (btcSpotUsd !== null && rec.strike !== null) {
      appendPoint(rec.diff_timeline, minute, round(btcSpotUsd - rec.strike, 2));
    }
  }

  recomputeDerived(rec);
}

// Seed the tracked-market map from the legacy GitHub Pages payload on cold
// start, so we don't lose the history already collected by GitHub Actions.
// Pulls the rich recent_markets first, then backfills from the slimmer (but
// deeper) insight_markets -- de-duped by close_time so no market lands twice.
function seedMarketsFromLegacy(markets, legacy) {
  const seenCloseTimes = new Set();

  for (const m of (legacy && legacy.recent_markets) || []) {
    if (!m.ticker || markets[m.ticker]) continue;
    markets[m.ticker] = {
      ticker: m.ticker,
      event_ticker: m.event_ticker || null,
      title: m.title || "BTC price up in next 15 mins?",
      strike: num(m.strike),
      open_time: m.open_time || null,
      close_time: m.close_time || null,
      status: m.status || "",
      result: String(m.result || "").toLowerCase(),
      first_seen_ts: m.first_seen_ts || null,
      last_seen_ts: m.last_seen_ts || null,
      yes_prob_first: m.yes_prob_first ?? null,
      yes_prob_last: m.yes_prob_last ?? null,
      yes_prob_min: m.yes_prob_min ?? null,
      yes_prob_max: m.yes_prob_max ?? null,
      yes_bid_pct: m.yes_bid_pct ?? null,
      yes_ask_pct: m.yes_ask_pct ?? null,
      no_bid_pct: m.no_bid_pct ?? null,
      no_ask_pct: m.no_ask_pct ?? null,
      volume_max: m.volume_max ?? null,
      open_interest: m.open_interest ?? null,
      sample_count: m.sample_count ?? (m.prob_timeline || []).length,
      prob_timeline: Array.isArray(m.prob_timeline) ? m.prob_timeline : [],
      diff_timeline: Array.isArray(m.diff_timeline) ? m.diff_timeline : [],
      yes_leaning_seconds: m.yes_leaning_seconds || 0,
      no_leaning_seconds: m.no_leaning_seconds || 0,
    };
    if (m.close_time) seenCloseTimes.add(m.close_time);
  }

  // insight_markets are slim (no ticker) -- key them by close_time and skip any
  // already brought in above.
  for (const m of (legacy && legacy.insight_markets) || []) {
    if (!m.close_time || seenCloseTimes.has(m.close_time)) continue;
    const ticker = "SEED-" + m.close_time;
    if (markets[ticker]) continue;
    const timeline = Array.isArray(m.timeline) ? m.timeline : (Array.isArray(m.prob_timeline) ? m.prob_timeline : []);
    const rec = {
      ticker,
      event_ticker: null,
      title: "BTC price up in next 15 mins?",
      strike: num(m.strike),
      open_time: m.open_time || null,
      close_time: m.close_time,
      status: "settled",
      result: String(m.result || "").toLowerCase(),
      first_seen_ts: null,
      last_seen_ts: null,
      yes_prob_first: null,
      yes_prob_last: null,
      yes_prob_min: null,
      yes_prob_max: null,
      yes_bid_pct: null,
      yes_ask_pct: null,
      no_bid_pct: null,
      no_ask_pct: null,
      volume_max: m.volume ?? null,
      open_interest: null,
      sample_count: timeline.length,
      prob_timeline: timeline,
      diff_timeline: Array.isArray(m.diff_timeline) ? m.diff_timeline : [],
      yes_leaning_seconds: 0,
      no_leaning_seconds: 0,
    };
    recomputeDerived(rec);
    markets[ticker] = rec;
    seenCloseTimes.add(m.close_time);
  }
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

function chooseCurrent(records, nowMs) {
  const live = records.filter((r) => r.close_time && parseTime(r.close_time) !== null);
  const active = live
    .filter((r) => {
      const openMs = parseTime(r.open_time);
      const closeMs = parseTime(r.close_time);
      return openMs !== null && closeMs !== null && openMs <= nowMs && nowMs < closeMs;
    })
    .sort((a, b) => parseTime(b.open_time) - parseTime(a.open_time));
  if (active[0]) return active[0];
  const byClose = live.slice().sort((a, b) => parseTime(b.close_time) - parseTime(a.close_time));
  return byClose[0] || null;
}

// Rolling stdev of BTC log returns (%), mirroring aggregate.rolling_volatility.
function rollingVolatility(prices) {
  const out = [];
  const returns = [];
  let prev = null;
  for (const p of prices) {
    if (prev !== null && prev > 0 && p !== null && p > 0) returns.push(Math.log(p / prev));
    else returns.push(null);
    prev = p;
    const windowRets = returns.slice(-VOL_WINDOW).filter((r) => r !== null);
    if (windowRets.length >= 3) {
      const mean = windowRets.reduce((a, b) => a + b, 0) / windowRets.length;
      const variance = windowRets.reduce((a, b) => a + (b - mean) ** 2, 0) / windowRets.length;
      out.push(round(Math.sqrt(variance) * 100, 4));
    } else {
      out.push(null);
    }
  }
  return out;
}

function updateSeries(prevData, nowIso, current, btcSpotUsd) {
  const old = (prevData && prevData.series) || {};
  const push = (arr, v) => [...(arr || []), v].slice(-MAX_POINTS);

  const series = {
    timestamps: push(old.timestamps, nowIso),
    btc_usd: push(old.btc_usd, btcSpotUsd),
    strike_usd: push(old.strike_usd, current ? round(current.strike, 2) : null),
    yes_bid_pct: push(old.yes_bid_pct, current ? round(current.yes_bid_pct, 1) : null),
    no_bid_pct: push(old.no_bid_pct, current ? round(current.no_bid_pct, 1) : null),
    yes_prob_pct: push(old.yes_prob_pct, current ? round(current.yes_prob_last, 1) : null),
    volatility_pct: [],
  };
  series.volatility_pct = rollingVolatility(series.btc_usd);
  return series;
}

function computeStreaks(chrono) {
  let longest = { result: null, length: 0 };
  let cur = { result: null, length: 0 };
  for (const r of chrono) {
    if (r.result === cur.result) cur.length += 1;
    else cur = { result: r.result, length: 1 };
    if (cur.length > longest.length) longest = { ...cur };
  }
  return { longest, current: cur };
}

// ---------------------------------------------------------------------------
// main refresh
// ---------------------------------------------------------------------------

async function refresh(env) {
  const nowIso = isoNow();
  const nowMs = parseTime(nowIso);

  const prevData = await env.KBTC_DATA.get(DATA_KEY, "json").catch(() => null);
  let markets = await env.KBTC_DATA.get(MARKETS_KEY, "json").catch(() => null);
  if (!markets || typeof markets !== "object") markets = {};

  // Cold start: bootstrap tracked markets + series from the GitHub Pages data.
  let seededData = prevData;
  if (Object.keys(markets).length === 0) {
    const legacy = await fetchLegacyData();
    if (legacy) {
      seedMarketsFromLegacy(markets, legacy);
      if (!seededData || !(seededData.series && (seededData.series.timestamps || []).length)) {
        seededData = legacy;
      }
    }
  }

  const [btcSpotUsd, openMarkets] = await Promise.all([
    fetchBtcSpotUsd(),
    fetchMarkets("open", 20),
  ]);
  const settledMarkets = await safeFetchMarkets("settled", 40);

  for (const m of openMarkets) upsertMarket(markets, m, nowIso, nowMs, btcSpotUsd);
  if (settledMarkets) {
    for (const m of settledMarkets) upsertMarket(markets, m, nowIso, nowMs, btcSpotUsd);
  }

  // Prune to keep KV bounded: newest markets by close_time.
  let records = Object.values(markets);
  records.sort((a, b) => (parseTime(b.close_time) || 0) - (parseTime(a.close_time) || 0));
  if (records.length > MAX_TRACKED_MARKETS) {
    records = records.slice(0, MAX_TRACKED_MARKETS);
    markets = {};
    for (const r of records) markets[r.ticker] = r;
  }
  await env.KBTC_DATA.put(MARKETS_KEY, JSON.stringify(markets));

  // ---- current market ----
  const currentRec = chooseCurrent(records, nowMs);
  let current = null;
  if (currentRec) {
    const strike = currentRec.strike;
    const closeMs = parseTime(currentRec.close_time);
    current = {
      ...currentRec,
      btc_spot_usd: btcSpotUsd,
      distance_to_strike_pct:
        btcSpotUsd !== null && strike ? ((btcSpotUsd - strike) / strike) * 100 : null,
      seconds_remaining: closeMs !== null ? Math.max(0, Math.round((closeMs - nowMs) / 1000)) : null,
    };
  }

  // ---- settled markets + stats ----
  const settled = records
    .filter((r) => r.result === "yes" || r.result === "no")
    .sort((a, b) => (parseTime(b.close_time) || 0) - (parseTime(a.close_time) || 0));
  const recentMarkets = settled.slice(0, MAX_RECENT_MARKETS);
  const insightMarkets = settled.slice(0, MAX_INSIGHT_MARKETS).map((r) => ({
    ticker: r.ticker,
    open_time: r.open_time,
    close_time: r.close_time,
    strike: r.strike,
    result: r.result,
    volume: r.volume_max,
    timeline: r.prob_timeline,
    diff_timeline: r.diff_timeline,
  }));

  const chrono = settled.slice().sort((a, b) => (parseTime(a.close_time) || 0) - (parseTime(b.close_time) || 0));
  const up = chrono.filter((r) => r.result === "yes").length;
  const down = chrono.filter((r) => r.result === "no").length;
  const { longest, current: curStreak } = computeStreaks(chrono);

  const totalYesSecs = settled.reduce((s, r) => s + (r.yes_leaning_seconds || 0), 0);
  const totalNoSecs = settled.reduce((s, r) => s + (r.no_leaning_seconds || 0), 0);
  const totalSecs = totalYesSecs + totalNoSecs;
  const volumes = settled.map((r) => r.volume_max).filter((v) => v !== null && v !== undefined);

  const summary = {
    total_markets_tracked: records.length,
    settled_count: settled.length,
    up_wins: up,
    down_wins: down,
    up_win_rate_pct: up + down ? (up / (up + down)) * 100 : null,
    avg_volume: volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
    longest_streak: longest.result ? longest : { result: null, length: 0 },
    current_streak: curStreak.result ? curStreak : { result: null, length: 0 },
    pct_time_yes_leaning: totalSecs ? (totalYesSecs / totalSecs) * 100 : null,
    pct_time_no_leaning: totalSecs ? (totalNoSecs / totalSecs) * 100 : null,
  };

  const data = {
    generated_at: nowIso,
    series_ticker: SERIES_TICKER,
    current,
    summary,
    recent_markets: recentMarkets,
    insight_markets: insightMarkets,
    series: updateSeries(seededData, nowIso, current, btcSpotUsd),
  };

  await env.KBTC_DATA.put(DATA_KEY, JSON.stringify(data));
  return data;
}

// ---------------------------------------------------------------------------
// entrypoints
// ---------------------------------------------------------------------------

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);

    if (url.pathname === "/refresh") {
      try {
        return jsonResponse(await refresh(env));
      } catch (error) {
        return jsonResponse({ error: String(error.message || error) }, 500);
      }
    }

    const saved = await env.KBTC_DATA.get(DATA_KEY);
    if (saved) {
      return new Response(saved, {
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      });
    }

    try {
      return jsonResponse(await refresh(env));
    } catch (error) {
      return jsonResponse({ error: String(error.message || error) }, 500);
    }
  },
};
