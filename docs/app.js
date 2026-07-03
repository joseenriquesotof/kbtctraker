const SVG_NS = "http://www.w3.org/2000/svg";
const VB_W = 1000;
const tooltipEl = document.getElementById("tooltip");

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

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ---- generic line chart with crosshair tooltip ----
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
    wrap.appendChild(el("div", { class: "empty-state" }, [document.createTextNode("Not enough data yet.")]));
    return wrap;
  }
  let yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.1;
  yMin -= pad; yMax += pad;

  const n = timestamps.length;
  const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // gridlines
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

  // reference lines (e.g. 50%)
  refLines.forEach((r) => {
    const y = yAt(r.value);
    svg.appendChild(svgEl("line", { class: "ref-line", x1: padL, x2: VB_W - padR, y1: y, y2: y }));
    const label = svgEl("text", { class: "axis-label", x: VB_W - padR, y: y - 4, "text-anchor": "end" });
    label.textContent = r.label || "";
    svg.appendChild(label);
  });

  // x-axis ticks: first, middle, last
  [0, Math.floor((n - 1) / 2), n - 1].forEach((i) => {
    if (i < 0 || i >= n) return;
    const label = svgEl("text", { class: "axis-label", x: xAt(i), y: height - 4, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" });
    label.textContent = fmtClock(timestamps[i]);
    svg.appendChild(label);
  });

  // series paths (break on null)
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
  });

  // crosshair + tooltip
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

