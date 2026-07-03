const SVG_NS = "http://www.w3.org/2000/svg";
const VB_W = 1000;
const tooltipEl = document.getElementById("tooltip");

// ---------- formatting ----------
function fmtUsd(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: digits });
}
function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toFixed(digits) + "%";
}
function fmtTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtClock(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(sec) {
  if (sec === null || sec === undefined) return "–";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}
function fmtNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return Math.round(v).toLocaleString();
}

// ---------- dom helpers ----------
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ---------- charts ----------
function lineChart({ timestamps, series, height = 220, refLines = [], yFormat = (v) => v, yTickFormat = null }) {
  const wrap = el("div", { class: "chart-wrap" });
  const svg = svgEl("svg", { class: "chart-svg", viewBox: `0 0 ${VB_W} ${height}`, preserveAspectRatio: "none" });
  wrap.appendChild(svg);

  const padL = 46, padR = 10, padT = 10, padB = 22;
  const plotW = VB_W - padL - padR;
  const plotH = height - padT - padB;

  const allVals = [];
  series.forEach((s) => s.points.forEach((v) => { if (v !== null && v !== undefined) allVals.push(v); }));
  refLines.forEach((r) => allVals.push(r.value));
  if (allVals.length === 0) {
    wrap.appendChild(el("div", { class: "empty-state" }, ["Not enough data yet."]));
    return wrap;
  }
  let yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.1;
  yMin -= pad; yMax += pad;

  const n = timestamps.length;
  const xAt = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const gridN = 4;
  for (let g = 0; g <= gridN; g++) {
    const y = padT + (g / gridN) * plotH;
    svg.appendChild(svgEl("line", { class: "grid", x1: padL, x2: VB_W - padR, y1: y, y2: y }));
    const val = yMax - (g / gridN) * (yMax - yMin);
    const label = svgEl("text", { class: "axis-label", x: padL - 6, y: y + 3, "text-anchor": "end" });
    label.textContent = yTickFormat ? yTickFormat(val) : Math.round(val);
    svg.appendChild(label);
  }
  svg.appendChild(svgEl("line", { class: "baseline", x1: padL, x2: VB_W - padR, y1: padT + plotH, y2: padT + plotH }));

  refLines.forEach((r) => {
    const y = yAt(r.value);
    svg.appendChild(svgEl("line", { class: "ref-line", x1: padL, x2: VB_W - padR, y1: y, y2: y }));
    const label = svgEl("text", { class: "axis-label", x: VB_W - padR, y: y - 4, "text-anchor": "end" });
    label.textContent = r.label || "";
    svg.appendChild(label);
  });

  [0, Math.floor((n - 1) / 2), n - 1].forEach((i) => {
    if (i < 0 || i >= n) return;
    const label = svgEl("text", { class: "axis-label", x: xAt(i), y: height - 4, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" });
    label.textContent = fmtClock(timestamps[i]);
    svg.appendChild(label);
  });

  series.forEach((s) => {
    let d = "";
    let drawing = false;
    s.points.forEach((v, i) => {
      if (v === null || v === undefined) { drawing = false; return; }
      const x = xAt(i), y = yAt(v);
      d += (drawing ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2) + " ";
      drawing = true;
    });
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: s.color, "stroke-width": 2 }));
    // lone points (both neighbors null) would be invisible as a path
    s.points.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const prev = i > 0 ? s.points[i - 1] : null;
      const next = i < n - 1 ? s.points[i + 1] : null;
      if ((prev === null || prev === undefined) && (next === null || next === undefined)) {
        svg.appendChild(svgEl("circle", { cx: xAt(i), cy: yAt(v), r: 3, fill: s.color }));
      }
    });
  });

  const crosshair = svgEl("line", { x1: 0, x2: 0, y1: padT, y2: padT + plotH, stroke: "var(--baseline)", "stroke-width": 1, style: "display:none" });
  svg.appendChild(crosshair);
  const dots = series.map((s) => svgEl("circle", { r: 3, fill: s.color, style: "display:none" }));
  dots.forEach((d) => svg.appendChild(d));

  svg.addEventListener("mousemove", (evt) => {
    const rect = svg.getBoundingClientRect();
    const relX = ((evt.clientX - rect.left) / rect.width) * VB_W;
    let idx = Math.round(((relX - padL) / plotW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    const x = xAt(idx);
    crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);
    crosshair.style.display = "block";
    let rows = "";
    series.forEach((s, si) => {
      const v = s.points[idx];
      dots[si].style.display = v === null || v === undefined ? "none" : "block";
      if (v !== null && v !== undefined) {
        dots[si].setAttribute("cx", x); dots[si].setAttribute("cy", yAt(v));
      }
      rows += `<div><span style="color:${s.color}">&#9679;</span> ${s.name}: <b>${yFormat(v)}</b></div>`;
    });
    tooltipEl.innerHTML = `<div>${fmtTime(timestamps[idx])}</div>${rows}`;
    tooltipEl.style.display = "block";
    tooltipEl.style.left = evt.pageX + 14 + "px";
    tooltipEl.style.top = evt.pageY - 10 + "px";
  });
  svg.addEventListener("mouseleave", () => {
    crosshair.style.display = "none";
    dots.forEach((d) => (d.style.display = "none"));
    tooltipEl.style.display = "none";
  });

  return wrap;
}

