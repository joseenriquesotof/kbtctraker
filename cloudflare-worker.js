const SERIES_TICKER = "KXBTC15M";
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const COINBASE_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const LEGACY_DATA_URL = "https://joseenriquesotof.github.io/kbtctraker/data.json";
const DATA_KEY = "data.json";
const MAX_POINTS = 288;

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
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
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

function pctField(market, dollarKey, centKey) {
  const dollars = num(first(market, [dollarKey]));
  if (dollars !== null) return dollars * 100;
  return num(first(market, [centKey]));
}

function yesProbability(market) {
  const bid = pctField(market, "yes_bid_dollars", "yes_bid");
  const ask = pctField(market, "yes_ask_dollars", "yes_ask");
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return pctField(market, "last_price_dollars", "last_price") ?? bid ?? ask;
}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "kbtctraker-cloudflare-worker/1.0",
      "Accept": "application/json",
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchMarkets(status, limit = 40) {
  const params = new URLSearchParams({
    series_ticker: SERIES_TICKER,
    status,
    limit: String(limit),
  });
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
    // Try Coinbase below.
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

function marketRecord(market, nowIso, btcSpotUsd) {
  const openMs = parseTime(market.open_time);
  const closeMs = parseTime(market.close_time);
  const nowMs = parseTime(nowIso);
  const strike = num(first(market, ["floor_strike", "cap_strike", "strike_price"]));
  const yesProb = yesProbability(market);
  const diff = btcSpotUsd !== null && strike !== null ? btcSpotUsd - strike : null;
  const minute = openMs && nowMs ? Math.max(0, Math.round(((nowMs - openMs) / 60000) * 10) / 10) : 0;

  return {
    ticker: market.ticker,
    event_ticker: market.event_ticker,
    title: first(market, ["title", "subtitle", "yes_sub_title"], "BTC price up in next 15 mins?"),
    strike,
    open_time: market.open_time,
    close_time: market.close_time,
    status: first(market, ["status"], ""),
    result: String(first(market, ["result"], "") || "").toLowerCase(),
    first_seen_ts: nowIso,
    last_seen_ts: nowIso,
    yes_prob_first: yesProb === null ? null : Math.round(yesProb * 10) / 10,
    yes_prob_last: yesProb === null ? null : Math.round(yesProb * 10) / 10,
    yes_prob_min: yesProb === null ? null : Math.round(yesProb * 10) / 10,
    yes_prob_max: yesProb === null ? null : Math.round(yesProb * 10) / 10,
    yes_bid_pct: pctField(market, "yes_bid_dollars", "yes_bid"),
    yes_ask_pct: pctField(market, "yes_ask_dollars", "yes_ask"),
    no_bid_pct: pctField(market, "no_bid_dollars", "no_bid"),
    no_ask_pct: pctField(market, "no_ask_dollars", "no_ask"),
    volume_max: num(first(market, ["volume_fp", "volume"])),
    open_interest: num(first(market, ["open_interest_fp", "open_interest"])),
    sample_count: 1,
    prob_timeline: yesProb === null ? [] : [[minute, Math.round(yesProb * 10) / 10]],
    diff_timeline: diff === null ? [] : [[minute, Math.round(diff * 100) / 100]],
    yes_leaning_seconds: 0,
    no_leaning_seconds: 0,
    btc_spot_usd: btcSpotUsd,
    distance_to_strike_pct: btcSpotUsd !== null && strike ? ((btcSpotUsd - strike) / strike) * 100 : null,
    seconds_remaining: closeMs && nowMs ? Math.max(0, Math.round((closeMs - nowMs) / 1000)) : null,
  };
}

function chooseCurrent(openMarkets, nowIso) {
  const nowMs = parseTime(nowIso);
  const active = openMarkets
    .filter((m) => {
      const openMs = parseTime(m.open_time);
      const closeMs = parseTime(m.close_time);
      return openMs && closeMs && openMs <= nowMs && nowMs < closeMs;
    })
    .sort((a, b) => parseTime(b.open_time) - parseTime(a.open_time));
  return active[0] || openMarkets.sort((a, b) => parseTime(b.close_time) - parseTime(a.close_time))[0] || null;
}

function updateSeries(previous, nowIso, current) {
  const old = previous?.series || {};
  const series = {
    timestamps: [...(old.timestamps || []), nowIso],
    btc_usd: [...(old.btc_usd || []), current?.btc_spot_usd ?? null],
    strike_usd: [...(old.strike_usd || []), current?.strike ?? null],
    yes_bid_pct: [...(old.yes_bid_pct || []), current?.yes_bid_pct ?? null],
    no_bid_pct: [...(old.no_bid_pct || []), current?.no_bid_pct ?? null],
    yes_prob_pct: [...(old.yes_prob_pct || []), current?.yes_prob_last ?? null],
    volatility_pct: [...(old.volatility_pct || []), null],
  };
  for (const key of Object.keys(series)) series[key] = series[key].slice(-MAX_POINTS);
  return series;
}

async function refresh(env) {
  const nowIso = isoNow();
  let previous = await env.KBTC_DATA.get(DATA_KEY, "json").catch(() => null);
  if (!previous || !previous.recent_markets || previous.recent_markets.length < 20) {
    const legacy = await fetchLegacyData();
    if (legacy && (!previous || Date.parse(legacy.generated_at || 0) > Date.parse(previous.generated_at || 0))) {
      previous = legacy;
    }
  }
  const [btcSpotUsd, openMarkets] = await Promise.all([
    fetchBtcSpotUsd(),
    fetchMarkets("open", 20),
  ]);
  const settledMarkets = await safeFetchMarkets("settled", 20);

  const currentMarket = chooseCurrent(openMarkets, nowIso);
  const current = currentMarket ? marketRecord(currentMarket, nowIso, btcSpotUsd) : null;
  const freshRecent = settledMarkets ? settledMarkets.map((m) => marketRecord(m, nowIso, btcSpotUsd)) : [];
  const byTicker = new Map();
  for (const market of freshRecent) byTicker.set(market.ticker, market);
  for (const market of previous?.recent_markets || []) {
    if (!byTicker.has(market.ticker)) byTicker.set(market.ticker, market);
  }
  const recent = Array.from(byTicker.values())
    .sort((a, b) => Date.parse(b.close_time || 0) - Date.parse(a.close_time || 0))
    .slice(0, 60);
  const upWins = recent.filter((m) => m.result === "yes").length;
  const downWins = recent.filter((m) => m.result === "no").length;
  const settledCount = upWins + downWins;

  const data = {
    generated_at: nowIso,
    series_ticker: SERIES_TICKER,
    current,
    summary: {
      total_markets_tracked: recent.length,
      settled_count: settledCount,
      up_wins: upWins,
      down_wins: downWins,
      up_win_rate_pct: settledCount ? (upWins / settledCount) * 100 : null,
      avg_volume: recent.length ? recent.reduce((sum, m) => sum + (m.volume_max || 0), 0) / recent.length : null,
      longest_streak: { result: "", length: 0 },
      current_streak: { result: "", length: 0 },
      pct_time_yes_leaning: null,
      pct_time_no_leaning: null,
    },
    recent_markets: recent,
    insight_markets: previous?.insight_markets || recent.map((m) => ({
      close_time: m.close_time,
      result: m.result,
      volume: m.volume_max,
      timeline: m.prob_timeline,
      diff_timeline: m.diff_timeline,
    })),
    series: updateSeries(previous, nowIso, current),
  };

  await env.KBTC_DATA.put(DATA_KEY, JSON.stringify(data));
  return data;
}

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
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    try {
      return jsonResponse(await refresh(env));
    } catch (error) {
      return jsonResponse({ error: String(error.message || error) }, 500);
    }
  },
};