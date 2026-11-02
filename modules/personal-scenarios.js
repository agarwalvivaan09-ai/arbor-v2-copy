// Personal workspace: Stress test + Forecast (Monte Carlo) views.
import { personalStressTest, personalMonteCarlo, PERSONAL_SCENARIOS } from "./simulate.js";
import { escapeHTML, formatMoney, formatShort, pct, kpi, emptyState, fanChart, pathChart, numField } from "./ui.js";

// ---------- inputs derived from the ledger ----------
export function personalBase(metrics, state) {
    const b = metrics.hfri?.baseline;
    if (!b || b.income <= 0) return null;
    const loans = state ? forecastPortfolio(metrics, state).loans : [];
    return {
        interest: loans.reduce((s, l) => s + l.balance * l.rate / 12, 0),
        income: b.income,
        spending: b.spending,
        essential: b.essential,
        debtService: b.debtService,
        cv: b.spendingCV,
        incomeCV: b.incomeCV,
        months: b.months,
        liquid: Math.max(0, metrics.totalCash),
        debt: metrics.totalLiabilities,
        assets: metrics.totalAssets
    };
}

// Loans: active EMI schedules pay them down; loans without EMIs use the
// average manual repayment of the last 12 months.
export function forecastPortfolio(metrics, state, today = new Date()) {
    const yearAgo = new Date(today); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const assets = state.assets
        .map(a => ({
            name: a.name,
            value: metrics.assetValues[a.id] || 0,
            rate: ((a.rate === null || a.rate === undefined || a.rate === "" ? 5 : Number(a.rate)) / 100) * (a.type === "depreciating" ? -1 : 1)
        }))
        .filter(a => a.value > 0);

    const loans = state.liabilities.map(l => {
        const balance = metrics.liabilityOutstanding[l.id] || 0;
        const emi = state.emis
            .filter(e => metrics.emiStatus[e.id]?.liabilityId === l.id && !metrics.emiStatus[e.id]?.completed)
            .reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const manual = state.transactions
            .filter(t => t.type === "liability_payment" && t.liabilityId === l.id)
            .filter(t => { const d = new Date(t.date); return d >= yearAgo && d <= today; })
            .reduce((s, t) => s + (Number(t.amount) || 0), 0) / 12;
        return {
            name: l.name,
            balance,
            rate: (l.rate === null || l.rate === undefined || l.rate === "" ? 8 : Number(l.rate)) / 100,
            payment: emi > 0 ? emi : manual
        };
    }).filter(l => l.balance > 0);

    return { assets, loans };
}

const noData = () => emptyState(
    "Not enough history yet",
    "Stress tests and forecasts start from your average monthly income and spending. Record at least one month of income and expenses first.",
    `<button class="btn btn-primary btn-sm" data-open-panel="activity" data-txn-type="income">Add income</button>`
);