function barChart(items, height = 200) {
  const wrap = el("div", { class: "chart-wrap" });
  const svg = svgEl("svg", { class: "chart-svg", viewBox: `0 0 ${VB_W} ${height}`, preserveAspectRatio: "none" });
  wrap.appendChild(svg);
  if (items.length === 0) {
    wrap.appendChild(el("div", { class: "empty-state" }, ["Not enough data yet."]));
    return wrap;
  }
  const padL = 46, padR = 10, padT = 10, padB = 26;
  const plotW = VB_W - padL - padR;
  const plotH = height - padT - padB;
  const maxV = Math.max(...items.map((i) => i.value), 1);
  const gap = 4;
  const bw = plotW / items.length - gap;

  for (let g = 0; g <= 4; g++) {
    const y = padT + (g / 4) * plotH;
    svg.appendChild(svgEl("line", { class: "grid", x1: padL, x2: VB_W - padR, y1: y, y2: y }));
    const label = svgEl("text", { class: "axis-label", x: padL - 6, y: y + 3, "text-anchor": "end" });
    label.textContent = Math.round(maxV - (g / 4) * maxV).toLocaleString();
    svg.appendChild(label);
  }
  svg.appendChild(svgEl("line", { class: "baseline", x1: padL, x2: VB_W - padR, y1: padT + plotH, y2: padT + plotH }));

  items.forEach((it, i) => {
    const x = padL + i * (bw + gap);
    const h = (it.value / maxV) * plotH;
    const y = padT + plotH - h;
    const rect = svgEl("rect", { x, y, width: Math.max(bw, 1), height: Math.max(h, 0), fill: it.color || "var(--series-blue)", rx: 2 });
    rect.addEventListener("mousemove", (evt) => {
      tooltipEl.innerHTML = `<div>${it.label}</div><div>Volume: <b>${it.value.toLocaleString()}</b></div>`;
      tooltipEl.style.display = "block";
      tooltipEl.style.left = evt.pageX + 14 + "px";
      tooltipEl.style.top = evt.pageY - 10 + "px";
    });
    rect.addEventListener("mouseleave", () => (tooltipEl.style.display = "none"));
    svg.appendChild(rect);
  });
  return wrap;
}

function resultBadge(result) {
  if (result === "yes") return `<span class="badge up">&#9650; UP</span>`;
  if (result === "no") return `<span class="badge down">&#9660; DOWN</span>`;
  return `<span class="badge unknown">?</span>`;
}

function legend(items) {
  return el("div", { class: "legend" }, items.map((it) =>
    el("div", { class: "item" }, [
      el("span", { class: "swatch", style: `background:${it.color}` }),
      it.label,
    ])
  ));
}

function tile(label, value, sub = "", cls = "") {
  return el("div", { class: "tile" }, [
    el("div", { class: "label" }, [label]),
    el("div", { class: `value ${cls}` }, [value]),
    sub ? el("div", { class: "sub" }, [sub]) : el("span"),
  ]);
}

