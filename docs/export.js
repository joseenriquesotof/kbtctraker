// Export tab: pull the collected KXBTC15M data out as JSON or CSV so it can be
// dropped into any AI / spreadsheet for analysis. Self-contained like compare.js
// -- reuses the global helpers from app.js (el, fmtTime, fmtClock, fmtUsd).
(function () {
  // Idempotency guard on a window flag -- guarding on the inner function name
  // would be self-defeating, since function declarations hoist inside the IIFE.
  if (window.__kbtcExportInit) return;
  window.__kbtcExportInit = true;

  const DATA_URLS = [
    window.KBTC_DATA_URL || "https://kbtctrackw.jose-soto8.workers.dev/",
    "data.json",
  ];
  const PREVIEW_LIMIT = 200000; // chars shown in the textarea; downloads are full

  let exportData = null;
  let built = false;

  // ---- data helpers ----

  // Merge every market we know about (recent settled + full insight history +
  // the current live one), richest record wins, newest first.
  function allMarkets(data) {
    const byKey = new Map();
    (data.recent_markets || []).forEach((m) => { if (m && m.ticker) byKey.set(m.ticker, m); });
    (data.insight_markets || []).forEach((m) => {
      const key = m && (m.ticker || m.close_time);
      if (key && !byKey.has(key)) byKey.set(key, m);
    });
    if (data.current && data.current.ticker && !byKey.has(data.current.ticker)) {
      byKey.set(data.current.ticker, data.current);
    }
    return Array.from(byKey.values()).sort(
      (a, b) => (Date.parse(b.close_time || b.open_time || 0) || 0) - (Date.parse(a.close_time || a.open_time || 0) || 0)
    );
  }

  // Consistent export shape, filling gaps (older slim insight records) with null.
  function normalize(m) {
    const timeline = m.prob_timeline || m.timeline || [];
    return {
      ticker: m.ticker ?? null,
      title: m.title ?? null,
      open_time: m.open_time ?? null,
      close_time: m.close_time ?? null,
      strike: m.strike ?? null,
      result: m.result ?? null,
      volume: m.volume_max ?? m.volume ?? null,
      open_interest: m.open_interest ?? null,
      yes_prob_first: m.yes_prob_first ?? null,
      yes_prob_last: m.yes_prob_last ?? null,
      yes_prob_min: m.yes_prob_min ?? null,
      yes_prob_max: m.yes_prob_max ?? null,
      yes_bid_pct: m.yes_bid_pct ?? null,
      yes_ask_pct: m.yes_ask_pct ?? null,
      no_bid_pct: m.no_bid_pct ?? null,
      no_ask_pct: m.no_ask_pct ?? null,
      yes_leaning_seconds: m.yes_leaning_seconds ?? null,
      no_leaning_seconds: m.no_leaning_seconds ?? null,
      sample_count: m.sample_count ?? timeline.length,
      prob_timeline: timeline,
      diff_timeline: m.diff_timeline || [],
    };
  }

  // UTC date (YYYY-MM-DD) a market belongs to.
  function marketDate(m) {
    const iso = m.close_time || m.open_time || "";
    return iso.slice(0, 10);
  }

  function marketLabel(m) {
    const when = m.open_time ? fmtTime(m.open_time) : (m.close_time ? fmtTime(m.close_time) : "market");
    const end = m.close_time ? " → " + fmtClock(m.close_time) : "";
    const res = m.result === "yes" ? "UP" : m.result === "no" ? "DOWN" : "open";
    return `${when}${end} · ${res} · ${fmtUsd(m.strike, 0)} · ${m.ticker || ""}`;
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function marketsToCsv(markets) {
    const cols = [
      "ticker", "title", "open_time", "close_time", "strike", "result", "volume",
      "open_interest", "yes_prob_first", "yes_prob_last", "yes_prob_min", "yes_prob_max",
      "yes_bid_pct", "yes_ask_pct", "no_bid_pct", "no_ask_pct",
      "yes_leaning_seconds", "no_leaning_seconds", "sample_count",
    ];
    const lines = [cols.join(",")];
    for (const m of markets) lines.push(cols.map((c) => csvCell(m[c])).join(","));
    return lines.join("\n");
  }

  function approxSize(text) {
    const bytes = new Blob([text]).size;
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadExportData() {
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

  // ---- UI ----

  function renderExport(root, data) {
    root.replaceChildren();

    const fromInput = el("input", { type: "date", id: "exp-from", class: "combo" });
    const toInput = el("input", { type: "date", id: "exp-to", class: "combo" });

    const scopeSelect = el("select", { class: "combo", id: "exp-scope" }, [
      el("option", { value: "all" }, ["All markets (in date range)"]),
      el("option", { value: "specific" }, ["Specific markets"]),
      el("option", { value: "whole" }, ["Whole data.json (everything)"]),
    ]);

    const formatSelect = el("select", { class: "combo", id: "exp-format" }, [
      el("option", { value: "json" }, ["JSON (best for AI)"]),
      el("option", { value: "csv" }, ["CSV (spreadsheet)"]),
    ]);

    const timelineCheck = el("input", { type: "checkbox", id: "exp-timelines" });
    timelineCheck.checked = true;

    const marketSelect = el("select", { multiple: "multiple", class: "combo export-multiselect", id: "exp-markets", size: "10" });
    const selectAllBtn = el("button", { class: "btn", type: "button" }, ["Select all"]);
    const clearBtn = el("button", { class: "btn", type: "button" }, ["Clear"]);
    const specificRow = el("div", { class: "field export-specific" }, [
      el("label", { for: "exp-markets" }, ["Pick markets (Ctrl/Cmd-click for several)"]),
      marketSelect,
      el("div", { class: "export-actions" }, [selectAllBtn, clearBtn]),
    ]);

    const reloadBtn = el("button", { class: "btn", type: "button" }, ["Reload latest data"]);
    const downloadBtn = el("button", { class: "btn", type: "button" }, ["Download file"]);
    const copyBtn = el("button", { class: "btn", type: "button" }, ["Copy to clipboard"]);

    const statusEl = el("div", { class: "hint export-status" });
    const preview = el("textarea", { class: "export-preview", readonly: "readonly", spellcheck: "false" });

    let currentText = "";
    let currentExt = "json";

    function filteredMarkets() {
      const from = fromInput.value;
      const to = toInput.value;
      return allMarkets(exportData).filter((m) => {
        const d = marketDate(m);
        if (from && d && d < from) return false;
        if (to && d && d > to) return false;
        return true;
      });
    }

    function refreshMarketList() {
      const prevSelected = new Set(Array.from(marketSelect.selectedOptions).map((o) => o.value));
      marketSelect.replaceChildren();
      for (const m of filteredMarkets()) {
        const value = m.ticker || m.close_time || "";
        const opt = el("option", { value }, [marketLabel(m)]);
        if (prevSelected.has(value)) opt.selected = true;
        marketSelect.appendChild(opt);
      }
    }

    function chosenMarkets() {
      const scope = scopeSelect.value;
      if (scope === "specific") {
        const picked = new Set(Array.from(marketSelect.selectedOptions).map((o) => o.value));
        return filteredMarkets().filter((m) => picked.has(m.ticker || m.close_time || ""));
      }
      return filteredMarkets(); // "all"
    }

    function compute() {
      const scope = scopeSelect.value;
      const isWhole = scope === "whole";

      // Whole-data export is JSON only and ignores the per-market controls.
      formatSelect.disabled = isWhole;
      timelineCheck.disabled = isWhole;
      specificRow.style.display = scope === "specific" ? "" : "none";

      let text = "";
      let count = 0;

      if (isWhole) {
        currentExt = "json";
        text = JSON.stringify({ exported_at: new Date().toISOString(), ...exportData }, null, 2);
        count = allMarkets(exportData).length;
      } else {
        const markets = chosenMarkets().map(normalize).map((m) => {
          if (!timelineCheck.checked) {
            const { prob_timeline, diff_timeline, ...rest } = m;
            return rest;
          }
          return m;
        });
        count = markets.length;
        if (formatSelect.value === "csv") {
          currentExt = "csv";
          text = marketsToCsv(markets);
        } else {
          currentExt = "json";
          text = JSON.stringify({
            exported_at: new Date().toISOString(),
            series_ticker: exportData.series_ticker || "KXBTC15M",
            source: "Kalshi KXBTC15M via kbtctraker",
            filter: { from: fromInput.value || null, to: toInput.value || null, scope, include_timelines: timelineCheck.checked },
            market_count: count,
            markets,
          }, null, 2);
        }
      }

      currentText = text;
      const noteCsv = !isWhole && formatSelect.value === "csv" ? " · timelines omitted in CSV (use JSON for those)" : "";
      const scopeLabel = isWhole ? "whole data.json" : count + " market" + (count === 1 ? "" : "s");
      statusEl.textContent = `Exporting ${scopeLabel} · ${approxSize(text)}${noteCsv}`;
      preview.value = text.length > PREVIEW_LIMIT
        ? text.slice(0, PREVIEW_LIMIT) + "\n\n… preview truncated — Download / Copy include everything."
        : text;
      downloadBtn.disabled = !isWhole && count === 0;
      copyBtn.disabled = !isWhole && count === 0;
    }

    fromInput.addEventListener("change", () => { refreshMarketList(); compute(); });
    toInput.addEventListener("change", () => { refreshMarketList(); compute(); });
    scopeSelect.addEventListener("change", compute);
    formatSelect.addEventListener("change", compute);
    timelineCheck.addEventListener("change", compute);
    marketSelect.addEventListener("change", compute);
    selectAllBtn.addEventListener("click", () => { Array.from(marketSelect.options).forEach((o) => (o.selected = true)); compute(); });
    clearBtn.addEventListener("click", () => { Array.from(marketSelect.options).forEach((o) => (o.selected = false)); compute(); });

    downloadBtn.addEventListener("click", () => {
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+/, "");
      const mime = currentExt === "csv" ? "text/csv" : "application/json";
      downloadText(`kbtc-${scopeSelect.value}-${stamp}.${currentExt}`, currentText, mime);
    });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(currentText);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy to clipboard"), 1500);
      } catch {
        copyBtn.textContent = "Copy failed — select & copy manually";
        setTimeout(() => (copyBtn.textContent = "Copy to clipboard"), 2500);
      }
    });
    reloadBtn.addEventListener("click", async () => {
      reloadBtn.disabled = true;
      reloadBtn.textContent = "Loading…";
      try {
        exportData = await loadExportData();
        refreshMarketList();
        compute();
      } catch {
        statusEl.textContent = "Could not reload data.";
      }
      reloadBtn.disabled = false;
      reloadBtn.textContent = "Reload latest data";
    });

    root.appendChild(el("div", { class: "panel" }, [
      el("h2", {}, ["Export Data"]),
      el("div", { class: "desc" }, ["Pull the collected market data out as JSON or CSV to analyze anywhere (paste JSON straight into any AI). Filter by UTC date, grab all markets in the range, hand-pick specific ones, or dump the entire dataset."]),
      el("div", { class: "calc-grid" }, [
        el("div", { class: "field" }, [el("label", { for: "exp-from" }, ["From date (UTC)"]), fromInput]),
        el("div", { class: "field" }, [el("label", { for: "exp-to" }, ["To date (UTC)"]), toInput]),
        el("div", { class: "field" }, [el("label", { for: "exp-scope" }, ["What to export"]), scopeSelect]),
        el("div", { class: "field" }, [el("label", { for: "exp-format" }, ["Format"]), formatSelect]),
        el("label", { class: "check" }, [timelineCheck, "Include per-minute timelines (JSON)"]),
        el("div", {}, [reloadBtn]),
      ]),
      specificRow,
      el("div", { class: "export-actions" }, [downloadBtn, copyBtn]),
      statusEl,
      preview,
    ]));

    root.appendChild(el("div", { class: "panel" }, [
      el("h2", {}, ["What's in the export"]),
      el("div", { class: "hint", html: `
        <ul>
          <li><b>All markets</b> / <b>Specific markets</b> give one record per 15-minute market: target (strike), result, volume, YES probability first/min/max/last, time spent leaning UP vs DOWN, and — in JSON — the per-minute <code>prob_timeline</code> (YES %) and <code>diff_timeline</code> (BTC minus target, $).</li>
          <li><b>Whole data.json</b> is the entire dataset: current market, summary stats, recent + all settled markets, and the BTC/strike/volatility time series. JSON only.</li>
          <li>Dates filter by each market's close time in <b>UTC</b>. Leave a date blank for no bound.</li>
          <li>CSV holds the scalar columns only; use JSON if you want the minute-by-minute timelines.</li>
          <li>Data is a snapshot from when the tab loaded — hit <b>Reload latest data</b> to pull the newest before exporting.</li>
        </ul>` }),
    ]));

    refreshMarketList();
    compute();
  }

  async function refreshExportTab() {
    const root = document.getElementById("tab-export");
    if (!root) return;
    if (!exportData) {
      root.replaceChildren(el("div", { class: "empty-state" }, ["Loading data…"]));
      try {
        exportData = await loadExportData();
      } catch (e) {
        root.replaceChildren(el("div", { class: "empty-state" }, ["Export data is not available yet."]));
        return;
      }
    }
    renderExport(root, exportData);
    built = true;
  }

  function onExport() {
    return location.hash.replace("#", "") === "export";
  }

  const tabButton = document.querySelector('[data-tab="export"]');
  if (tabButton) tabButton.addEventListener("click", () => { location.hash = "export"; });
  window.addEventListener("hashchange", () => { if (onExport() && !built) refreshExportTab(); });
  if (onExport()) refreshExportTab();
})();