// ==========================================================
// STRESS TEST
// ==========================================================
export function stressView(metrics, state) {
    const base = personalBase(metrics, state);
    if (!base) return `<section class="card">${noData()}</section>`;
    return `
<section class="card">
    <div class="card-head"><h2>Your starting point</h2><span class="muted small">Monthly averages from your last ${base.months} month${base.months === 1 ? "" : "s"} of entries</span></div>
    <div class="summary-strip inner">
        <div><span>Income (after tax)</span><strong>${formatMoney(base.income)}</strong></div>
        <div><span>Spending</span><strong>${formatMoney(base.spending)}</strong></div>
        <div><span>Loan payments</span><strong>${formatMoney(base.debtService)}</strong></div>
        <div><span>Cash today</span><strong>${formatMoney(base.liquid)}</strong></div>
    </div>
</section>

<section class="card">
    <div class="card-head"><h2>Choose a scenario</h2></div>
    <div class="scenario-grid">
        ${PERSONAL_SCENARIOS.map((s, i) => `
        <button class="scenario ${i === 0 ? "active" : ""}" data-scenario="${s.key}">
            <strong>${s.label}</strong><span>${s.text}</span>
        </button>`).join("")}
    </div>
    <div class="form-grid" id="stressForm">
        ${numField("sIncome", "Income falls by", 100, { suffix: "%", step: "5" })}
        ${numField("sSpend", "Spending rises by", 0, { suffix: "%", step: "5" })}
        ${numField("sMonths", "For how long", 6, { suffix: "months", step: "1" })}
        ${numField("sOneOff", "One-off cost", 0, { suffix: "₹", step: "1000" })}
        ${numField("sAssets", "Investments fall by", 0, { suffix: "%", step: "5" })}
    </div>
</section>

<div id="stressResult"></div>

<section class="card">
    <div class="card-head"><h2>All scenarios at a glance</h2></div>
    <div class="table-wrap"><table class="table">
        <thead><tr><th>Scenario</th><th class="num">Monthly gap</th><th class="num">Cash lasts</th><th class="num">Cash at end</th><th class="num">HFRI during</th><th>Verdict</th></tr></thead>
        <tbody>${PERSONAL_SCENARIOS.map(s => {
            const r = personalStressTest(base, s.shock);
            const ok = r.runOutMonth === null;
            return `<tr>
                <td><div class="cell-title">${s.label}</div><div class="cell-sub">${s.text}</div></td>
                <td class="num ${r.stressedNet < 0 ? "neg" : "pos"}">${formatMoney(r.stressedNet)}</td>
                <td class="num">${r.runwayMonths === Infinity ? "Indefinitely" : `${r.runwayMonths.toFixed(1)} mo`}</td>
                <td class="num ${r.endCash < 0 ? "neg" : ""}">${formatMoney(r.endCash)}</td>
                <td class="num">${r.hfriDuring ? r.hfriDuring.total.toFixed(1) : "—"}</td>
                <td>${ok ? `<span class="badge badge-income">Covered</span>` : `<span class="badge badge-expense">Short by ${formatShort(r.shortfall)}</span>`}</td>
            </tr>`;
        }).join("")}</tbody>
    </table></div>
</section>`;
}