// ---- volume bar chart ----
function barChart(items, height = 200) {
  const wrap = el("div", { class: "chart-wrap" });
  const svg = svgEl("svg", { class: "chart-svg", viewBox: `0 0 ${VB_W} ${height}`, preserveAspectRatio: "none" });
  wrap.appendChild(svg);
  if (items.length === 0) {
    wrap.appendChild(el("div", { class: "empty-state" }, [document.createTextNode("Not enough data yet.")]));
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

function renderTiles(data) {
  const c = data.current;
  const tiles = [];
  const tile = (label, value, sub = "", cls = "") =>
    el("div", { class: "tile" }, [
      el("div", { class: "label" }, [document.createTextNode(label)]),
      el("div", { class: `value ${cls}` }, [document.createTextNode(value)]),
      sub ? el("div", { class: "sub" }, [document.createTextNode(sub)]) : el("span"),
    ]);

  if (!c) {
    return el("div", { class: "empty-state" }, [document.createTextNode("No active market data yet — waiting for the next collector run.")]);
  }
  tiles.push(tile("BTC Spot Price", fmtUsd(c.btc_spot_usd, 0)));
  tiles.push(tile("Kalshi Target (Strike)", fmtUsd(c.strike, 0), c.title || ""));
  const dist = c.distance_to_strike_pct;
  tiles.push(tile("Distance to Target", dist === null ? "–" : (dist >= 0 ? "+" : "") + dist.toFixed(3) + "%", "", dist >= 0 ? "up" : "down"));
  tiles.push(tile("Time Remaining", fmtDuration(c.seconds_remaining), `closes ${fmtClock(c.close_time)}`));
  const yp = c.yes_prob_last;
  tiles.push(tile("YES (Up) Probability", yp === null ? "–" : fmtPct(yp), yp === null ? "" : `NO: ${fmtPct(100 - yp)}`));
  tiles.push(tile("Volume", c.volume_max === null || c.volume_max === undefined ? "–" : Math.round(c.volume_max).toLocaleString(), "contracts"));

  const grid = el("div", { class: "tiles" }, tiles);
  return grid;
}

function renderSummary(data) {
  const s = data.summary;
  const tile = (label, value, sub = "") =>
    el("div", { class: "tile" }, [
      el("div", { class: "label" }, [document.createTextNode(label)]),
      el("div", { class: "value" }, [document.createTextNode(value)]),
      sub ? el("div", { class: "sub" }, [document.createTextNode(sub)]) : el("span"),
    ]);
  const tiles = [
    tile("Markets Tracked", String(s.total_markets_tracked), `${s.settled_count} settled`),
    tile("UP win rate", s.up_win_rate_pct === null ? "–" : fmtPct(s.up_win_rate_pct), `${s.up_wins} up / ${s.down_wins} down`),
    tile("Time leaning YES", s.pct_time_yes_leaning === null ? "–" : fmtPct(s.pct_time_yes_leaning), s.pct_time_no_leaning === null ? "" : `NO: ${fmtPct(s.pct_time_no_leaning)}`),
    tile("Current streak", s.current_streak && s.current_streak.result ? `${s.current_streak.length} × ${s.current_streak.result.toUpperCase()}` : "–"),
    tile("Longest streak", s.longest_streak && s.longest_streak.result ? `${s.longest_streak.length} × ${s.longest_streak.result.toUpperCase()}` : "–"),
    tile("Avg volume / market", s.avg_volume === null ? "–" : Math.round(s.avg_volume).toLocaleString()),
  ];
  return el("div", { class: "tiles" }, tiles);
}

function renderTable(data) {
  const rows = data.recent_markets || [];
  if (rows.length === 0) {
    return el("div", { class: "empty-state" }, [document.createTextNode("No settled markets recorded yet.")]);
  }
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
    tr.innerHTML = `
      <td>${fmtTime(r.close_time)}</td>
      <td>${fmtUsd(r.strike, 0)}</td>
      <td>${resultBadge(r.result)}</td>
      <td>${r.volume_max !== null && r.volume_max !== undefined ? Math.round(r.volume_max).toLocaleString() : "–"}</td>
      <td>${fmtPct(r.yes_prob_min)} – ${fmtPct(r.yes_prob_max)}</td>
      <td>${yesPct === null ? "–" : fmtPct(yesPct)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return el("div", { class: "table-scroll" }, [table]);
}

function legend(items) {
  return el("div", { class: "legend" }, items.map((it) =>
    el("div", { class: "item" }, [
      el("span", { class: "swatch", style: `background:${it.color}` }),
      document.createTextNode(it.label),
    ])
  ));
}

async function main() {
  let data;
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    document.getElementById("content").appendChild(
      el("div", { class: "empty-state" }, [document.createTextNode(
        "data.json not found yet. Once the collector workflow runs at least once, this page will populate automatically."
      )])
    );
    document.getElementById("updated").textContent = "";
    return;
  }

  document.getElementById("updated").textContent = "Updated " + fmtTime(data.generated_at);

  const content = document.getElementById("content");
  content.appendChild(renderTiles(data));

  const s = data.series || {};
  const timestamps = s.timestamps || [];

  const priceCard = el("div", { class: "panel" }, [
    el("h2", {}, [document.createTextNode("BTC Spot Price vs. Kalshi Target")]),
    el("div", { class: "desc" }, [document.createTextNode("Last ~24h. The target (strike) is the price Kalshi's current 15-minute contract settles against.")]),
    legend([{ color: "var(--series-blue)", label: "BTC spot (USD)" }, { color: "var(--series-red)", label: "Kalshi target (USD)" }]),
    lineChart({
      timestamps,
      series: [
        { name: "BTC spot", color: "#2a78d6", points: s.btc_usd || [] },
        { name: "Target", color: "#e34948", points: s.strike_usd || [] },
      ],
      yFormat: (v) => fmtUsd(v, 0),
      yTickFormat: (v) => "$" + Math.round(v).toLocaleString(),
    }),
  ]);
  content.appendChild(priceCard);

  const grid2 = el("div", { class: "grid-2" });
  const probCard = el("div", { class: "panel" }, [
    el("h2", {}, [document.createTextNode("YES (Up) Probability")]),
    el("div", { class: "desc" }, [document.createTextNode("Implied probability the active contract settles YES, from Kalshi's live order book.")]),
    legend([{ color: "var(--series-blue)", label: "YES probability (%)" }]),
    lineChart({
      timestamps,
      series: [{ name: "YES %", color: "#2a78d6", points: s.yes_prob_pct || [] }],
      refLines: [{ value: 50, label: "50%" }],
      yFormat: (v) => fmtPct(v),
      yTickFormat: (v) => Math.round(v) + "%",
    }),
  ]);
  const volCard = el("div", { class: "panel" }, [
    el("h2", {}, [document.createTextNode("BTC Volatility")]),
    el("div", { class: "desc" }, [document.createTextNode("Rolling stdev of 5-min log returns (%) — higher means faster, choppier price moves.")]),
    legend([{ color: "var(--series-blue)", label: "Rolling stdev (%)" }]),
    lineChart({
      timestamps,
      series: [{ name: "Volatility", color: "#2a78d6", points: s.volatility_pct || [] }],
      yFormat: (v) => (v === null ? "–" : v.toFixed(3) + "%"),
      yTickFormat: (v) => v.toFixed(3) + "%",
    }),
  ]);
  grid2.appendChild(probCard);
  grid2.appendChild(volCard);
  content.appendChild(grid2);

  const volumeItems = (data.recent_markets || []).slice(0, 20).reverse().map((r) => ({
    label: `${fmtTime(r.close_time)} · ${fmtUsd(r.strike, 0)} · ${r.result === "yes" ? "UP" : "DOWN"}`,
    value: r.volume_max || 0,
    color: r.result === "yes" ? "var(--series-blue)" : "var(--series-red)",
  }));
  const volumeCard = el("div", { class: "panel" }, [
    el("h2", {}, [document.createTextNode("Volume per Market")]),
    el("div", { class: "desc" }, [document.createTextNode("Contracts traded in each of the last 20 settled 15-minute markets.")]),
    legend([{ color: "var(--series-blue)", label: "Settled UP" }, { color: "var(--series-red)", label: "Settled DOWN" }]),
    barChart(volumeItems),
  ]);
  content.appendChild(volumeCard);

  const summaryCard = el("div", { class: "panel" }, [
    el("h2", {}, [document.createTextNode("All-Time Summary")]),
    renderSummary(data),
  ]);
  content.appendChild(summaryCard);

  const tableCard = el("div", { class: "panel" }, [
    el("h2", {}, [document.createTextNode("Recent Settled Markets")]),
    renderTable(data),
  ]);
  content.appendChild(tableCard);
}

main();