// ---------- LIVE tab ----------
function renderLive(root, data) {
  const c = data.current;
  if (c) {
    const tiles = [];
    tiles.push(tile("BTC Spot Price", fmtUsd(c.btc_spot_usd, 0)));
    tiles.push(tile("Kalshi Target (Strike)", fmtUsd(c.strike, 2), c.title || ""));
    const dist = c.distance_to_strike_pct;
    tiles.push(tile("Distance to Target", dist === null || dist === undefined ? "–" : (dist >= 0 ? "+" : "") + dist.toFixed(3) + "%", "", dist >= 0 ? "up" : "down"));
    tiles.push(tile("Time Remaining", fmtDuration(c.seconds_remaining), `closes ${fmtClock(c.close_time)}`));
    const yp = c.yes_prob_last;
    tiles.push(tile("YES (Up) Probability", yp === null || yp === undefined ? "–" : fmtPct(yp), yp === null || yp === undefined ? "" : `NO: ${fmtPct(100 - yp)}`));
    tiles.push(tile("Volume", fmtNum(c.volume_max), "contracts"));
    root.appendChild(el("div", { class: "tiles" }, tiles));
  } else {
    root.appendChild(el("div", { class: "empty-state" }, ["No active market data yet — waiting for the next collector run."]));
  }

  const s = data.series || {};
  const timestamps = s.timestamps || [];

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["BTC Spot Price vs. Kalshi Target"]),
    el("div", { class: "desc" }, ["The target (strike) is the price the active 15-minute contract settles against."]),
    legend([
      { color: "var(--series-blue)", label: "BTC spot (USD)" },
      { color: "var(--series-yellow)", label: "Kalshi target (USD)" },
    ]),
    lineChart({
      timestamps,
      series: [
        { name: "BTC spot", color: "var(--series-blue)", points: s.btc_usd || [] },
        { name: "Target", color: "var(--series-yellow)", points: s.strike_usd || [] },
      ],
      yFormat: (v) => fmtUsd(v, 0),
      yTickFormat: (v) => "$" + Math.round(v).toLocaleString(),
    }),
  ]));

  // YES/NO bid chart (falls back to mid-probability for old data.json files)
  const hasBids = (s.yes_bid_pct || []).some((v) => v !== null && v !== undefined);
  const probSeries = hasBids
    ? [
        { name: "YES bid", color: "var(--series-blue)", points: s.yes_bid_pct || [] },
        { name: "NO bid", color: "var(--series-red)", points: s.no_bid_pct || [] },
      ]
    : [{ name: "YES probability", color: "var(--series-blue)", points: s.yes_prob_pct || [] }];

  const grid2 = el("div", { class: "grid-2" });
  grid2.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["YES bid vs. NO bid"]),
    el("div", { class: "desc" }, ["Best bid on each side of the live contract, in cents (= implied %). When YES bid + NO bid stays far below 100¢, a both-sides play may exist — check the Calculator tab."]),
    legend(hasBids ? [
      { color: "var(--series-blue)", label: "YES bid (¢)" },
      { color: "var(--series-red)", label: "NO bid (¢)" },
    ] : [{ color: "var(--series-blue)", label: "YES probability (%)" }]),
    lineChart({
      timestamps,
      series: probSeries,
      refLines: [{ value: 50, label: "50" }],
      yFormat: (v) => fmtPct(v),
      yTickFormat: (v) => Math.round(v) + "",
    }),
  ]));
  grid2.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["BTC Volatility"]),
    el("div", { class: "desc" }, ["Rolling stdev of 5-min log returns (%) — higher means faster, choppier price moves."]),
    legend([{ color: "var(--series-blue)", label: "Rolling stdev (%)" }]),
    lineChart({
      timestamps,
      series: [{ name: "Volatility", color: "var(--series-blue)", points: s.volatility_pct || [] }],
      yFormat: (v) => (v === null || v === undefined ? "–" : v.toFixed(3) + "%"),
      yTickFormat: (v) => v.toFixed(3) + "%",
    }),
  ]));
  root.appendChild(grid2);

  const volumeItems = (data.recent_markets || []).slice(0, 20).reverse().map((r) => ({
    label: `${fmtTime(r.close_time)} · ${fmtUsd(r.strike, 0)} · ${r.result === "yes" ? "UP" : "DOWN"}`,
    value: r.volume_max || 0,
    color: r.result === "yes" ? "var(--series-blue)" : "var(--series-red)",
  }));
  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["Volume per Market"]),
    el("div", { class: "desc" }, ["Contracts traded in each of the last 20 settled 15-minute markets."]),
    legend([
      { color: "var(--series-blue)", label: "Settled UP" },
      { color: "var(--series-red)", label: "Settled DOWN" },
    ]),
    barChart(volumeItems),
  ]));

  const sm = data.summary || {};
  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["All-Time Summary"]),
    el("div", { class: "tiles" }, [
      tile("Markets Tracked", String(sm.total_markets_tracked ?? "–"), `${sm.settled_count ?? 0} settled`),
      tile("UP win rate", sm.up_win_rate_pct === null || sm.up_win_rate_pct === undefined ? "–" : fmtPct(sm.up_win_rate_pct), `${sm.up_wins ?? 0} up / ${sm.down_wins ?? 0} down`),
      tile("Time leaning YES", sm.pct_time_yes_leaning === null || sm.pct_time_yes_leaning === undefined ? "–" : fmtPct(sm.pct_time_yes_leaning), sm.pct_time_no_leaning === null || sm.pct_time_no_leaning === undefined ? "" : `NO: ${fmtPct(sm.pct_time_no_leaning)}`),
      tile("Current streak", sm.current_streak && sm.current_streak.result ? `${sm.current_streak.length} × ${sm.current_streak.result === "yes" ? "UP" : "DOWN"}` : "–"),
      tile("Longest streak", sm.longest_streak && sm.longest_streak.result ? `${sm.longest_streak.length} × ${sm.longest_streak.result === "yes" ? "UP" : "DOWN"}` : "–"),
      tile("Avg volume / market", sm.avg_volume === null || sm.avg_volume === undefined ? "–" : fmtNum(sm.avg_volume)),
    ]),
  ]));

  const rows = data.recent_markets || [];
  const tablePanel = el("div", { class: "panel" }, [el("h2", {}, ["Recent Settled Markets"])]);
  if (rows.length === 0) {
    tablePanel.appendChild(el("div", { class: "empty-state" }, ["No settled markets recorded yet."]));
  } else {
    const table = el("table", { class: "data" });
    table.innerHTML = `
      <thead><tr>
        <th>Closed</th><th>Target (strike)</th><th>Result</th><th>Volume</th>
        <th>YES range</th><th>Time YES-leaning</th>
      </tr></thead>`;
    const tbody = el("tbody");
    rows.forEach((r) => {
      const tr = el("tr");
      const totalSec = (r.yes_leaning_seconds || 0) + (r.no_leaning_seconds || 0);
      const yesPct = totalSec ? (r.yes_leaning_seconds / totalSec * 100) : null;
      const range = r.yes_prob_min === null || r.yes_prob_min === undefined
        ? "–" : `${fmtPct(r.yes_prob_min)} – ${fmtPct(r.yes_prob_max)}`;
      tr.innerHTML = `
        <td>${fmtTime(r.close_time)}</td>
        <td>${fmtUsd(r.strike, 2)}</td>
        <td>${resultBadge(r.result)}</td>
        <td>${fmtNum(r.volume_max)}</td>
        <td>${range}</td>
        <td>${yesPct === null ? "–" : fmtPct(yesPct)}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tablePanel.appendChild(el("div", { class: "table-scroll" }, [table]));
  }
  root.appendChild(tablePanel);
}

// ---------- CALCULATOR tab ----------
function kalshiFeeDollars(contracts, priceDollars) {
  // Kalshi's published trading-fee formula: ceil(0.07 * C * P * (1-P)),
  // rounded up to the next cent. An estimate -- rates can differ per market.
  const raw = 0.07 * contracts * priceDollars * (1 - priceDollars);
  return Math.ceil(raw * 100) / 100;
}

function renderCalculator(root, data) {
  const c = data && data.current;

  const yesInput = el("input", { type: "number", id: "calc-yes", min: "0.1", max: "99.9", step: "0.1", value: "53" });
  const noInput = el("input", { type: "number", id: "calc-no", min: "0.1", max: "99.9", step: "0.1", value: "47" });
  const nInput = el("input", { type: "number", id: "calc-n", min: "1", step: "1", value: "100" });
  const feeCheck = el("input", { type: "checkbox", id: "calc-fees" });
  feeCheck.checked = true;

  const liveBtn = el("button", { class: "btn", type: "button" }, ["Use live ask prices"]);
  const liveYes = c && c.yes_ask_pct !== null && c.yes_ask_pct !== undefined ? c.yes_ask_pct : null;
  const liveNo = c && c.no_ask_pct !== null && c.no_ask_pct !== undefined ? c.no_ask_pct : null;
  if (liveYes === null || liveNo === null) {
    liveBtn.disabled = true;
    liveBtn.title = "No live prices in the last snapshot";
  }
  liveBtn.addEventListener("click", () => {
    yesInput.value = liveYes.toFixed(1);
    noInput.value = liveNo.toFixed(1);
    recompute();
  });

  const verdictEl = el("div", { class: "verdict bad" }, ["–"]);
  const resultsEl = el("div", { class: "tiles" });
  const breakevenEl = el("div", { class: "hint" });

  function recompute() {
    const yes = parseFloat(yesInput.value);
    const no = parseFloat(noInput.value);
    const n = Math.max(1, Math.floor(parseFloat(nInput.value) || 1));
    if (Number.isNaN(yes) || Number.isNaN(no)) return;

    const combined = yes + no; // cents
    const cost = n * combined / 100; // dollars
    const fees = feeCheck.checked
      ? kalshiFeeDollars(n, yes / 100) + kalshiFeeDollars(n, no / 100)
      : 0;
    const payout = n * 1.0; // exactly one side pays $1
    const profit = payout - cost - fees;
    const profitPct = cost + fees > 0 ? (profit / (cost + fees)) * 100 : null;

    verdictEl.className = "verdict " + (profit > 0 ? "good" : "bad");
    verdictEl.textContent = profit > 0
      ? `✓ Guaranteed profit: ${fmtUsd(profit, 2)} (${profitPct.toFixed(2)}% return)`
      : `✗ No arbitrage — you would lose ${fmtUsd(-profit, 2)} no matter the outcome`;

    resultsEl.innerHTML = "";
    resultsEl.appendChild(tile("Combined price", combined.toFixed(1) + "¢", "YES + NO"));
    resultsEl.appendChild(tile("Total cost", fmtUsd(cost, 2), `${n} contracts each side`));
    resultsEl.appendChild(tile("Est. fees", feeCheck.checked ? fmtUsd(fees, 2) : "excluded", "Kalshi 7% formula"));
    resultsEl.appendChild(tile("Guaranteed payout", fmtUsd(payout, 2), "one side always pays $1"));
    resultsEl.appendChild(tile("Profit either way", fmtUsd(profit, 2), profitPct === null ? "" : profitPct.toFixed(2) + "% on capital", profit > 0 ? "up" : "down"));

    const beCombined = 100 - (fees / n) * 100;
    breakevenEl.textContent = feeCheck.checked
      ? `Breakeven: with these fees, YES + NO must be below ${beCombined.toFixed(1)}¢ to profit. Fees are an estimate of Kalshi's taker formula ceil(0.07 × contracts × price × (1−price)) per side.`
      : `Breakeven without fees: YES + NO must be below 100.0¢.`;
  }

  [yesInput, noInput, nInput].forEach((i) => i.addEventListener("input", recompute));
  feeCheck.addEventListener("change", recompute);

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["Both-Sides (Arbitrage) Calculator"]),
    el("div", { class: "desc" }, ["Exactly one of YES/NO pays $1 per contract at settlement. If you can buy both sides for a combined price below 100¢ (after fees), the profit is locked in regardless of which way BTC moves."]),
    el("div", { class: "calc-grid" }, [
      el("div", { class: "field" }, [el("label", { for: "calc-yes" }, ["YES (Up) price — ¢"]), yesInput]),
      el("div", { class: "field" }, [el("label", { for: "calc-no" }, ["NO (Down) price — ¢"]), noInput]),
      el("div", { class: "field" }, [el("label", { for: "calc-n" }, ["Contracts per side"]), nInput]),
      el("label", { class: "check" }, [feeCheck, "Include estimated Kalshi fees"]),
      el("div", {}, [liveBtn]),
    ]),
    verdictEl,
    resultsEl,
    el("div", { style: "height:10px" }),
    breakevenEl,
  ]));

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["How to read this"]),
    el("div", { class: "hint", html: `
      <ul>
        <li><b>Use ask prices</b>, not bids — you buy each side at its ask. The "Use live ask prices" button fills in the last collected snapshot (up to ~5 min old; the real book moves faster, so always confirm on Kalshi before ordering).</li>
        <li>The opportunity usually appears in volatile moments when the two sides get quoted inconsistently, and it disappears fast.</li>
        <li>Both orders must actually fill at those prices for the math to hold — partial fills leave you directional.</li>
        <li>Fee formula is Kalshi's published 7% taker formula and may not match every market/promotion exactly.</li>
      </ul>` }),
  ]));

  recompute();
}