export function bindStress(metrics, state) {
    const base = personalBase(metrics, state);
    const form = document.getElementById("stressForm");
    if (!base || !form) return;
    const val = id => Number(document.getElementById(id).value) || 0;
    const set = (id, v) => { document.getElementById(id).value = v; };

    const render = () => {
        const shock = {
            incomeDrop: Math.min(100, Math.max(0, val("sIncome"))) / 100,
            spendingRise: Math.max(0, val("sSpend")) / 100,
            months: Math.max(1, Math.round(val("sMonths"))),
            oneOff: Math.max(0, val("sOneOff")),
            assetDrop: Math.min(100, Math.max(0, val("sAssets"))) / 100
        };
        const r = personalStressTest(base, shock);
        const hf = h => h ? `<strong>${h.total.toFixed(1)}</strong><span class="band-${h.band.key} band-text">${h.band.label}</span>` : `<strong>—</strong><span class="muted">no income</span>`;
        const verdict = r.runOutMonth === null
            ? `<div class="verdict ok"><strong>You get through this.</strong> Cash stays positive for all ${r.months} month${r.months === 1 ? "" : "s"}, ending at ${formatMoney(r.endCash)}.</div>`
            : `<div class="verdict bad"><strong>Cash runs out ${r.runOutMonth === 0 ? "immediately" : `in month ${r.runOutMonth}`}.</strong> You'd be ${formatMoney(r.shortfall)} short by the end of the shock, which you'd need to cover by borrowing, selling investments, or cutting spending.</div>`;

        document.getElementById("stressResult").innerHTML = `
<section class="card">
    <div class="card-head"><h2>Result</h2></div>
    ${verdict}
    <div class="kpi-grid compact">
        ${kpi("Monthly surplus", formatMoney(r.baseNet), "Before the shock", r.baseNet < 0 ? "neg" : "")}
        ${kpi("During the shock", formatMoney(r.stressedNet), "Income − spending − loans", r.stressedNet < 0 ? "neg" : "pos")}
        ${kpi("Cash lasts", r.runwayMonths === Infinity ? "Indefinitely" : `${r.runwayMonths.toFixed(1)} mo`, "If the shock never ended")}
        ${kpi("Cash used", formatMoney(r.cashUsed), `Of the ${formatMoney(base.liquid)} you hold`, r.covered ? "" : "neg")}
        ${kpi("Net worth change", formatMoney(r.netWorthAfter - r.netWorthBefore), `Loan payments still cut ${formatMoney(r.principalRepaid)} of debt`, r.netWorthAfter < r.netWorthBefore ? "neg" : "pos")}
    </div>
    <div class="grid-2-1 tight">
        <div>
            <div class="card-label">Cash, month by month</div>
            ${pathChart(r.path)}
        </div>
        <div class="hfri-compare">
            <div class="card-label">HFRI score</div>
            <div class="hc-row"><span>Today</span>${hf(r.hfriBefore)}</div>
            <div class="hc-row"><span>During the shock</span>${hf(r.hfriDuring)}</div>
            <div class="hc-row"><span>After it ends</span>${hf(r.hfriAfter)}</div>
            <p class="small muted">Recalculated with the same HFRI model, using your stressed income, spending and remaining cash.</p>
        </div>
    </div>
</section>`;
    };

    document.querySelectorAll(".scenario[data-scenario]").forEach(btn => {
        btn.onclick = () => {
            const s = PERSONAL_SCENARIOS.find(x => x.key === btn.dataset.scenario);
            document.querySelectorAll(".scenario").forEach(b => b.classList.toggle("active", b === btn));
            set("sIncome", Math.round(s.shock.incomeDrop * 100));
            set("sSpend", Math.round(s.shock.spendingRise * 100));
            set("sMonths", s.shock.months);
            set("sOneOff", s.shock.oneOff);
            set("sAssets", Math.round(s.shock.assetDrop * 100));
            render();
        };
    });
    form.addEventListener("input", () => {
        document.querySelectorAll(".scenario").forEach(b => b.classList.remove("active"));
        render();
    });
    render();
}

// ==========================================================
// FORECAST (Monte Carlo)
// ==========================================================
export function forecastView(metrics, state) {
    const base = personalBase(metrics);
    if (!base) return `<section class="card">${noData()}</section>`;
    const { assets, loans } = forecastPortfolio(metrics, state);
    const incomeVol = Math.min(0.5, Math.max(0.02, base.incomeCV || 0.05));
    const spendVol = Math.min(0.6, Math.max(0.03, base.cv || 0.1));
    return `
<div class="grid-1-2 forecast-layout">
    <section class="card">
        <div class="card-head"><h2>Assumptions</h2><button class="link" id="fcReset">Reset</button></div>
        <p class="small muted">Pre-filled from your last ${base.months} month${base.months === 1 ? "" : "s"} of entries. Change anything to see how it moves the outcome.</p>
        <div class="form-grid one" id="fcForm">
            ${numField("fYears", "Years ahead", 10, { step: "1", suffix: "years" })}
            ${numField("fIncome", "Monthly income (after tax)", Math.round(base.income), { step: "1000", suffix: "₹" })}
            ${numField("fSpend", "Monthly spending", Math.round(base.spending), { step: "1000", suffix: "₹", help: "Excludes loan payments, which are modelled per loan." })}
            ${numField("fGrowth", "Income growth per year", 6, { suffix: "%" })}
            ${numField("fInflation", "Inflation (spending growth)", 5, { suffix: "%" })}
            ${numField("fIncVol", "Income variability", (incomeVol * 100).toFixed(0), { suffix: "%", help: "How much a typical month differs from normal." })}
            ${numField("fSpendVol", "Spending variability", (spendVol * 100).toFixed(0), { suffix: "%" })}
            ${numField("fMarketVol", "Investment volatility", 15, { suffix: "% / yr", help: "Yearly ups and downs of your investments. Each asset grows at its own expected return." })}
            ${numField("fJobLoss", "Chance of losing income in a year", 5, { suffix: "%" })}
            ${numField("fJobMonths", "Months without income if it happens", 6, { step: "1", suffix: "months" })}
        </div>
        <div class="assume-list">
            <div class="card-label">Included</div>
            <div class="small">${assets.length ? assets.map(a => `${escapeHTML(a.name)} (${formatShort(a.value)}, ${(a.rate * 100).toFixed(1)}%/yr)`).join(" · ") : "No investments."}</div>
            <div class="small">${loans.length ? loans.map(l => `${escapeHTML(l.name)} (${formatShort(l.balance)} at ${(l.rate * 100).toFixed(1)}%, paying ${formatShort(l.payment)}/mo)`).join(" · ") : "No loans."}</div>
        </div>
    </section>
    <div id="fcResult" class="stack"></div>
</div>`;
}

