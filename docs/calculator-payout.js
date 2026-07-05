(function () {
  const STATE_KEY = "kbtc-calc-state";

  function fmtX(v, digits = 2) {
    if (v === null || v === undefined || Number.isNaN(v)) return "–";
    return v.toFixed(digits) + "x";
  }

  // The whole tab is rebuilt from scratch on every data refresh (~60s), which
  // used to wipe whatever the user had typed mid-analysis. Persist the inputs
  // so a re-render restores them exactly.
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function persistState(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable (private mode) -- inputs just won't survive */
    }
  }

  function renderCalculatorWithPayout(root, data) {
    const c = data && data.current;
    const saved = loadState();
    const sv = (key, fallback) =>
      saved[key] !== undefined && saved[key] !== null && saved[key] !== "" ? String(saved[key]) : fallback;

    const yesPriceInput = el("input", { type: "number", id: "calc-yes-p", min: "0.1", max: "99.9", step: "0.1", value: sv("yesP", "45") });
    const noPriceInput = el("input", { type: "number", id: "calc-no-p", min: "0.1", max: "99.9", step: "0.1", value: sv("noP", "38") });
    const yesMoneyInput = el("input", { type: "number", id: "calc-yes-m", min: "0", step: "1", value: sv("yesM", "200") });
    const noMoneyInput = el("input", { type: "number", id: "calc-no-m", min: "0", step: "1", value: sv("noM", "200") });
    const feeCheck = el("input", { type: "checkbox", id: "calc-fees" });
    feeCheck.checked = saved.fees !== false;
    const yesMultiplierCheck = el("input", { type: "checkbox", id: "calc-yes-x" });
    const noMultiplierCheck = el("input", { type: "checkbox", id: "calc-no-x" });
    yesMultiplierCheck.checked = saved.yesXOn === true;
    noMultiplierCheck.checked = saved.noXOn === true;
    const yesMultiplierInput = el("input", { type: "number", id: "calc-yes-x-value", min: "1", step: "0.01", value: sv("yesX", "2.22") });
    const noMultiplierInput = el("input", { type: "number", id: "calc-no-x-value", min: "1", step: "0.01", value: sv("noX", "2.63") });
    yesMultiplierInput.disabled = !yesMultiplierCheck.checked;
    noMultiplierInput.disabled = !noMultiplierCheck.checked;

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
    const outcomeDetailEl = el("div", { class: "outcome-detail" });
    const detailEl = el("div", { class: "tiles" });
    const breakevenEl = el("div", { class: "hint" });
    let selectedOutcome = saved.outcome === "down" ? "down" : "up";

    const upOutcomeBtn = el("button", { class: "btn outcome" + (selectedOutcome === "up" ? " active" : ""), type: "button" }, ["Show UP win"]);
    const downOutcomeBtn = el("button", { class: "btn outcome" + (selectedOutcome === "down" ? " active" : ""), type: "button" }, ["Show DOWN win"]);
    const outcomeBtns = el("div", { class: "outcome-buttons" }, [upOutcomeBtn, downOutcomeBtn]);

    function sideMath(money, pricePct, useMultiplier, multiplier) {
      const priceDollars = pricePct / 100;
      const priceMultiplier = 1 / priceDollars;
      const payoutMultiplier = useMultiplier ? multiplier : priceMultiplier;
      const grossPayout = money * payoutMultiplier;
      const contracts = grossPayout;
      const fee = feeCheck.checked && !useMultiplier
        ? kalshiFeeDollars(contracts, priceDollars)
        : 0;
      return { contracts, fee, grossPayout, payoutMultiplier, usesMultiplier: useMultiplier };
    }

    function updateMultiplierControls() {
      yesMultiplierInput.disabled = !yesMultiplierCheck.checked;
      noMultiplierInput.disabled = !noMultiplierCheck.checked;
    }

    function recompute() {
      persistState({
        yesP: yesPriceInput.value,
        noP: noPriceInput.value,
        yesM: yesMoneyInput.value,
        noM: noMoneyInput.value,
        yesX: yesMultiplierInput.value,
        noX: noMultiplierInput.value,
        yesXOn: yesMultiplierCheck.checked,
        noXOn: noMultiplierCheck.checked,
        fees: feeCheck.checked,
        outcome: selectedOutcome,
      });

      const yesP = parseFloat(yesPriceInput.value);
      const noP = parseFloat(noPriceInput.value);
      const yesMoney = Math.max(0, parseFloat(yesMoneyInput.value) || 0);
      const noMoney = Math.max(0, parseFloat(noMoneyInput.value) || 0);
      if (Number.isNaN(yesP) || Number.isNaN(noP) || yesP <= 0 || noP <= 0) return;

      const yesDerivedX = 1 / (yesP / 100);
      const noDerivedX = 1 / (noP / 100);
      if (!yesMultiplierCheck.checked) yesMultiplierInput.value = yesDerivedX.toFixed(2);
      if (!noMultiplierCheck.checked) noMultiplierInput.value = noDerivedX.toFixed(2);

      const yesManualX = parseFloat(yesMultiplierInput.value);
      const noManualX = parseFloat(noMultiplierInput.value);
      if ((yesMultiplierCheck.checked && (!yesManualX || yesManualX <= 0)) ||
          (noMultiplierCheck.checked && (!noManualX || noManualX <= 0))) {
        return;
      }

      const yes = sideMath(yesMoney, yesP, yesMultiplierCheck.checked, yesManualX);
      const no = sideMath(noMoney, noP, noMultiplierCheck.checked, noManualX);
      const totalStaked = yesMoney + noMoney;
      const fees = yes.fee + no.fee;
      const profitIfUp = yes.grossPayout - totalStaked - fees;
      const profitIfDown = no.grossPayout - totalStaked - fees;
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
        `${fmtUsd(yes.grossPayout, 2)} gross payout · ${fmtX(yes.payoutMultiplier)}`, profitIfUp >= 0 ? "up" : "down"));
      scenarioEl.appendChild(tile("If DOWN (NO) wins", fmtUsd(profitIfDown, 2),
        `${fmtUsd(no.grossPayout, 2)} gross payout · ${fmtX(no.payoutMultiplier)}`, profitIfDown >= 0 ? "up" : "down"));
      scenarioEl.appendChild(tile("Guaranteed (worst case)", fmtUsd(worst, 2), "the outcome you'd least want", worst >= 0 ? "up" : "down"));

      outcomeDetailEl.innerHTML = "";
      const active = selectedOutcome === "up"
        ? { label: "UP wins", stake: yesMoney, side: yes, gross: yes.grossPayout, profit: profitIfUp, otherStake: noMoney }
        : { label: "DOWN wins", stake: noMoney, side: no, gross: no.grossPayout, profit: profitIfDown, otherStake: yesMoney };
      outcomeDetailEl.appendChild(tile(`${active.label}: gross payout`, fmtUsd(active.gross, 2), `${fmtUsd(active.stake, 2)} × ${fmtX(active.side.payoutMultiplier)}`));
      outcomeDetailEl.appendChild(tile(`${active.label}: net profit`, fmtUsd(active.profit, 2), `${fmtUsd(active.gross, 2)} payout − ${fmtUsd(totalStaked, 2)} staked − ${fmtUsd(fees, 2)} fees`, active.profit >= 0 ? "up" : "down"));
      outcomeDetailEl.appendChild(tile("Other side", `-${fmtUsd(active.otherStake, 2)}`, "that stake loses if this outcome wins", "down"));

      detailEl.innerHTML = "";
      detailEl.appendChild(tile("Total staked", fmtUsd(totalStaked, 2), `${fmtUsd(yesMoney, 0)} up · ${fmtUsd(noMoney, 0)} down`));
      detailEl.appendChild(tile("YES payout", fmtX(yes.payoutMultiplier), `${fmtNum(yes.contracts)} contracts pay $1`));
      detailEl.appendChild(tile("NO payout", fmtX(no.payoutMultiplier), `${fmtNum(no.contracts)} contracts pay $1`));
      detailEl.appendChild(tile("Est. fees", feeCheck.checked ? fmtUsd(fees, 2) : "excluded", yes.usesMultiplier || no.usesMultiplier ? "price-mode sides only" : "Kalshi 7% formula"));

      breakevenEl.innerHTML =
        `Combined price is <b>${(yesP + noP).toFixed(1)}%</b> (YES ${yesP}% + NO ${noP}%). ` +
        (yesP + noP < 100
          ? `Below 100% — a locked-in profit is possible if you size both sides so each outcome pays back more than your total stake (before fees).`
          : `At or above 100% — no both-sides profit exists here before fees; one side must win to come out ahead.`) +
        ` The payout toggles let you use the exact multiplier Kalshi shows, such as 2.14x or 2.73x. When a toggle is on, that multiplier is treated as the side's payout and extra estimated fees are not added for that side.`;
    }

    [yesPriceInput, noPriceInput, yesMoneyInput, noMoneyInput, yesMultiplierInput, noMultiplierInput].forEach((i) => i.addEventListener("input", recompute));
    feeCheck.addEventListener("change", recompute);
    [yesMultiplierCheck, noMultiplierCheck].forEach((i) => i.addEventListener("change", () => {
      updateMultiplierControls();
      recompute();
    }));
    upOutcomeBtn.addEventListener("click", () => {
      selectedOutcome = "up";
      upOutcomeBtn.classList.add("active");
      downOutcomeBtn.classList.remove("active");
      recompute();
    });
    downOutcomeBtn.addEventListener("click", () => {
      selectedOutcome = "down";
      downOutcomeBtn.classList.add("active");
      upOutcomeBtn.classList.remove("active");
      recompute();
    });

    root.appendChild(el("div", { class: "panel" }, [
      el("h2", {}, ["Both-Sides Position Calculator"]),
      el("div", { class: "desc" }, ["Enter each side's price and stake. Use the payout toggles when Kalshi shows a specific return multiplier, then compare the net result if UP or DOWN wins."]),
      el("div", { class: "calc-grid" }, [
        el("div", { class: "field" }, [el("label", { for: "calc-yes-p" }, ["YES (Up) price — %"]), yesPriceInput]),
        el("div", { class: "field" }, [el("label", { for: "calc-yes-m" }, ["Money on YES — $"]), yesMoneyInput]),
        el("div", { class: "field" }, [el("label", { for: "calc-no-p" }, ["NO (Down) price — %"]), noPriceInput]),
        el("div", { class: "field" }, [el("label", { for: "calc-no-m" }, ["Money on NO — $"]), noMoneyInput]),
        el("label", { class: "check payout-toggle" }, [yesMultiplierCheck, "Use YES payout x"]),
        el("div", { class: "field" }, [el("label", { for: "calc-yes-x-value" }, ["YES payout multiplier"]), yesMultiplierInput]),
        el("label", { class: "check payout-toggle" }, [noMultiplierCheck, "Use NO payout x"]),
        el("div", { class: "field" }, [el("label", { for: "calc-no-x-value" }, ["NO payout multiplier"]), noMultiplierInput]),
        el("label", { class: "check" }, [feeCheck, "Include estimated Kalshi fees"]),
        el("div", {}, [liveBtn]),
      ]),
      verdictEl,
      scenarioEl,
      el("div", { style: "height:6px" }),
      outcomeBtns,
      outcomeDetailEl,
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
          <li>A <b>payout multiplier</b> means total return before subtracting the other side's stake. For example, $200 at 2.14x pays back $428 if that side wins.</li>
          <li><b>Use ask prices</b>, not bids — you buy each side at its ask. "Use live ask prices" fills the last collected snapshot. The collector samples Kalshi about every 2 minutes, but published data can lag while GitHub Actions commits and the site redeploys, so always confirm on Kalshi before ordering.</li>
          <li>Staking <b>different amounts</b> on each side tilts your payout: more on the side you think is likelier raises that outcome's profit but lowers the other. The "Guaranteed (worst case)" tile shows what you keep if the less-favorable side wins.</li>
          <li>Both orders must actually fill at those prices for the math to hold — partial fills leave you directional.</li>
          <li>Fee formula is Kalshi's published 7% taker formula and may not match every market/promotion exactly.</li>
        </ul>` }),
    ]));

    recompute();
  }

  // Replace app.js's basic calculator: loadAndRender() resolves this name at
  // call time, so every one of its ~60s refreshes renders this version with
  // fresh data. No second refresh loop needed here -- one used to run in this
  // file too, and the double rebuild wiped user input twice a minute.
  window.renderCalculator = renderCalculatorWithPayout;
})();