// ---------- INSIGHTS tab ----------
function computeSignal(markets, threshold, minute, direction) {
  let fired = 0, won = 0;
  for (const m of markets) {
    const early = (m.timeline || []).filter((pt) => pt[0] <= minute);
    if (!early.length) continue;
    const hit = direction === "up"
      ? early.some((pt) => pt[1] >= threshold)
      : early.some((pt) => pt[1] <= 100 - threshold);
    if (!hit) continue;
    fired++;
    const wonIt = direction === "up" ? m.result === "yes" : m.result === "no";
    if (wonIt) won++;
  }
  return { fired, won };
}

function renderInsights(root, data) {
  const markets = (data.insight_markets && data.insight_markets.length
    ? data.insight_markets
    : (data.recent_markets || []).map((r) => ({
        close_time: r.close_time, result: r.result, volume: r.volume_max, timeline: r.prob_timeline || [],
      }))
  ).filter((m) => m.result === "yes" || m.result === "no");

  const withTl = markets.filter((m) => (m.timeline || []).length >= 1);
  const sm = data.summary || {};

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["What is this?"]),
    el("div", { class: "desc" }, [
      `Pattern statistics computed automatically from every market this tracker has recorded (${markets.length} settled so far, ${withTl.length} with sampled in-market odds). ` +
      `Odds are sampled every ~5 minutes by the collector, so each 15-minute market has roughly 2–3 probability readings — patterns get sharper as more data accumulates.`,
    ]),
  ]));

  // --- interactive explorer ---
  const thrInput = el("input", { type: "range", min: "50", max: "95", step: "1", value: "58" });
  const minInput = el("input", { type: "range", min: "1", max: "14", step: "1", value: "8" });
  const thrOut = el("output", {}, ["58%"]);
  const minOut = el("output", {}, ["8 min"]);
  const upResult = el("div", { class: "big-insight" });
  const downResult = el("div", { class: "big-insight" });

  function refreshExplorer() {
    const T = parseInt(thrInput.value, 10);
    const M = parseInt(minInput.value, 10);
    thrOut.textContent = T + "%";
    minOut.textContent = M + " min";
    const upSig = computeSignal(withTl, T, M, "up");
    const downSig = computeSignal(withTl, T, M, "down");
    upResult.innerHTML = upSig.fired === 0
      ? `No market yet had YES ≥ <b>${T}%</b> within the first <b>${M} min</b>.`
      : `When YES was ≥ <b>${T}%</b> within the first <b>${M} min</b>, <span class="up"><b>UP won ${upSig.won} of ${upSig.fired}</b></span> markets (<b>${(upSig.won / upSig.fired * 100).toFixed(0)}%</b>).`;
    downResult.innerHTML = downSig.fired === 0
      ? `No market yet had YES ≤ <b>${100 - T}%</b> within the first <b>${M} min</b>.`
      : `When YES was ≤ <b>${100 - T}%</b> within the first <b>${M} min</b>, <span class="down"><b>DOWN won ${downSig.won} of ${downSig.fired}</b></span> markets (<b>${(downSig.won / downSig.fired * 100).toFixed(0)}%</b>).`;
  }
  thrInput.addEventListener("input", refreshExplorer);
  minInput.addEventListener("input", refreshExplorer);

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["Early-Signal Explorer"]),
    el("div", { class: "desc" }, ["Drag the sliders: does an early lead predict the final result? e.g. “when the % was above 58% in the first 8 minutes, how often did UP actually win?”"]),
    el("div", { class: "range-row" }, [el("label", {}, ["Probability threshold"]), thrInput, thrOut]),
    el("div", { class: "range-row" }, [el("label", {}, ["Within the first…"]), minInput, minOut]),
    upResult,
    downResult,
  ]));

  // --- auto headline stats ---
  const stat = (arr, pred) => arr.filter(pred).length;

  const comebackBase = withTl.filter((m) => Math.min(...m.timeline.map((p) => p[1])) <= 30);
  const comebacks = stat(comebackBase, (m) => m.result === "yes");
  const collapseBase = withTl.filter((m) => Math.max(...m.timeline.map((p) => p[1])) >= 70);
  const collapses = stat(collapseBase, (m) => m.result === "no");

  const last10 = markets.slice(0, 10);
  const last10Up = stat(last10, (m) => m.result === "yes");

  let biggestSwing = null;
  for (const m of withTl) {
    const probs = m.timeline.map((p) => p[1]);
    const swing = Math.max(...probs) - Math.min(...probs);
    if (m.timeline.length >= 2 && (!biggestSwing || swing > biggestSwing.swing)) {
      biggestSwing = { swing, m };
    }
  }

  const yesFinishers = withTl.filter((m) => m.result === "yes" && m.timeline.length);
  const noFinishers = withTl.filter((m) => m.result === "no" && m.timeline.length);
  const avgLast = (arr) => arr.length ? arr.reduce((a, m) => a + m.timeline[m.timeline.length - 1][1], 0) / arr.length : null;

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["Auto Insights"]),
    el("div", { class: "tiles" }, [
      tile("Comebacks to UP", comebackBase.length ? `${comebacks} of ${comebackBase.length}` : "–", "dipped to ≤30% but finished UP"),
      tile("Collapses to DOWN", collapseBase.length ? `${collapses} of ${collapseBase.length}` : "–", "reached ≥70% but finished DOWN"),
      tile("Last 10 markets", last10.length ? `${last10Up} UP / ${last10.length - last10Up} DOWN` : "–"),
      tile("Biggest odds swing", biggestSwing ? fmtPct(biggestSwing.swing, 0) : "–", biggestSwing ? `market closed ${fmtTime(biggestSwing.m.close_time)}` : "needs ≥2 samples per market"),
      tile("Avg last-sample odds, UP winners", avgLast(yesFinishers) === null ? "–" : fmtPct(avgLast(yesFinishers), 0)),
      tile("Avg last-sample odds, DOWN winners", avgLast(noFinishers) === null ? "–" : fmtPct(avgLast(noFinishers), 0)),
    ]),
  ]));

  if (withTl.length < 10) {
    root.appendChild(el("div", { class: "panel" }, [
      el("div", { class: "empty-state" }, [
        `Only ${withTl.length} settled market(s) have sampled odds so far — these numbers will become meaningful after a few hours of collection. The collector adds ~4 markets per hour.`,
      ]),
    ]));
  }

  refreshExplorer();
}

