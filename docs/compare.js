(function () {
  if (typeof renderCompare === "function") return;

  const DATA_URLS = [
    window.KBTC_DATA_URL || "https://kbtctrackw.jose-soto8.workers.dev/",
    "data.json",
  ];
  let compareData = null;

  function compareMarkets(data) {
    const byKey = new Map();
    (data.recent_markets || []).forEach((m) => {
      const key = m.ticker || m.close_time;
      if (key) byKey.set(key, m);
    });
    (data.insight_markets || []).forEach((m, i) => {
      const key = m.ticker || m.close_time || "insight-" + i;
      if (!byKey.has(key)) {
        byKey.set(key, {
          ...m,
          ticker: key,
          volume_max: m.volume,
          prob_timeline: m.timeline || m.prob_timeline || [],
        });
      }
    });
    return Array.from(byKey.values())
      .filter((m) => (m.prob_timeline || m.timeline || []).length || m.open_time || m.close_time)
      .sort((a, b) => Date.parse(b.open_time || b.close_time || 0) - Date.parse(a.open_time || a.close_time || 0));
  }

  function marketName(m) {
    const start = m.open_time ? fmtTime(m.open_time) : "Market";
    const end = m.close_time ? fmtClock(m.close_time) : "";
    const result = m.result === "yes" ? "UP" : m.result === "no" ? "DOWN" : "open";
    return `${start}${end ? " - " + end : ""} | ${result} | ${fmtUsd(m.strike, 0)}`;
  }

  function marketAnalysis(m) {
    const timeline = (m.prob_timeline || m.timeline || [])
      .filter((pt) => pt && pt.length >= 2 && pt[1] !== null && pt[1] !== undefined)
      .map((pt) => [Number(pt[0]), Number(pt[1])])
      .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
      .sort((a, b) => a[0] - b[0]);
    const diffTimeline = (m.diff_timeline || [])
      .filter((pt) => pt && pt.length >= 2 && pt[1] !== null && pt[1] !== undefined)
      .map((pt) => [Number(pt[0]), Number(pt[1])])
      .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
      .sort((a, b) => a[0] - b[0]);

    let yesSeconds = 0;
    let noSeconds = 0;
    for (let i = 0; i < timeline.length - 1; i++) {
      const dt = Math.max(0, Math.min((timeline[i + 1][0] - timeline[i][0]) * 60, 900));
      if (timeline[i][1] > 50) yesSeconds += dt;
      else if (timeline[i][1] < 50) noSeconds += dt;
    }
    if (yesSeconds === 0 && noSeconds === 0) {
      yesSeconds = m.yes_leaning_seconds || 0;
      noSeconds = m.no_leaning_seconds || 0;
    }

    const probs = timeline.map((pt) => pt[1]);
    const edges = probs.map((p) => 2 * p - 100);
    const diffs = diffTimeline.map((pt) => pt[1]);
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const min = (arr) => arr.length ? Math.min(...arr) : null;
    const max = (arr) => arr.length ? Math.max(...arr) : null;
    const first = (arr) => arr.length ? arr[0] : null;
    const last = (arr) => arr.length ? arr[arr.length - 1] : null;

    let leadChanges = 0;
    let prevLead = null;
    probs.forEach((p) => {
      const lead = p > 50 ? "yes" : p < 50 ? "no" : "tie";
      if (prevLead && lead !== "tie" && prevLead !== "tie" && lead !== prevLead) leadChanges++;
      if (lead !== "tie") prevLead = lead;
    });

    return {
      m,
      timeline,
      diffTimeline,
      yesSeconds,
      noSeconds,
      sampledSeconds: yesSeconds + noSeconds,
      firstYes: first(probs),
      lastYes: last(probs),
      minYes: min(probs),
      maxYes: max(probs),
      swing: probs.length ? max(probs) - min(probs) : null,
      avgEdge: avg(edges),
      lastEdge: last(edges),
      minDiff: min(diffs),
      maxDiff: max(diffs),
      lastDiff: last(diffs),
      leadChanges,
    };
  }

  function fmtSignedPct(v, digits = 1) {
    if (v === null || v === undefined || Number.isNaN(v)) return "-";
    return (v > 0 ? "+" : "") + v.toFixed(digits) + " pts";
  }

  function fmtSignedUsd(v, digits = 0) {
    if (v === null || v === undefined || Number.isNaN(v)) return "-";
    return (v > 0 ? "+" : "") + fmtUsd(v, digits);
  }

  function fmtSignedDuration(sec) {
    if (sec === null || sec === undefined || Number.isNaN(sec)) return "-";
    const sign = sec > 0 ? "+" : sec < 0 ? "-" : "";
    return sign + fmtDuration(Math.abs(sec));
  }

  function compareDelta(a, b, key, formatter) {
    const av = a[key], bv = b[key];
    if (av === null || av === undefined || bv === null || bv === undefined) return "-";
    return formatter(av - bv);
  }

  function compareRow(label, aText, bText, deltaText = "-") {
    const tr = el("tr");
    tr.innerHTML = `<td>${label}</td><td>${aText}</td><td>${bText}</td><td>${deltaText}</td>`;
    return tr;
  }

  function pointsByMinute(timeline) {
    const points = Array(16).fill(null);
    (timeline || []).forEach(([minute, value]) => {
      const idx = Math.max(0, Math.min(15, Math.round(minute)));
      points[idx] = value;
    });
    return points;
  }

  async function loadCompareData() {
    let lastError = null;
    for (const url of DATA_URLS) {
      try {
        const sep = url.includes("?") ? "&" : "?";
        const res = await fetch(url + sep + "ts=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error(res.status);
        return await res.json();
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("No data source loaded");
  }

  function activateCompareIfNeeded() {
    if (location.hash.replace("#", "") !== "compare") return;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === "compare"));
    document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.id !== "tab-compare"; });
  }

  function renderCompareTab(data) {
    const root = document.getElementById("tab-compare");
    if (!root) return;
    root.replaceChildren();
    const markets = compareMarkets(data);
    if (markets.length < 2) {
      root.appendChild(el("div", { class: "empty-state" }, ["At least two recorded markets are needed before Compare can show side-by-side behavior."]));
      return;
    }

    const selectA = el("select", { class: "combo", id: "compare-a" });
    const selectB = el("select", { class: "combo", id: "compare-b" });
    markets.forEach((m, i) => {
      const value = m.ticker || m.close_time || String(i);
      selectA.appendChild(el("option", { value }, [marketName(m)]));
      selectB.appendChild(el("option", { value }, [marketName(m)]));
    });
    selectB.selectedIndex = 1;

    const output = el("div", { class: "compare-output" });
    const marketByValue = new Map(markets.map((m, i) => [m.ticker || m.close_time || String(i), m]));

    function refreshCompare() {
      output.replaceChildren();
      const a = marketAnalysis(marketByValue.get(selectA.value) || markets[0]);
      const b = marketAnalysis(marketByValue.get(selectB.value) || markets[1]);

      output.appendChild(el("div", { class: "compare-heading" }, [
        el("div", {}, [el("div", { class: "compare-kicker" }, ["Market A"]), el("h2", {}, [marketName(a.m)])]),
        el("div", {}, [el("div", { class: "compare-kicker" }, ["Market B"]), el("h2", {}, [marketName(b.m)])]),
      ]));

      output.appendChild(el("div", { class: "tiles" }, [
        tile("A: YES above NO", fmtDuration(a.yesSeconds), `${a.sampledSeconds ? fmtPct(a.yesSeconds / a.sampledSeconds * 100) : "-"} of sampled time`, "up"),
        tile("B: YES above NO", fmtDuration(b.yesSeconds), `${b.sampledSeconds ? fmtPct(b.yesSeconds / b.sampledSeconds * 100) : "-"} of sampled time`, "up"),
        tile("A: YES-NO edge", fmtSignedPct(a.avgEdge), `last ${fmtSignedPct(a.lastEdge)}`),
        tile("B: YES-NO edge", fmtSignedPct(b.avgEdge), `last ${fmtSignedPct(b.lastEdge)}`),
        tile("A: BTC vs target", fmtSignedUsd(a.lastDiff, 2), `range ${fmtSignedUsd(a.minDiff, 0)} to ${fmtSignedUsd(a.maxDiff, 0)}`),
        tile("B: BTC vs target", fmtSignedUsd(b.lastDiff, 2), `range ${fmtSignedUsd(b.minDiff, 0)} to ${fmtSignedUsd(b.maxDiff, 0)}`),
      ]));

      const minuteLabels = Array.from({ length: 16 }, (_, i) => new Date(Date.UTC(2000, 0, 1, 0, i)).toISOString());
      output.appendChild(el("div", { class: "grid-2" }, [
        el("div", { class: "panel" }, [
          el("h2", {}, ["YES Probability Over The 15 Minutes"]),
          el("div", { class: "desc" }, ["Both markets are aligned by minute since market open. Above 50 means YES/UP was ahead."]),
          legend([{ color: "var(--series-blue)", label: "Market A YES" }, { color: "var(--series-red)", label: "Market B YES" }]),
          lineChart({
            timestamps: minuteLabels,
            series: [
              { name: "Market A YES", color: "var(--series-blue)", points: pointsByMinute(a.timeline) },
              { name: "Market B YES", color: "var(--series-red)", points: pointsByMinute(b.timeline) },
            ],
            refLines: [{ value: 50, label: "50" }],
            yFormat: (v) => fmtPct(v),
            yTickFormat: (v) => Math.round(v) + "",
          }),
        ]),
        el("div", { class: "panel" }, [
          el("h2", {}, ["BTC Price Gap From Target"]),
          el("div", { class: "desc" }, ["Positive means BTC was above the market target; negative means below."]),
          legend([{ color: "var(--series-blue)", label: "Market A gap" }, { color: "var(--series-red)", label: "Market B gap" }]),
          lineChart({
            timestamps: minuteLabels,
            series: [
              { name: "Market A gap", color: "var(--series-blue)", points: pointsByMinute(a.diffTimeline) },
              { name: "Market B gap", color: "var(--series-red)", points: pointsByMinute(b.diffTimeline) },
            ],
            refLines: [{ value: 0, label: "$0" }],
            yFormat: (v) => fmtSignedUsd(v, 2),
            yTickFormat: (v) => "$" + Math.round(v),
          }),
        ]),
      ]));

      const table = el("table", { class: "data compare-table" });
      table.innerHTML = "<thead><tr><th>Metric</th><th>Market A</th><th>Market B</th><th>A - B</th></tr></thead>";
      const tbody = el("tbody");
      tbody.appendChild(compareRow("Result", resultBadge(a.m.result), resultBadge(b.m.result), a.m.result === b.m.result ? "same" : "different"));
      tbody.appendChild(compareRow("Target", fmtUsd(a.m.strike, 2), fmtUsd(b.m.strike, 2), a.m.strike != null && b.m.strike != null ? fmtSignedUsd(a.m.strike - b.m.strike, 2) : "-"));
      tbody.appendChild(compareRow("Volume", fmtNum(a.m.volume_max), fmtNum(b.m.volume_max), fmtNum((a.m.volume_max || 0) - (b.m.volume_max || 0))));
      tbody.appendChild(compareRow("YES first sample", fmtPct(a.firstYes), fmtPct(b.firstYes), compareDelta(a, b, "firstYes", fmtSignedPct)));
      tbody.appendChild(compareRow("YES last sample", fmtPct(a.lastYes), fmtPct(b.lastYes), compareDelta(a, b, "lastYes", fmtSignedPct)));
      tbody.appendChild(compareRow("YES min / max", `${fmtPct(a.minYes)} / ${fmtPct(a.maxYes)}`, `${fmtPct(b.minYes)} / ${fmtPct(b.maxYes)}`, compareDelta(a, b, "swing", fmtSignedPct)));
      tbody.appendChild(compareRow("Average YES-NO edge", fmtSignedPct(a.avgEdge), fmtSignedPct(b.avgEdge), compareDelta(a, b, "avgEdge", fmtSignedPct)));
      tbody.appendChild(compareRow("YES above NO", fmtDuration(a.yesSeconds), fmtDuration(b.yesSeconds), fmtSignedDuration(a.yesSeconds - b.yesSeconds)));
      tbody.appendChild(compareRow("NO above YES", fmtDuration(a.noSeconds), fmtDuration(b.noSeconds), fmtSignedDuration(a.noSeconds - b.noSeconds)));
      tbody.appendChild(compareRow("Lead changes", String(a.leadChanges), String(b.leadChanges), String(a.leadChanges - b.leadChanges)));
      tbody.appendChild(compareRow("BTC gap range", `${fmtSignedUsd(a.minDiff, 0)} to ${fmtSignedUsd(a.maxDiff, 0)}`, `${fmtSignedUsd(b.minDiff, 0)} to ${fmtSignedUsd(b.maxDiff, 0)}`, "-"));
      table.appendChild(tbody);
      output.appendChild(el("div", { class: "panel" }, [
        el("h2", {}, ["Side-By-Side Details"]),
        el("div", { class: "table-scroll" }, [table]),
      ]));
    }

    selectA.addEventListener("change", refreshCompare);
    selectB.addEventListener("change", refreshCompare);

    root.appendChild(el("div", { class: "panel" }, [
      el("h2", {}, ["Compare Markets"]),
      el("div", { class: "desc" }, ["Pick two specific 15-minute markets and compare how their UP/DOWN prices behaved through the window."]),
      el("div", { class: "compare-picker" }, [
        el("div", { class: "field" }, [el("label", { for: "compare-a" }, ["Market A"]), selectA]),
        el("div", { class: "field" }, [el("label", { for: "compare-b" }, ["Market B"]), selectB]),
      ]),
    ]));
    root.appendChild(output);
    refreshCompare();
  }

  async function refreshCompareTab() {
    const root = document.getElementById("tab-compare");
    if (!root) return;
    try {
      compareData = compareData || await loadCompareData();
      renderCompareTab(compareData);
    } catch (e) {
      root.replaceChildren(el("div", { class: "empty-state" }, ["Compare data is not available yet."]));
    }
  }

  const tabButton = document.querySelector('[data-tab="compare"]');
  if (tabButton) tabButton.addEventListener("click", () => { location.hash = "compare"; });
  window.addEventListener("hashchange", () => {
    activateCompareIfNeeded();
    if (location.hash.replace("#", "") === "compare") refreshCompareTab();
  });
  if (location.hash.replace("#", "") === "compare") {
    activateCompareIfNeeded();
    refreshCompareTab();
  }
})();
