(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DATA_URLS = [
    window.KBTC_DATA_URL || "https://kbtctrackw.jose-soto8.workers.dev/",
    "data.json",
  ];
  let latestData = null;

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function finiteNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function fmtPct(value, digits = 0) {
    return value === null || value === undefined ? "-" : value.toFixed(digits) + "%";
  }

  function bandFor(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return { key: "unknown", label: "waiting" };
    if (value < 35) return { key: "calm", label: "calm" };
    if (value < 65) return { key: "normal", label: "normal" };
    return { key: "elevated", label: "elevated / choppy" };
  }

  function timelineValues(market) {
    return (market.prob_timeline || market.timeline || [])
      .map((pt) => Array.isArray(pt) && pt.length >= 2 ? finiteNum(pt[1]) : null)
      .filter((value) => value !== null);
  }

  function countDirectionSwings(values) {
    let swings = 0;
    let lastDir = 0;
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const dir = diff > 0.05 ? 1 : diff < -0.05 ? -1 : 0;
      if (dir && lastDir && dir !== lastDir) swings++;
      if (dir) lastDir = dir;
    }
    return swings;
  }

  function countLeadFlips(values) {
    let flips = 0;
    let lastSide = null;
    values.forEach((value) => {
      const side = value > 50 ? "yes" : value < 50 ? "no" : null;
      if (side && lastSide && side !== lastSide) flips++;
      if (side) lastSide = side;
    });
    return flips;
  }

  function metricsFor(market) {
    const values = timelineValues(market);
    let priceRange = finiteNum(market.price_range);
    if (priceRange === null && values.length) priceRange = Math.max(...values) - Math.min(...values);
    if (priceRange === null && market.yes_prob_min !== undefined && market.yes_prob_max !== undefined) {
      const low = finiteNum(market.yes_prob_min);
      const high = finiteNum(market.yes_prob_max);
      if (low !== null && high !== null) priceRange = high - low;
    }

    let swingCount = finiteNum(market.swing_count);
    if (swingCount === null && values.length >= 2) swingCount = countDirectionSwings(values);

    let flipCount = finiteNum(market.flip_count);
    if (flipCount === null && values.length >= 2) flipCount = countLeadFlips(values);

    if (priceRange === null || swingCount === null || flipCount === null) return null;
    return { priceRange, swingCount, flipCount };
  }

  function percentileRank(prior, value) {
    if (!prior.length) return null;
    return prior.filter((item) => item <= value).length / prior.length * 100;
  }

  function volatilityMarkets(data) {
    const byKey = new Map();
    (data.insight_markets || []).forEach((market, index) => {
      const key = market.ticker || market.close_time || "insight-" + index;
      byKey.set(key, market);
    });
    (data.recent_markets || []).forEach((market, index) => {
      const key = market.ticker || market.close_time || "recent-" + index;
      byKey.set(key, { ...(byKey.get(key) || {}), ...market });
    });
    return Array.from(byKey.values())
      .filter((market) => (market.result === "yes" || market.result === "no") && (market.close_time || market.open_time))
      .sort((a, b) => Date.parse(a.close_time || a.open_time || 0) - Date.parse(b.close_time || b.open_time || 0));
  }

  function computeLast5(data) {
    const saved = data.last5_volatility || data.volatility || null;
    if (saved && saved.value !== null && saved.value !== undefined) {
      return {
        value: saved.value,
        marketsInAverage: saved.markets_in_average || 5,
        history: saved.history || [],
      };
    }

    const priorRanges = [];
    const priorSwings = [];
    const priorFlips = [];
    const scored = [];

    volatilityMarkets(data).forEach((market) => {
      const savedComposite = finiteNum(market.volatility_composite);
      const metrics = metricsFor(market);
      let composite = savedComposite;

      if (composite === null && metrics) {
        const rangePct = percentileRank(priorRanges, metrics.priceRange);
        const swingPct = percentileRank(priorSwings, metrics.swingCount);
        const flipPct = percentileRank(priorFlips, metrics.flipCount);
        if (rangePct !== null && swingPct !== null && flipPct !== null) {
          composite = 0.5 * rangePct + 0.3 * swingPct + 0.2 * flipPct;
        }
      }

      if (composite !== null) {
        scored.push({ ticker: market.ticker, close_time: market.close_time, composite });
      }

      if (metrics) {
        priorRanges.push(metrics.priceRange);
        priorSwings.push(metrics.swingCount);
        priorFlips.push(metrics.flipCount);
      }
    });

    const history = scored.map((score, index) => {
      const tail = scored.slice(Math.max(0, index - 4), index + 1);
      const value = tail.reduce((sum, item) => sum + item.composite, 0) / tail.length;
      return {
        ticker: score.ticker,
        close_time: score.close_time,
        value: Math.round(value * 10) / 10,
        markets_in_average: tail.length,
      };
    });
    const latest = history[history.length - 1] || null;
    return {
      value: latest ? latest.value : null,
      marketsInAverage: latest ? latest.markets_in_average : 0,
      history: history.slice(-30),
    };
  }

  function sparkline(history, bandKey) {
    const points = (history || [])
      .map((item) => finiteNum(item.value))
      .filter((value) => value !== null);
    const wrap = el("div", { class: "last5-volatility-spark" });
    if (points.length < 2) {
      wrap.appendChild(el("div", { class: "empty-state" }, ["Not enough volatility history yet."]));
      return wrap;
    }

    const svg = svgEl("svg", { viewBox: "0 0 100 36", preserveAspectRatio: "none" });
    const xAt = (index) => (index / (points.length - 1)) * 100;
    const yAt = (value) => 34 - (Math.max(0, Math.min(100, value)) / 100) * 32;
    [35, 65].forEach((level) => {
      svg.appendChild(svgEl("line", {
        class: "last5-volatility-ref",
        x1: 0,
        x2: 100,
        y1: yAt(level),
        y2: yAt(level),
      }));
    });
    const path = points.map((value, index) => `${index ? "L" : "M"}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`).join(" ");
    svg.appendChild(svgEl("path", { class: `last5-volatility-line ${bandKey}`, d: path, fill: "none" }));
    svg.appendChild(svgEl("circle", {
      class: `last5-volatility-dot ${bandKey}`,
      cx: xAt(points.length - 1),
      cy: yAt(points[points.length - 1]),
      r: 2,
    }));
    wrap.appendChild(svg);
    return wrap;
  }

  function panel(snapshot, title) {
    const band = bandFor(snapshot.value);
    const valueText = snapshot.value === null || snapshot.value === undefined ? "-" : Math.round(snapshot.value).toString();
    const gaugeWidth = snapshot.value === null || snapshot.value === undefined ? 0 : Math.max(0, Math.min(100, snapshot.value));
    return el("div", { class: `panel last5-volatility-widget ${band.key}` }, [
      el("div", { class: "last5-volatility-head" }, [
        el("div", {}, [
          el("h2", {}, [title]),
          el("div", { class: "desc" }, ["Composite volatility across the last 5 settled markets, ranked against historical behavior."]),
        ]),
        el("span", { class: `last5-volatility-pill ${band.key}` }, [band.label]),
      ]),
      el("div", { class: "last5-volatility-layout" }, [
        el("div", { class: "last5-volatility-score-box" }, [
          el("div", { class: `last5-volatility-score ${band.key}` }, [valueText]),
          el("div", { class: "last5-volatility-score-label" }, [`${snapshot.marketsInAverage || 0} markets in average`]),
          el("div", { class: "last5-volatility-gauge" }, [
            el("div", { class: `last5-volatility-gauge-fill ${band.key}`, style: `width:${gaugeWidth}%` }),
          ]),
        ]),
        el("div", {}, [
          el("div", { class: "last5-volatility-trend-label" }, ["Last 20-30 markets"]),
          sparkline(snapshot.history, band.key),
        ]),
      ]),
    ]);
  }

  function tile(snapshot) {
    const band = bandFor(snapshot.value);
    return el("div", { class: "tile last5-volatility-tile" }, [
      el("div", { class: "label" }, ["Last-5 Volatility"]),
      el("div", { class: `value ${band.key}` }, [fmtPct(snapshot.value, 0)]),
      el("div", { class: "sub" }, [band.label]),
    ]);
  }

  function replaceOrInsert(container, selector, node, getAnchor) {
    const existing = container.querySelector(selector);
    if (existing) {
      existing.replaceWith(node);
      return;
    }
    const anchor = getAnchor();
    if (anchor && anchor.parentNode === container) anchor.before(node);
    else container.prepend(node);
  }

  function render(data) {
    if (!data) return;
    const snapshot = computeLast5(data);

    const live = document.getElementById("tab-live");
    if (live) {
      const tileRow = live.querySelector(".tiles");
      if (tileRow) {
        const currentTile = tileRow.querySelector(".last5-volatility-tile");
        const newTile = tile(snapshot);
        if (currentTile) currentTile.replaceWith(newTile);
        else tileRow.prepend(newTile);
      }
      replaceOrInsert(
        live,
        ".last5-volatility-widget",
        panel(snapshot, "Last-5 Volatility %"),
        () => live.querySelector(".panel")
      );
    }

    const insights = document.getElementById("tab-insights");
    if (insights) {
      replaceOrInsert(
        insights,
        ".last5-volatility-widget",
        panel(snapshot, "Volatility: Last-5 %"),
        () => {
          const panels = Array.from(insights.querySelectorAll(".panel"));
          return panels.find((item) => (item.querySelector("h2") || {}).textContent === "Volatility") || panels[1] || null;
        }
      );
    }
  }

  async function loadData() {
    let lastError = null;
    for (const url of DATA_URLS) {
      try {
        const sep = url.includes("?") ? "&" : "?";
        const response = await fetch(url + sep + "last5ts=" + Date.now(), { cache: "no-store" });
        if (!response.ok) throw new Error(response.status);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No data source loaded");
  }

  async function refresh() {
    try {
      latestData = await loadData();
      render(latestData);
    } catch {
      render(latestData);
    }
  }

  window.addEventListener("hashchange", () => render(latestData));
  setInterval(() => render(latestData), 5000);
  setInterval(refresh, 60 * 1000);
  refresh();
})();