// ---------- tabs ----------
const TABS = ["live", "insights", "calculator"];
function currentTab() {
  const h = location.hash.replace("#", "");
  return TABS.includes(h) ? h : "live";
}
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  TABS.forEach((t) => { document.getElementById("tab-" + t).hidden = t !== name; });
}
function initTabs() {
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => { location.hash = b.dataset.tab; });
  });
  window.addEventListener("hashchange", () => activateTab(currentTab()));
  activateTab(currentTab());
}

// ---------- boot ----------
async function main() {
  initTabs();
  let data = null;
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    document.getElementById("tab-live").appendChild(
      el("div", { class: "empty-state" }, [
        "data.json not found yet. Once the collector workflow runs at least once, this page will populate automatically.",
      ])
    );
    document.getElementById("updated").textContent = "";
    renderCalculator(document.getElementById("tab-calculator"), null);
    document.getElementById("tab-insights").appendChild(
      el("div", { class: "empty-state" }, ["Insights need collected data — check back after the collector has run."])
    );
    return;
  }

  document.getElementById("updated").textContent = "Updated " + fmtTime(data.generated_at);
  renderLive(document.getElementById("tab-live"), data);
  renderInsights(document.getElementById("tab-insights"), data);
  renderCalculator(document.getElementById("tab-calculator"), data);
}

main();