export function bindForecast(metrics, state) {
    const base = personalBase(metrics);
    const form = document.getElementById("fcForm");
    if (!base || !form) return;
    const { assets, loans } = forecastPortfolio(metrics, state);
    const defaults = Object.fromEntries([...form.querySelectorAll("input")].map(i => [i.id, i.value]));
    const v = id => Number(document.getElementById(id).value) || 0;

    let timer = null;
    const run = () => {
        const years = Math.min(40, Math.max(1, Math.round(v("fYears"))));
        const r = personalMonteCarlo({
            cash: base.liquid,
            assets, loans,
            income: Math.max(0, v("fIncome")),
            spending: Math.max(0, v("fSpend")),
            incomeGrowth: v("fGrowth") / 100,
            inflation: v("fInflation") / 100,
            incomeVol: Math.max(0, v("fIncVol")) / 100,
            spendingVol: Math.max(0, v("fSpendVol")) / 100,
            marketVol: Math.max(0, v("fMarketVol")) / 100,
            jobLossProb: Math.min(100, Math.max(0, v("fJobLoss"))) / 100,
            jobLossMonths: Math.max(1, Math.round(v("fJobMonths"))),
            years, sims: 2000, seed: 2026
        });
        const now = new Date().getFullYear();
        document.getElementById("fcResult").innerHTML = `
<section class="card">
    <div class="card-head"><h2>Net worth in ${years} year${years === 1 ? "" : "s"}</h2><span class="muted small">${r.sims.toLocaleString("en-IN")} simulated futures</span></div>
    <div class="kpi-grid compact">
        ${kpi("Most likely (median)", formatShort(r.median), `${formatShort(r.medianReal)} in today's money`)}
        ${kpi("Bad case (5%)", formatShort(r.p5), "1 in 20 futures end lower", r.p5 < 0 ? "neg" : "")}
        ${kpi("Good case (95%)", formatShort(r.p95), "1 in 20 futures end higher")}
        ${kpi("Net worth grows", pct(r.pGrow, 0), `From ${formatShort(r.startNW)} today`)}
        ${kpi("Beats inflation", pct(r.pBeatInflation, 0), "Grows in real terms")}
        ${kpi("Cash ever runs short", pct(r.pCashShortfall, 0), "Spending + loans exceed cash at some point", r.pCashShortfall > 0.2 ? "neg" : "")}
    </div>
    ${fanChart(r.bands.map(b => b), { xLabel: i => String(now + i) })}
</section>
<section class="card prose-card">
    <div class="card-head"><h2>How this forecast works</h2></div>
    <p>Each simulated future runs month by month. Income and spending vary around their trend and grow with the rates you set. In some years income stops for a while. Every investment grows at its own expected return with shared market ups and downs, and depreciating assets lose value steadily. Every loan is paid down by its EMI on a reducing balance. Net worth is cash plus investments minus what you still owe.</p>
    <p class="small muted">A forecast is a range of possibilities, not a promise. It doesn't include future loans, big purchases or windfalls you haven't recorded.</p>
</section>`;
    };
    form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 250); });
    document.getElementById("fcReset").onclick = () => {
        Object.entries(defaults).forEach(([id, val]) => { document.getElementById(id).value = val; });
        run();
    };
    run();
}
