const SVG_NS = "http://www.w3.org/2000/svg";
const VB_W = 1000;
const DATA_REFRESH_MS = 60 * 1000;
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

function tile(label, value, sub = "", cls = "", titleAttr = "") {
  const attrs = titleAttr ? { class: "tile", title: titleAttr } : { class: "tile" };
  return el("div", attrs, [
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

  // Client-side settled list + longest streak (with the span it covered), used
  // by both the summary tile and the arrow tracker below.
  const settledChrono = settledList(data);            // oldest → newest
  const streak = longestStreak(settledChrono);
  const streakLabel = streak.result === "yes" ? "UP" : "DOWN";

  const sm = data.summary || {};
  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["All-Time Summary"]),
    el("div", { class: "tiles" }, [
      tile("Markets Tracked", String(sm.total_markets_tracked ?? "–"), `${sm.settled_count ?? settledChrono.length} settled`),
      tile("UP win rate", sm.up_win_rate_pct === null || sm.up_win_rate_pct === undefined ? "–" : fmtPct(sm.up_win_rate_pct), `${sm.up_wins ?? 0} up / ${sm.down_wins ?? 0} down`),
      tile("Time leaning YES", sm.pct_time_yes_leaning === null || sm.pct_time_yes_leaning === undefined ? "–" : fmtPct(sm.pct_time_yes_leaning), sm.pct_time_no_leaning === null || sm.pct_time_no_leaning === undefined ? "" : `NO: ${fmtPct(sm.pct_time_no_leaning)}`),
      tile("Current streak", sm.current_streak && sm.current_streak.result ? `${sm.current_streak.length} × ${sm.current_streak.result === "yes" ? "UP" : "DOWN"}` : "–"),
      tile("Longest streak", streak.result ? `${streak.length} × ${streakLabel}` : "–", streak.result ? `${fmtTime(streak.start)} → ${fmtTime(streak.end)}` : ""),
      tile("Avg volume / market", sm.avg_volume === null || sm.avg_volume === undefined ? "–" : fmtNum(sm.avg_volume)),
    ]),
  ]));

  // Compact settled up/down tracker: last 96 markets (~1 day) as arrows.
  const last96 = settledChrono.slice(-96);
  const trackerPanel = el("div", { class: "panel" }, [
    el("h2", {}, ["Settled Markets — last 96 (~1 day)"]),
    el("div", { class: "desc" }, ["Each arrow is one settled 15-minute market, oldest → newest. Green ▲ = UP (YES) won, red ▼ = DOWN (NO) won. Hover for time, target and result."]),
  ]);
  if (!last96.length) {
    trackerPanel.appendChild(el("div", { class: "empty-state" }, ["No settled markets recorded yet."]));
  } else {
    const grid = el("div", { class: "arrow-grid" });
    last96.forEach((m) => {
      const up = m.result === "yes";
      grid.appendChild(el("span", {
        class: "arrow-cell " + (up ? "up" : "down"),
        title: `${fmtTime(m.close_time)} · ${fmtUsd(m.strike, 0)} · ${up ? "UP" : "DOWN"}`,
      }, [up ? "▲" : "▼"]));
    });
    trackerPanel.appendChild(grid);
    const ups = last96.filter((m) => m.result === "yes").length;
    trackerPanel.appendChild(el("div", { class: "hint", style: "margin-top:10px" }, [
      `${last96.length} shown · ${ups} UP / ${last96.length - ups} DOWN`,
    ]));
    if (streak.result) {
      trackerPanel.appendChild(el("div", {
        class: "hint", style: "margin-top:4px",
        html: `<b>Longest streak:</b> ${streak.length} × ${streakLabel} — from <b>${fmtTime(streak.start)}</b> to <b>${fmtTime(streak.end)}</b>, across ${settledChrono.length} settled markets.`,
      }));
    }
  }
  root.appendChild(trackerPanel);
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

  // Prices in % (like Kalshi), money staked per side in $.
  const yesPriceInput = el("input", { type: "number", id: "calc-yes-p", min: "0.1", max: "99.9", step: "0.1", value: "45" });
  const noPriceInput = el("input", { type: "number", id: "calc-no-p", min: "0.1", max: "99.9", step: "0.1", value: "38" });
  const yesMoneyInput = el("input", { type: "number", id: "calc-yes-m", min: "0", step: "1", value: "200" });
  const noMoneyInput = el("input", { type: "number", id: "calc-no-m", min: "0", step: "1", value: "200" });
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
    yesPriceInput.value = liveYes.toFixed(1);
    noPriceInput.value = liveNo.toFixed(1);
    recompute();
  });

  const verdictEl = el("div", { class: "verdict bad" }, ["–"]);
  const scenarioEl = el("div", { class: "tiles" });
  const detailEl = el("div", { class: "tiles" });
  const breakevenEl = el("div", { class: "hint" });

  function recompute() {
    const yesP = parseFloat(yesPriceInput.value);   // %
    const noP = parseFloat(noPriceInput.value);     // %
    const yesMoney = Math.max(0, parseFloat(yesMoneyInput.value) || 0);
    const noMoney = Math.max(0, parseFloat(noMoneyInput.value) || 0);
    if (Number.isNaN(yesP) || Number.isNaN(noP) || yesP <= 0 || noP <= 0) return;

    // Kalshi has fractional trading, so money / price = contracts (each pays $1).
    const yesContracts = yesMoney / (yesP / 100);
    const noContracts = noMoney / (noP / 100);
    const totalStaked = yesMoney + noMoney;

    const fees = feeCheck.checked
      ? kalshiFeeDollars(yesContracts, yesP / 100) + kalshiFeeDollars(noContracts, noP / 100)
      : 0;

    // If UP (YES) wins: YES contracts pay $1 each, NO stake is lost.
    const profitIfUp = yesContracts * 1.0 - totalStaked - fees;
    // If DOWN (NO) wins: NO contracts pay $1 each, YES stake is lost.
    const profitIfDown = noContracts * 1.0 - totalStaked - fees;
    const worst = Math.min(profitIfUp, profitIfDown);
    const best = Math.max(profitIfUp, profitIfDown);

    verdictEl.className = "verdict " + (worst > 0 ? "good" : best > 0 ? "warn" : "bad");
    if (worst > 0) {
      const retPct = totalStaked + fees > 0 ? (worst / (totalStaked + fees)) * 100 : 0;
      verdictEl.textContent = `✓ Profit either way — you make at least ${fmtUsd(worst, 2)} (${retPct.toFixed(2)}% guaranteed)`;
    } else if (best > 0) {
      verdictEl.textContent = `~ Directional — you profit ${fmtUsd(best, 2)} if one side wins, but lose ${fmtUsd(-worst, 2)} if the other does`;
    } else {
      verdictEl.textContent = `✗ Losing either way — you lose at least ${fmtUsd(-best, 2)} no matter the outcome`;
    }

    scenarioEl.innerHTML = "";
    scenarioEl.appendChild(tile("If UP (YES) wins", fmtUsd(profitIfUp, 2),
      `${fmtNum(yesContracts)} contracts pay $1`, profitIfUp >= 0 ? "up" : "down"));
    scenarioEl.appendChild(tile("If DOWN (NO) wins", fmtUsd(profitIfDown, 2),
      `${fmtNum(noContracts)} contracts pay $1`, profitIfDown >= 0 ? "up" : "down"));
    scenarioEl.appendChild(tile("Guaranteed (worst case)", fmtUsd(worst, 2), "the outcome you'd least want", worst >= 0 ? "up" : "down"));

    detailEl.innerHTML = "";
    detailEl.appendChild(tile("Total staked", fmtUsd(totalStaked, 2), `${fmtUsd(yesMoney, 0)} up · ${fmtUsd(noMoney, 0)} down`));
    detailEl.appendChild(tile("YES contracts", fmtNum(yesContracts), `at ${yesP}% = ${(yesP / 100).toFixed(2)}$ each`));
    detailEl.appendChild(tile("NO contracts", fmtNum(noContracts), `at ${noP}% = ${(noP / 100).toFixed(2)}$ each`));
    detailEl.appendChild(tile("Est. fees", feeCheck.checked ? fmtUsd(fees, 2) : "excluded", "Kalshi 7% formula"));

    // For equal stakes, a guaranteed profit exists iff yesP + noP < 100.
    breakevenEl.innerHTML =
      `Combined price is <b>${(yesP + noP).toFixed(1)}%</b> (YES ${yesP}% + NO ${noP}%). ` +
      (yesP + noP < 100
        ? `Below 100% — a locked-in profit is possible if you size both sides so each outcome pays back more than your total stake (before fees).`
        : `At or above 100% — no both-sides profit exists here before fees; one side must win to come out ahead.`) +
      ` Fees are an estimate of Kalshi's taker formula ceil(0.07 × contracts × price × (1−price)) per side.`;
  }

  [yesPriceInput, noPriceInput, yesMoneyInput, noMoneyInput].forEach((i) => i.addEventListener("input", recompute));
  feeCheck.addEventListener("change", recompute);

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["Both-Sides Position Calculator"]),
    el("div", { class: "desc" }, ["Enter the price of each side (in %, like Kalshi shows) and how much money you'd stake on each. It works out the contracts, the profit if UP wins, the profit if DOWN wins, and whether you come out ahead no matter what. You can stake different amounts on each side."]),
    el("div", { class: "calc-grid" }, [
      el("div", { class: "field" }, [el("label", { for: "calc-yes-p" }, ["YES (Up) price — %"]), yesPriceInput]),
      el("div", { class: "field" }, [el("label", { for: "calc-yes-m" }, ["Money on YES — $"]), yesMoneyInput]),
      el("div", { class: "field" }, [el("label", { for: "calc-no-p" }, ["NO (Down) price — %"]), noPriceInput]),
      el("div", { class: "field" }, [el("label", { for: "calc-no-m" }, ["Money on NO — $"]), noMoneyInput]),
      el("label", { class: "check" }, [feeCheck, "Include estimated Kalshi fees"]),
      el("div", {}, [liveBtn]),
    ]),
    verdictEl,
    scenarioEl,
    el("div", { style: "height:6px" }),
    detailEl,
    el("div", { style: "height:10px" }),
    breakevenEl,
  ]));

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["How to read this"]),
    el("div", { class: "hint", html: `
      <ul>
        <li>Prices are entered as <b>%</b>, matching what Kalshi shows. A 45% YES price means each YES contract costs $0.45 and pays $1 if UP wins.</li>
        <li><b>Use ask prices</b>, not bids — you buy each side at its ask. "Use live ask prices" fills the last collected snapshot. The collector samples Kalshi about every 2 minutes, but published data can lag while GitHub Actions commits and the site redeploys, so always confirm on Kalshi before ordering.</li>
        <li>Staking <b>different amounts</b> on each side tilts your payout: more on the side you think is likelier raises that outcome's profit but lowers the other. The "Guaranteed (worst case)" tile shows what you keep if the less-favorable side wins.</li>
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

// Dollar-gap signal: was (btc - target) beyond +/- gap$ within the chosen
// window (first N min or last N min), and did the market resolve that way?
function computeDiffSignal(markets, gap, minute, windowMode, direction) {
  let fired = 0, won = 0;
  for (const m of markets) {
    const tl = m.diff_timeline || [];
    if (!tl.length) continue;
    const inWindow = windowMode === "last"
      ? tl.filter((pt) => pt[0] >= 15 - minute)
      : tl.filter((pt) => pt[0] <= minute);
    if (!inWindow.length) continue;
    const hit = direction === "up"
      ? inWindow.some((pt) => pt[1] >= gap)
      : inWindow.some((pt) => pt[1] <= -gap);
    if (!hit) continue;
    fired++;
    const wonIt = direction === "up" ? m.result === "yes" : m.result === "no";
    if (wonIt) won++;
  }
  return { fired, won };
}

// ---------- derived trackers (computed in-browser from the shipped timelines,
// so they work the same whether data.json comes from the worker or aggregate.py,
// and refresh automatically every load) ----------
function utcDate(iso) { return iso ? String(iso).slice(0, 10) : "—"; }

// Chronological (oldest→newest) settled list from whatever the API shipped:
// insight_markets (deepest history) preferred, else recent_markets.
function settledList(data) {
  const src = (data.insight_markets && data.insight_markets.length)
    ? data.insight_markets
    : (data.recent_markets || []).map((r) => ({
        ticker: r.ticker, close_time: r.close_time, open_time: r.open_time,
        strike: r.strike, result: r.result, volume: r.volume_max,
        timeline: r.prob_timeline || [], diff_timeline: r.diff_timeline || [],
      }));
  return src
    .filter((m) => m.result === "yes" || m.result === "no")
    .slice()
    .sort((a, b) => (Date.parse(a.close_time || 0) || 0) - (Date.parse(b.close_time || 0) || 0));
}

// Longest run of identical results, with the wall-clock span it covered.
function longestStreak(chrono) {
  let best = { result: null, length: 0, start: null, end: null };
  let cur = { result: null, length: 0, start: null, end: null };
  for (const m of chrono) {
    if (m.result === cur.result) { cur.length++; cur.end = m.close_time; }
    else cur = { result: m.result, length: 1, start: m.close_time, end: m.close_time };
    if (cur.length > best.length) best = { ...cur };
  }
  return best;
}

function nearestDiff(dtl, minute) {
  let best = null, bestD = Infinity;
  for (const pt of dtl || []) {
    const d = Math.abs(pt[0] - minute);
    if (d < bestD) { bestD = d; best = pt; }
  }
  return best ? best[1] : null;
}

// Golden Rule: qualifies if any diff_timeline sample in the last 3 minutes
// (minutes_elapsed >= 12) has |BTC − strike| >= $50. Predicted side is the sign
// of the decisive (latest-qualifying) gap; "correct" if it matches the result.
function computeGoldenRule(markets) {
  const q = [];
  for (const m of markets) {
    const late = (m.diff_timeline || []).filter((pt) => pt[0] >= 12 && Math.abs(pt[1]) >= 50);
    if (!late.length) continue;
    const decisive = late[late.length - 1];
    const gap = Math.abs(decisive[1]);
    const predicted = decisive[1] > 0 ? "yes" : "no";
    q.push({
      m, date: utcDate(m.close_time), ts: decisive[2] || m.close_time,
      minute: decisive[0], gap, predicted, result: m.result,
      correct: m.result === predicted,
    });
  }
  return q;
}

// Golden Rule v2: same last-3-minute window as v1, but classifies every market
// into exactly one tier based on how many samples landed in the window and
// whether they agree, so a lone sample near a ~2-min polling gap (unconfirmed
// but not wrong) is told apart from a gap that genuinely failed to hold
// (a real reversal). v1 is untouched -- this is a separate, additive pass.
const CR_FLAG_MAX = 0.5; // closing_ratio below this is flagged (orange)

function windowSamplesOf(m) {
  return (m.diff_timeline || []).filter((pt) => pt[0] >= 12);
}

// closing_ratio = last sample in the ENTIRE diff_timeline / the sample that
// first triggered the rule (chronologically first qualifying window sample).
// Shared definition so v1 and v2 produce comparable ratios.
function closingRatioFrom(triggerValue, dtl) {
  if (!dtl.length || !triggerValue) return null;
  return dtl[dtl.length - 1][1] / triggerValue;
}

function computeGoldenRuleV2(markets) {
  const out = { confirmed: [], single_reading: [], rejected: [] };
  for (const m of markets) {
    const win = windowSamplesOf(m);
    if (!win.length) continue; // no data in window -- not classified by v2 either

    let tier;
    if (win.length >= 2) {
      // "rejected" catches both the documented case (a sample under $50) and
      // the rarer case of all samples being big but flipping sign -- either
      // way the gap didn't hold consistently, which is what v2 is guarding
      // against.
      const allBig = win.every((pt) => Math.abs(pt[1]) >= 50);
      const sameSign = allBig && win.every((pt) => Math.sign(pt[1]) === Math.sign(win[0][1]));
      tier = sameSign ? "confirmed" : "rejected";
    } else {
      tier = Math.abs(win[0][1]) >= 50 ? "single_reading" : null;
    }
    if (!tier) continue;

    // Predicted side: for confirmed/single_reading, the (only or unanimous)
    // triggering sample's direction. For rejected, there's no consistent
    // direction by definition, so -- for transparency only, since these are
    // excluded from the qualifying pool -- we use the LAST in-window sample's
    // direction (the final read before close).
    const triggerPt = tier === "rejected" ? win[win.length - 1] : win[0];
    const predicted = triggerPt[1] > 0 ? "yes" : "no";
    const dtl = m.diff_timeline || [];

    const rec = {
      m, tier, date: utcDate(m.close_time), predicted, result: m.result,
      correct: m.result === predicted,
      triggerMinute: triggerPt[0], triggerValue: triggerPt[1],
      windowSampleCount: win.length,
      closingRatio: null, signFlipInWindow: false,
      finalValue: null, dollarShrink: null, pctRetained: null,
    };

    if (tier === "confirmed" || tier === "single_reading") {
      rec.finalValue = dtl.length ? dtl[dtl.length - 1][1] : null;
      rec.closingRatio = closingRatioFrom(win[0][1], dtl);
      if (rec.closingRatio !== null) rec.pctRetained = rec.closingRatio * 100;
      if (rec.finalValue !== null) rec.dollarShrink = win[0][1] - rec.finalValue;
      const firstSign = Math.sign(win[0][1]);
      rec.signFlipInWindow = win.some((pt) => Math.sign(pt[1]) !== 0 && Math.sign(pt[1]) !== firstSign);
    }

    out[tier].push(rec);
  }
  return out;
}

const CR_BUCKETS = [
  ["< 0 (reversed)", -Infinity, 0],
  ["0.0 – 0.5 ⚠", 0, CR_FLAG_MAX],
  ["0.5 – 0.8", CR_FLAG_MAX, 0.8],
  ["0.8 – 1.0", 0.8, 1.0],
  ["≥ 1.0 (held/grew)", 1.0, Infinity],
];

function crStats(ratios) {
  const valid = ratios.filter((r) => r !== null && r !== undefined && Number.isFinite(r));
  return {
    avg: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    n: valid.length,
    buckets: CR_BUCKETS.map(([label, lo, hi]) => ({
      label, count: valid.filter((r) => r >= lo && r < hi).length,
    })),
  };
}

function goldenRuleV2Panel(withDiff) {
  const v1 = computeGoldenRule(withDiff); // recomputed here only -- v1 itself is untouched
  const v2 = computeGoldenRuleV2(withDiff);
  const v2Qualifying = [...v2.confirmed, ...v2.single_reading];
  const v2Correct = v2Qualifying.filter((x) => x.correct).length;
  const v1Correct = v1.filter((x) => x.correct).length;

  const panel = el("div", { class: "panel" }, [
    el("h2", {}, ["Golden Rule v2 — Confirmed vs. Single-Reading vs. Rejected"]),
    el("div", { class: "desc" }, [
      "v1 (above) fires on any single qualifying sample in the last 3 minutes. v2 checks whether the ~2-minute polling cadence actually caught enough of the window to trust it: ",
      el("b", {}, ["confirmed"]), " — 2+ samples in the window, all ≥$50 the same direction. ",
      el("b", {}, ["single-reading"]), " — only 1 sample landed in the window (a polling gap, not a weak signal — still ≥$50). ",
      el("b", {}, ["rejected"]), " — 2+ samples exist but they disagree or one fell under $50: the gap genuinely didn't hold, so these are excluded from v2's qualifying pool.",
    ]),
  ]);

  if (!v1.length && !v2Qualifying.length && !v2.rejected.length) {
    panel.appendChild(el("div", { class: "empty-state" }, [
      "No v1 or v2 activity yet — this fills in as markets are caught live near close.",
    ]));
    return panel;
  }

  // --- v1 vs v2 vs combined, side by side ---
  // v2Qualifying is always a subset of v1 (confirmed/single-reading both require
  // at least one in-window sample >=$50, which alone satisfies v1's own "any
  // qualifying sample" rule) -- so the deduped union can, in general, still pick
  // up "rejected" markets that separately happen to have a v1-qualifying sample.
  // Computed as a real dedup (not assumed equal to v1) so this stays correct if
  // either rule's definition changes later.
  const combinedByKey = new Map();
  for (const x of v1) combinedByKey.set(marketKey(x.m), x);
  for (const x of v2Qualifying) if (!combinedByKey.has(marketKey(x.m))) combinedByKey.set(marketKey(x.m), x);
  const combined = Array.from(combinedByKey.values());
  const combinedCorrect = combined.filter((x) => x.correct).length;

  panel.appendChild(el("div", { class: "tiles" }, [
    tile("v1 qualifying", String(v1.length), "any single ≥$50 sample"),
    tile("v1 accuracy", v1.length ? fmtPct(v1Correct / v1.length * 100, 1) : "–", `${v1Correct} correct of ${v1.length}`),
    tile("v2 qualifying", String(v2Qualifying.length), "confirmed + single-reading"),
    tile("v2 accuracy", v2Qualifying.length ? fmtPct(v2Correct / v2Qualifying.length * 100, 1) : "–", `${v2Correct} correct of ${v2Qualifying.length}`),
    tile("v1 + v2 combined", String(combined.length), "deduped — same market counted once", "", "Union of v1's qualifying markets and v2's confirmed+single-reading markets, deduped by market. Since v2's qualifying pool is always contained in v1's, this number is currently identical to v1's own count."),
    tile("Combined accuracy", combined.length ? fmtPct(combinedCorrect / combined.length * 100, 1) : "–", `${combinedCorrect} correct of ${combined.length}`),
  ]));

  // --- per-tier breakdown ---
  const tierRow = (label, list, note, titleAttr) => {
    const c = list.filter((x) => x.correct).length;
    return tile(label, String(list.length), list.length ? `${fmtPct(c / list.length * 100, 0)} accurate — ${note}` : note, "", titleAttr);
  };
  panel.appendChild(el("h2", { style: "font-size:13px;margin:14px 0 4px" }, ["v2 by tier"]));
  panel.appendChild(el("div", { class: "tiles" }, [
    tierRow("Confirmed", v2.confirmed, "high confidence"),
    tierRow("Single-reading", v2.single_reading, "polling gap, not a weak signal"),
    tierRow(
      "Rejected", v2.rejected, "a real reversal, not a data gap",
      "The gap reached $50+ at some point in the final 3 minutes, but a later reading in that same window showed it had dropped back below $50 (or flipped direction) — the signal didn't hold, so no bet would have been placed. Excluded from v2's qualifying pool."
    ),
  ]));
  panel.appendChild(el("div", { class: "hint" }, [
    el("b", {}, ["Single-reading"]), " markets are lower-confidence only because a ~2-minute poll may have missed a confirming second sample in the 3-minute window — the trigger itself is just as real as a confirmed one. ",
    el("b", {}, ["Rejected"]), " markets are the opposite: the window was sampled well enough (2+ readings), and the gap genuinely failed to hold through to close — a real reversal signal, not a missed reading.",
  ]));

  // --- closing_ratio: v1 vs v2, plus $ / % framing for v2 ---
  // v1's own trigger is the first sample in the window that ITSELF qualifies
  // (abs>=50) -- not just the first window sample, which for a market v1 only
  // counts via a later sample (e.g. a "rejected"-tier window like [30, 80])
  // could be under $50 and would misrepresent the trigger.
  function v1TriggerAndFinal(m) {
    const late = (m.diff_timeline || []).filter((pt) => pt[0] >= 12 && Math.abs(pt[1]) >= 50);
    if (!late.length) return [null, null];
    const dtl = m.diff_timeline || [];
    return [late[0][1], dtl.length ? dtl[dtl.length - 1][1] : null];
  }
  const v1TF = v1.map((x) => v1TriggerAndFinal(x.m));
  const v1Ratios = v1TF.map(([trig, fin]) => (trig && fin !== null ? fin / trig : null));
  const v2Ratios = v2Qualifying.map((x) => x.closingRatio);
  const v1Cr = crStats(v1Ratios);
  const v2Cr = crStats(v2Ratios);
  const shrinks = v2Qualifying.map((x) => x.dollarShrink).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const retained = v2Qualifying.map((x) => x.pctRetained).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const avgShrink = avg(shrinks);
  const avgRetained = avg(retained);

  panel.appendChild(el("h2", { style: "font-size:13px;margin:14px 0 4px" }, ["Closing ratio — how much the gap held (v1 vs. v2)"]));
  panel.appendChild(el("div", { class: "desc" }, [
    "closing_ratio = (last diff_timeline sample) ÷ (the sample that first triggered the rule) — i.e. % of the gap still there by close. Below 1.0 means the gap shrank before close; below " + CR_FLAG_MAX + " (⚠) is flagged as a weak finish.",
  ]));
  panel.appendChild(el("div", { class: "tiles" }, [
    tile("v1 avg closing ratio", v1Cr.avg === null ? "–" : v1Cr.avg.toFixed(2) + "×", `${v1Cr.n} markets`),
    tile("v2 avg closing ratio", v2Cr.avg === null ? "–" : v2Cr.avg.toFixed(2) + "×", `${v2Cr.n} markets`),
    tile("v2 avg $ shrink", avgShrink === null ? "–" : fmtUsd(avgShrink, 0), "confirmed + single-reading"),
    tile("v2 avg % of gap retained", avgRetained === null ? "–" : fmtPct(avgRetained, 0), "confirmed + single-reading"),
  ]));

  const crTable = el("table", { class: "data" });
  crTable.innerHTML = "<thead><tr><th>Closing ratio</th><th>v1 count</th><th>v2 count</th></tr></thead>";
  const crBody = el("tbody");
  CR_BUCKETS.forEach((_, i) => {
    const tr = el("tr");
    tr.innerHTML = `<td>${v1Cr.buckets[i].label}</td><td>${v1Cr.buckets[i].count}</td><td>${v2Cr.buckets[i].count}</td>`;
    crBody.appendChild(tr);
  });
  crTable.appendChild(crBody);
  panel.appendChild(el("div", { class: "table-scroll" }, [crTable]));

  // --- worst cases: last 24h top-3, plus the all-time worst as a footnote ---
  // trigger/final are stored directly on the tagged entry (not nested under
  // .x) so v1 and v2 entries -- whose underlying records have different
  // field names -- render through one uniform path.
  const tagged = [
    ...v1.map((x, i) => ({ x, ratio: v1Ratios[i], version: "v1", trigger: v1TF[i][0], final: v1TF[i][1] })),
    ...v2Qualifying.map((x) => ({ x, ratio: x.closingRatio, version: `v2 (${x.tier.replace("_", "-")})`, trigger: x.triggerValue, final: x.finalValue })),
  ].filter((t) => t.ratio !== null && t.ratio !== undefined && Number.isFinite(t.ratio));

  if (tagged.length) {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const recent = tagged.filter((t) => (Date.parse(t.x.m.close_time || 0) || 0) >= cutoff);
    const worst24 = recent.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 3);
    const allTimeWorst = tagged.reduce((a, b) => (b.ratio < a.ratio ? b : a));

    const rect = el("div", { class: "worst-case-rect" }, [
      el("h2", {}, ["Worst Closing Ratios — Last 24 Hours"]),
    ]);

    if (!worst24.length) {
      rect.appendChild(el("div", { class: "empty-state" }, ["No v1/v2 qualifying markets with a closing ratio in the last 24 hours."]));
    } else {
      const wTable = el("table", { class: "data" });
      wTable.innerHTML = "<thead><tr><th>Market (close)</th><th>Trigger</th><th>Final</th><th>Shrink</th></tr></thead>";
      const wBody = el("tbody");
      worst24.forEach((t) => {
        const tr = el("tr");
        if (t.ratio < CR_FLAG_MAX) tr.className = "cr-flagged-row";
        tr.innerHTML =
          `<td>${fmtTime(t.x.m.close_time)} <span class="wc-note">${t.version}</span></td>` +
          `<td>${fmtUsd(t.trigger, 0)} <span class="wc-note">(100%)</span></td>` +
          `<td>${t.final === null ? "–" : fmtUsd(t.final, 0)} <span class="wc-note">(${Math.round(t.ratio * 100)}%)</span></td>` +
          `<td>${t.final === null ? "–" : fmtUsd(t.trigger - t.final, 0)} <span class="wc-note">(${Math.round((1 - t.ratio) * 100)} pts)</span></td>`;
        wBody.appendChild(tr);
      });
      wTable.appendChild(wBody);
      rect.appendChild(el("div", { class: "table-scroll" }, [wTable]));
    }

    rect.appendChild(el("div", { class: "hint", style: "margin-top:10px" }, [
      `All-time worst: `,
      el("b", {}, [fmtTime(allTimeWorst.x.m.close_time)]),
      ` · `, el("b", {}, [allTimeWorst.version]),
      ` predicted ${allTimeWorst.x.predicted === "yes" ? "UP" : "DOWN"}, settled ${allTimeWorst.x.result === "yes" ? "UP" : "DOWN"} · closing ratio `,
      el("b", {}, [allTimeWorst.ratio.toFixed(2) + "×"]),
      ` (${allTimeWorst.ratio < 0 ? "flipped to the opposite sign" : Math.round(allTimeWorst.ratio * 100) + "% of trigger value retained"}).`,
    ]));

    panel.appendChild(rect);
  }

  return panel;
}

// Comebacks: one side hit >=85% (or the other <=15%) before the final minute
// (minutes_elapsed < 14), yet the OPPOSITE side won.
function computeComebacks(markets) {
  const out = [];
  for (const m of markets) {
    const early = (m.timeline || []).filter((pt) => pt[0] < 14);
    if (!early.length) continue;
    let maxYes = -Infinity, maxPt = null, minYes = Infinity, minPt = null;
    for (const pt of early) {
      if (pt[1] > maxYes) { maxYes = pt[1]; maxPt = pt; }
      if (pt[1] < minYes) { minYes = pt[1]; minPt = pt; }
    }
    let favored, favoredPct, pt;
    if (m.result === "no" && maxYes >= 85) { favored = "yes"; favoredPct = maxYes; pt = maxPt; }
    else if (m.result === "yes" && minYes <= 15) { favored = "no"; favoredPct = 100 - minYes; pt = minPt; }
    else continue;
    const dtl = m.diff_timeline || [];
    out.push({
      m, date: utcDate(m.close_time), ts: pt[2] || m.close_time,
      favored, favoredPct, extremeMinute: pt[0],
      minutesLeft: Math.max(0, +(15 - pt[0]).toFixed(1)),
      gapAtExtreme: nearestDiff(dtl, pt[0]),
      gapAtClose: dtl.length ? dtl[dtl.length - 1][1] : null,
      result: m.result,
    });
  }
  out.sort((a, b) => (Date.parse(b.ts || 0) || 0) - (Date.parse(a.ts || 0) || 0));
  return out;
}

// ---------- volatility metrics ----------
const VOL_FLAG_RATIO = 2.5;      // vol_ratio above this is "unusually large" ⚡
const VOL_BASELINE_MAX = 20;     // trailing markets used for the baseline
const VOL_BASELINE_MIN = 5;      // don't emit a ratio against a thinner baseline

function marketKey(m) { return m.ticker || m.close_time || ""; }

// Per-market movement metrics from the shipped timelines, plus each market's
// price_range relative to the trailing-20 baseline of chronologically PRIOR
// markets. Returns a Map keyed by marketKey(m).
function computeVolMetrics(data) {
  const chrono = settledList(data); // oldest → newest
  const metrics = new Map();
  const priorRanges = [];           // price_ranges of already-processed markets

  for (const m of chrono) {
    const tl = m.timeline || [];
    const dtl = m.diff_timeline || [];

    // price_range: span of BTC-vs-strike movement; needs >=2 samples to mean
    // anything (a single sample would report a fake 0 and drag the baseline).
    let priceRange = null;
    if (dtl.length >= 2) {
      const vals = dtl.map((pt) => pt[1]);
      priceRange = Math.max(...vals) - Math.min(...vals);
    }

    // flip_count: favored-side changes, i.e. crossings of the 50% line.
    let flipCount = 0;
    let prevSide = null;
    for (const pt of tl) {
      const side = pt[1] > 50 ? "yes" : pt[1] < 50 ? "no" : null; // exactly 50 = no side
      if (side && prevSide && side !== prevSide) flipCount++;
      if (side) prevSide = side;
    }

    // swing_count: direction reversals anywhere in the probability path
    // (every local peak/trough, zigzags included even on one side of 50).
    let swingCount = 0;
    let prevDir = 0;
    for (let i = 1; i < tl.length; i++) {
      const d = Math.sign(tl[i][1] - tl[i - 1][1]);
      if (d !== 0) {
        if (prevDir !== 0 && d !== prevDir) swingCount++;
        prevDir = d;
      }
    }

    // vol_ratio: this market's range vs the average of the trailing prior
    // ranges. Skipped until enough history exists for a meaningful baseline.
    let volRatio = null;
    if (priceRange !== null && priorRanges.length >= VOL_BASELINE_MIN) {
      const base = priorRanges.slice(-VOL_BASELINE_MAX);
      const avg = base.reduce((a, b) => a + b, 0) / base.length;
      if (avg > 0) volRatio = priceRange / avg;
    }

    if (tl.length >= 2 || dtl.length >= 2) {
      metrics.set(marketKey(m), {
        m,
        date: utcDate(m.close_time),
        priceRange,
        flipCount,
        swingCount,
        volRatio,
        flagged: volRatio !== null && volRatio > VOL_FLAG_RATIO,
        probSamples: tl.length,
      });
    }
    if (priceRange !== null) priorRanges.push(priceRange);
  }
  return metrics;
}

function volFlag(v) {
  return v !== null && v !== undefined && v > VOL_FLAG_RATIO
    ? ' <span class="vol-flag" title="vol_ratio > 2.5× the trailing-20 baseline">⚡</span>'
    : "";
}

function fmtRatio(v) {
  return v === null || v === undefined ? "–" : v.toFixed(2) + "×";
}

function volatilityPanel(volMetrics) {
  const all = Array.from(volMetrics.values());
  const panel = el("div", { class: "panel" }, [
    el("h2", {}, ["Volatility"]),
    el("div", { class: "desc" }, [
      "Per-market movement computed from the sampled timelines: price_range = span of BTC-vs-target movement ($); flips = favored-side changes (50% crossings); swings = every direction reversal in the odds path; vol_ratio = this market's price_range vs the average of the trailing 20 prior markets. ⚡ marks vol_ratio > 2.5× — an unusually large move vs recent baseline.",
    ]),
  ]);

  if (!all.length) {
    panel.appendChild(el("div", { class: "empty-state" }, [
      "No markets with enough sampled timeline data yet — volatility metrics need at least 2 in-window samples per market.",
    ]));
    return panel;
  }

  // --- headline: today vs recent normal ---
  const today = utcDate(new Date().toISOString());
  const withRange = all.filter((x) => x.priceRange !== null);
  const withRatio = all.filter((x) => x.volRatio !== null);
  const avg = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : null);
  const todayRange = avg(withRange.filter((x) => x.date === today), (x) => x.priceRange);
  const todayRatio = avg(withRatio.filter((x) => x.date === today), (x) => x.volRatio);
  const allRange = avg(withRange, (x) => x.priceRange);
  const flaggedCount = all.filter((x) => x.flagged).length;

  panel.appendChild(el("div", { class: "tiles" }, [
    tile("Today's avg price range", todayRange === null ? "–" : fmtUsd(todayRange, 0),
      allRange === null ? "" : `all-time avg ${fmtUsd(allRange, 0)}`),
    tile("Today's avg vol ratio", todayRatio === null ? "–" : fmtRatio(todayRatio),
      "1.00× = same as recent normal", todayRatio !== null && todayRatio > 1.5 ? "down" : undefined),
    tile("⚡ Unusual moves", String(flaggedCount), `vol_ratio > ${VOL_FLAG_RATIO}× all-time`),
  ]));

  // --- daily averages table ---
  const byDay = {};
  for (const x of all) {
    const d = (byDay[x.date] ||= { ranges: [], ratios: [], n: 0, flagged: 0 });
    d.n++;
    if (x.priceRange !== null) d.ranges.push(x.priceRange);
    if (x.volRatio !== null) d.ratios.push(x.volRatio);
    if (x.flagged) d.flagged++;
  }
  const days = Object.keys(byDay).sort().reverse();
  const dayTable = el("table", { class: "data" });
  dayTable.innerHTML = "<thead><tr><th>Date (UTC)</th><th>Markets</th><th>Avg price range</th><th>Avg vol ratio</th><th>⚡ flagged</th></tr></thead>";
  const dayBody = el("tbody");
  days.forEach((d) => {
    const v = byDay[d];
    const ar = v.ranges.length ? v.ranges.reduce((a, b) => a + b, 0) / v.ranges.length : null;
    const at = v.ratios.length ? v.ratios.reduce((a, b) => a + b, 0) / v.ratios.length : null;
    const tr = el("tr");
    if (d === today) tr.className = "vol-today";
    tr.innerHTML =
      `<td>${d}${d === today ? " (today)" : ""}</td><td>${v.n}</td>` +
      `<td>${ar === null ? "–" : fmtUsd(ar, 0)}</td>` +
      `<td>${fmtRatio(at)}</td><td>${v.flagged || ""}</td>`;
    dayBody.appendChild(tr);
  });
  dayTable.appendChild(dayBody);
  panel.appendChild(el("h2", { style: "font-size:13px;margin:14px 0 4px" }, ["Daily averages"]));
  panel.appendChild(el("div", { class: "table-scroll" }, [dayTable]));

  // --- whipsaw leaderboard ---
  const whipsaw = all
    .filter((x) => x.probSamples >= 2)
    .sort((a, b) => (b.swingCount - a.swingCount) || (b.flipCount - a.flipCount) || ((b.volRatio || 0) - (a.volRatio || 0)))
    .slice(0, 10);
  const wsTable = el("table", { class: "data" });
  wsTable.innerHTML = "<thead><tr><th>Market (close)</th><th>Swings</th><th>Flips</th><th>Price range</th><th>Vol ratio</th><th>Result</th></tr></thead>";
  const wsBody = el("tbody");
  whipsaw.forEach((x) => {
    const tr = el("tr");
    if (x.flagged) tr.className = "vol-flagged-row";
    tr.innerHTML =
      `<td>${fmtTime(x.m.close_time)}</td><td>${x.swingCount}</td><td>${x.flipCount}</td>` +
      `<td>${x.priceRange === null ? "–" : fmtUsd(x.priceRange, 0)}</td>` +
      `<td>${fmtRatio(x.volRatio)}${volFlag(x.volRatio)}</td>` +
      `<td>${resultBadge(x.m.result)}</td>`;
    wsBody.appendChild(tr);
  });
  wsTable.appendChild(wsBody);
  panel.appendChild(el("h2", { style: "font-size:13px;margin:14px 0 4px" }, ["Whipsaw leaderboard — most zigzag markets"]));
  panel.appendChild(el("div", { class: "table-scroll" }, [wsTable]));

  return panel;
}

// ---------- Last-5 Volatility % ----------
// Percentile-composite volatility score. Each settled market is ranked against
// ALL chronologically-prior settled markets (expanding window, not a recent
// slice):
//   composite = 0.5*price_range_pct + 0.3*swing_pct + 0.2*flip_pct
// where each *_pct = % of prior markets with that metric <= this market's.
// Because a market's priors never change, its composite is immutable once
// computed — it's cached per ticker, so each refresh only scores markets that
// settled since the last one. Last-5 Volatility % = mean composite of the 5
// most recently closed scored markets.
const COMPOSITE_MIN_PRIOR = 10;  // don't rank against a thinner history
const VOL_BANDS = [
  { max: 35, cls: "calm", label: "Calm" },
  { max: 65, cls: "normal", label: "Normal" },
  { max: Infinity, cls: "elevated", label: "Elevated" },
];
const compositeCache = new Map();

function volBand(v) { return VOL_BANDS.find((b) => v <= b.max); }

function pctAtOrBelow(arr, v) {
  let n = 0;
  for (const e of arr) if (e <= v) n++;
  return (n / arr.length) * 100;
}

// Chronological list of scored markets: [{ x: volMetricsRecord, composite }].
function computeComposites(volMetrics) {
  const chrono = Array.from(volMetrics.values())
    .filter((x) => x.priceRange !== null && x.probSamples >= 2)
    .sort((a, b) => (Date.parse(a.m.close_time || 0) || 0) - (Date.parse(b.m.close_time || 0) || 0));
  const ranges = [], swings = [], flips = [];
  const scored = [];
  for (const x of chrono) {
    const key = marketKey(x.m);
    let comp;
    if (compositeCache.has(key)) {
      comp = compositeCache.get(key);
    } else {
      comp = ranges.length >= COMPOSITE_MIN_PRIOR
        ? 0.5 * pctAtOrBelow(ranges, x.priceRange)
        + 0.3 * pctAtOrBelow(swings, x.swingCount)
        + 0.2 * pctAtOrBelow(flips, x.flipCount)
        : null;
      compositeCache.set(key, comp);
    }
    if (comp !== null) scored.push({ x, composite: comp, close_time: x.m.close_time });
    ranges.push(x.priceRange);
    swings.push(x.swingCount);
    flips.push(x.flipCount);
  }
  return scored;
}

// Rolling mean of the trailing 5 composites, evaluated at each scored market.
function rollingLastFive(scored) {
  const out = [];
  for (let i = 4; i < scored.length; i++) {
    let s = 0;
    for (let j = i - 4; j <= i; j++) s += scored[j].composite;
    out.push({ close_time: scored[i].close_time, value: s / 5 });
  }
  return out;
}

// Sparkline of the rolling number over the last ~30 markets. De-emphasis line,
// band-colored dot on the current value, dashed refs at the 35/65 band edges.
function volSparkline(roll) {
  const pts = roll.slice(-30);
  const W = 300, H = 46, padT = 5, padB = 5;
  const wrap = el("div", { class: "vg-spark-wrap" });
  const svg = svgEl("svg", { class: "vg-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  wrap.appendChild(svg);
  const yAt = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const xAt = (i) => (pts.length <= 1 ? W / 2 : (i / (pts.length - 1)) * W);
  [35, 65].forEach((v) => {
    svg.appendChild(svgEl("line", { class: "grid", x1: 0, x2: W, y1: yAt(v), y2: yAt(v), "stroke-dasharray": "3 3" }));
  });
  let d = "";
  pts.forEach((p, i) => { d += (i ? "L" : "M") + xAt(i).toFixed(1) + "," + yAt(p.value).toFixed(1) + " "; });
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: "var(--text-muted)", "stroke-width": 2 }));
  const last = pts[pts.length - 1];
  svg.appendChild(svgEl("circle", { cx: xAt(pts.length - 1), cy: yAt(last.value), r: 3.5, fill: "var(--vg-band)" }));

  svg.addEventListener("mousemove", (evt) => {
    const rect = svg.getBoundingClientRect();
    let idx = Math.round(((evt.clientX - rect.left) / rect.width) * (pts.length - 1));
    idx = Math.max(0, Math.min(pts.length - 1, idx));
    const p = pts[idx];
    tooltipEl.innerHTML = `<div>${fmtTime(p.close_time)}</div><div>Last-5 volatility: <b>${p.value.toFixed(0)}</b></div>`;
    tooltipEl.style.display = "block";
    tooltipEl.style.left = evt.pageX + 14 + "px";
    tooltipEl.style.top = evt.pageY - 10 + "px";
  });
  svg.addEventListener("mouseleave", () => { tooltipEl.style.display = "none"; });
  return wrap;
}

// The gauge block: hero number + state chip + banded meter + trend sparkline.
// Used on both the Live tab and the Insights Volatility section.
function volGaugeBlock(volMetrics) {
  const scored = computeComposites(volMetrics);
  const roll = rollingLastFive(scored);
  const block = el("div", { class: "vol-gauge" });

  block.appendChild(el("div", { class: "vg-label" }, ["Last-5 Volatility"]));

  if (!roll.length) {
    block.appendChild(el("div", { class: "vg-value" }, ["–"]));
    block.appendChild(el("div", { class: "hint" }, [
      `Needs 5 scored markets to start (a market is scored once ${COMPOSITE_MIN_PRIOR}+ prior markets exist to rank it against). ${scored.length} scored so far.`,
    ]));
    return block;
  }

  const cur = roll[roll.length - 1].value;
  const band = volBand(cur);
  block.classList.add(band.cls);

  const row = el("div", { class: "vg-row" }, [
    el("div", { class: "vg-value" }, [String(Math.round(cur))]),
    el("div", { class: "vg-chip" }, [band.label]),
  ]);
  block.appendChild(row);

  // meter: band-colored fill on a lighter same-color track, notches at 35/65
  const meter = el("div", { class: "vg-meter" }, [
    el("div", { class: "vg-fill", style: `width:${Math.max(2, Math.min(100, cur))}%` }),
    el("div", { class: "vg-notch", style: "left:35%" }),
    el("div", { class: "vg-notch", style: "left:65%" }),
  ]);
  block.appendChild(meter);

  block.appendChild(volSparkline(roll));
  block.appendChild(el("div", { class: "hint" }, [
    `Average percentile-composite of the last 5 settled markets (0 = calmest in history, 100 = wildest) · trend over the last ${Math.min(30, roll.length)} markets · ${scored.length} markets scored. Under 35 = calm, 35–65 = normal, over 65 = elevated.`,
  ]));
  return block;
}

function goldenRulePanel(withDiff) {
  const gr = computeGoldenRule(withDiff);
  const correct = gr.filter((x) => x.correct).length;
  const acc = gr.length ? (correct / gr.length) * 100 : null;
  const smallest = gr.length ? Math.min(...gr.map((x) => x.gap)) : null;

  const panel = el("div", { class: "panel" }, [
    el("h2", {}, ["Golden Rule Tracker"]),
    el("div", { class: "desc" }, [
      "A market qualifies when BTC's gap from the target is ≥ $50 and still holding in the last 3 minutes before close (any diff sample at minute ≥ 12 with |gap| ≥ $50). The predicted side is the gap's direction; it's a hit if that matches the result.",
    ]),
  ]);

  if (!gr.length) {
    panel.appendChild(el("div", { class: "empty-state" }, [
      `No qualifying markets yet among the ${withDiff.length} with BTC-vs-target gap samples. This fills in as more markets are caught live near close.`,
    ]));
    return panel;
  }

  panel.appendChild(el("div", { class: "tiles" }, [
    tile("Qualifying markets", String(gr.length), "all-time"),
    tile("Accuracy", acc === null ? "–" : fmtPct(acc, 1), `${correct} correct of ${gr.length}`, acc >= 50 ? "up" : "down"),
    tile("Closest call", smallest === null ? "–" : fmtUsd(smallest, 2), "smallest gap that ever qualified"),
  ]));

  // gap-size distribution
  const buckets = [["$50–100", 50, 100], ["$100–200", 100, 200], ["$200–400", 200, 400], ["$400+", 400, Infinity]];
  panel.appendChild(el("h2", { style: "font-size:13px;margin:14px 0 4px" }, ["Gap-size distribution"]));
  panel.appendChild(el("div", { class: "tiles" },
    buckets.map(([label, lo, hi]) => tile(label, String(gr.filter((x) => x.gap >= lo && x.gap < hi).length), "markets"))
  ));

  // per-day breakdown
  const byDay = {};
  for (const x of gr) { (byDay[x.date] ||= { n: 0, c: 0 }); byDay[x.date].n++; if (x.correct) byDay[x.date].c++; }
  const days = Object.keys(byDay).sort().reverse();
  const table = el("table", { class: "data" });
  table.innerHTML = "<thead><tr><th>Date (UTC)</th><th>Qualifying</th><th>Correct</th><th>Accuracy</th></tr></thead>";
  const tbody = el("tbody");
  days.forEach((d) => {
    const { n, c } = byDay[d];
    const tr = el("tr");
    tr.innerHTML = `<td>${d}</td><td>${n}</td><td>${c}</td><td>${fmtPct(c / n * 100, 0)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.appendChild(el("h2", { style: "font-size:13px;margin:14px 0 4px" }, ["Per-day breakdown"]));
  panel.appendChild(el("div", { class: "table-scroll" }, [table]));
  return panel;
}

function comebacksPanel(withTl, volMetrics) {
  const cb = computeComebacks(withTl);
  const rate = withTl.length ? (cb.length / withTl.length) * 100 : null;
  const volOf = (m) => (volMetrics && volMetrics.get(marketKey(m))) || null;

  const panel = el("div", { class: "panel" }, [
    el("h2", {}, ["Comebacks Tracker"]),
    el("div", { class: "desc" }, [
      "Markets where one side reached ≥ 85% (or the other ≤ 15%) before the final minute, but the opposite side still won. Rate is over the markets that have sampled in-market odds.",
    ]),
  ]);

  panel.appendChild(el("div", { class: "tiles" }, [
    tile("Comebacks", String(cb.length), "all-time"),
    tile("Rate", rate === null ? "–" : fmtPct(rate, 1), `of ${withTl.length} markets with odds`),
  ]));

  if (!cb.length) {
    panel.appendChild(el("div", { class: "empty-state" }, ["No comebacks found yet — no market swung from an ≥85% favorite to a loss."]));
    return panel;
  }

  const table = el("table", { class: "data" });
  table.innerHTML =
    "<thead><tr><th>When (close)</th><th>Favored</th><th>Peak odds</th><th>Min left</th><th>Gap @ peak</th><th>Gap @ close</th><th>Winner</th><th>Swings</th><th>Vol ratio</th></tr></thead>";
  const tbody = el("tbody");
  cb.forEach((x) => {
    const tr = el("tr");
    const favLabel = x.favored === "yes" ? '<span class="up">UP</span>' : '<span class="down">DOWN</span>';
    const gapAt = x.gapAtExtreme === null ? "–" : (x.gapAtExtreme >= 0 ? "+" : "") + fmtUsd(x.gapAtExtreme, 0);
    const gapClose = x.gapAtClose === null ? "–" : (x.gapAtClose >= 0 ? "+" : "") + fmtUsd(x.gapAtClose, 0);
    const vol = volOf(x.m);
    if (vol && vol.flagged) tr.className = "vol-flagged-row";
    tr.innerHTML =
      `<td>${fmtTime(x.m.close_time)}</td>` +
      `<td>${favLabel}</td>` +
      `<td>${fmtPct(x.favoredPct, 0)}</td>` +
      `<td>${x.minutesLeft}</td>` +
      `<td>${gapAt}</td>` +
      `<td>${gapClose}</td>` +
      `<td>${resultBadge(x.result)}</td>` +
      `<td>${vol ? vol.swingCount : "–"}</td>` +
      `<td>${vol ? fmtRatio(vol.volRatio) + volFlag(vol.volRatio) : "–"}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.appendChild(el("div", { class: "table-scroll" }, [table]));
  return panel;
}

function renderInsights(root, data) {
  const markets = (data.insight_markets && data.insight_markets.length
    ? data.insight_markets
    : (data.recent_markets || []).map((r) => ({
        close_time: r.close_time, result: r.result, volume: r.volume_max,
        timeline: r.prob_timeline || [], diff_timeline: r.diff_timeline || [],
      }))
  ).filter((m) => m.result === "yes" || m.result === "no");

  const withTl = markets.filter((m) => (m.timeline || []).length >= 1);
  const withDiff = markets.filter((m) => (m.diff_timeline || []).length >= 1);
  const sm = data.summary || {};

  root.appendChild(el("div", { class: "panel" }, [
    el("h2", {}, ["What is this?"]),
    el("div", { class: "desc" }, [
      `Pattern statistics computed automatically from every market this tracker has recorded (${markets.length} settled so far, ${withTl.length} with sampled in-market odds, ${withDiff.length} with BTC-vs-target gaps). ` +
      `Odds and price are sampled about every 2 minutes by the collector while GitHub Actions publishes updates roughly every 5 minutes, so each 15-minute market usually has 6–8 readings — patterns get sharper as more data accumulates.`,
    ]),
  ]));

  // --- headline trackers (auto-computed from timelines) ---
  const volMetrics = computeVolMetrics(data);
  root.appendChild(goldenRulePanel(withDiff));
  root.appendChild(goldenRuleV2Panel(withDiff));
  root.appendChild(comebacksPanel(withTl, volMetrics));
  root.appendChild(volatilityPanel(volMetrics));

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

  // --- price-gap explorer (BTC vs Kalshi target, in $) ---
  const gapInput = el("input", { type: "range", min: "5", max: "150", step: "5", value: "80" });
  const gapMinInput = el("input", { type: "range", min: "1", max: "14", step: "1", value: "6" });
  const gapWindowSel = el("select", { class: "combo" });
  gapWindowSel.appendChild(el("option", { value: "first" }, ["in the first N min"]));
  gapWindowSel.appendChild(el("option", { value: "last" }, ["in the last N min"]));
  const gapOut = el("output", {}, ["$80"]);
  const gapMinOut = el("output", {}, ["6 min"]);
  const gapUp = el("div", { class: "big-insight" });
  const gapDown = el("div", { class: "big-insight" });

  function refreshGap() {
    const G = parseInt(gapInput.value, 10);
    const M = parseInt(gapMinInput.value, 10);
    const mode = gapWindowSel.value;
    gapOut.textContent = "$" + G;
    gapMinOut.textContent = M + " min";
    const windowLabel = mode === "last" ? `in the last <b>${M} min</b>` : `within the first <b>${M} min</b>`;
    const upSig = computeDiffSignal(withDiff, G, M, mode, "up");
    const downSig = computeDiffSignal(withDiff, G, M, mode, "down");
    gapUp.innerHTML = upSig.fired === 0
      ? `No market yet had BTC ≥ <b>$${G}</b> above target ${windowLabel}.`
      : `When BTC was <b>≥ $${G} above</b> the target ${windowLabel}, <span class="up"><b>UP won ${upSig.won} of ${upSig.fired}</b></span> (<b>${(upSig.won / upSig.fired * 100).toFixed(0)}%</b>).`;
    gapDown.innerHTML = downSig.fired === 0
      ? `No market yet had BTC ≥ <b>$${G}</b> below target ${windowLabel}.`
      : `When BTC was <b>≥ $${G} below</b> the target ${windowLabel}, <span class="down"><b>DOWN won ${downSig.won} of ${downSig.fired}</b></span> (<b>${(downSig.won / downSig.fired * 100).toFixed(0)}%</b>).`;
  }
  gapInput.addEventListener("input", refreshGap);
  gapMinInput.addEventListener("input", refreshGap);
  gapWindowSel.addEventListener("change", refreshGap);

  const gapPanel = el("div", { class: "panel" }, [
    el("h2", {}, ["Price-Gap Explorer"]),
    el("div", { class: "desc" }, ["How far BTC's spot price sat above/below the Kalshi target, and whether the market then resolved that way. e.g. “when BTC was $80 above target in the first 6 min, how often did UP win?”"]),
    el("div", { class: "range-row" }, [el("label", {}, ["Gap from target ($)"]), gapInput, gapOut]),
    el("div", { class: "range-row" }, [el("label", {}, ["Minutes"]), gapMinInput, gapMinOut]),
    el("div", { class: "range-row" }, [el("label", {}, ["Window"]), gapWindowSel]),
    gapUp,
    gapDown,
  ]);
  if (withDiff.length === 0) {
    gapPanel.appendChild(el("div", { class: "empty-state" }, [
      "No BTC-vs-target gap data yet — this fills in as the collector records spot price alongside each market (needs runs from the updated collector).",
    ]));
  }
  root.appendChild(gapPanel);

  // --- auto headline stats ---
  const stat = (arr, pred) => arr.filter(pred).length;

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
  refreshGap();
}

// ---------- tabs ----------
// Tab names are read from the DOM so self-contained tabs (export) are
// covered automatically, and activateTab is authoritative over EVERY panel --
// switching away from any tab hides it, with no hardcoded list to keep in sync.
const DEFAULT_TAB = "live";
function tabNames() {
  return Array.from(document.querySelectorAll(".tab")).map((b) => b.dataset.tab);
}
function currentTab() {
  const h = location.hash.replace("#", "");
  return tabNames().includes(h) ? h : DEFAULT_TAB;
}
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
}
function initTabs() {
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => { location.hash = b.dataset.tab; });
  });
  window.addEventListener("hashchange", () => activateTab(currentTab()));
  activateTab(currentTab());
}

// ---------- boot ----------
function clearPanel(id) {
  document.getElementById(id).replaceChildren();
}

async function loadAndRender() {
  // Fetch BEFORE clearing: blanking the tabs first left the page empty for the
  // whole fetch duration on every 60s refresh (a visible flicker, and the
  // calculator vanished mid-typing).
  let data = null;
  try {
    const res = await fetch("data.json?ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    data = null;
  }

  clearPanel("tab-live");
  clearPanel("tab-insights");
  clearPanel("tab-calculator");

  if (!data) {
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

async function main() {
  initTabs();
  await loadAndRender();
  setInterval(loadAndRender, DATA_REFRESH_MS);
}

main();
