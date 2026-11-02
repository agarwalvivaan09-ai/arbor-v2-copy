// ==========================================================
// ARBOR SIMULATIONS — stress tests and Monte Carlo (pure)
// ----------------------------------------------------------
// Deterministic for a given seed, so the same inputs always
// give the same answer. All rupee amounts are monthly unless
// a name says otherwise.
// ==========================================================
import { computeHFRI } from "./hfri.js";

// ---------- seeded RNG ----------
export function rng(seed = 42) {
    let s = seed >>> 0;
    const uniform = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    const normal = () => {
        if (spare !== null) { const v = spare; spare = null; return v; }
        let u = 0, v = 0;
        while (u === 0) u = uniform();
        while (v === 0) v = uniform();
        const r = Math.sqrt(-2 * Math.log(u));
        spare = r * Math.sin(2 * Math.PI * v);
        return r * Math.cos(2 * Math.PI * v);
    };
    return { uniform, normal };
}

export function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const sd = xs => {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

// ==========================================================
// PERSONAL STRESS TEST (deterministic)
// ----------------------------------------------------------
// base: { income, spending, debtService, interest, liquid, debt,
//         assets, essential, cv } — monthly flows, stock values today.
//         interest = the part of monthly loan payments that is interest;
//         the rest of each payment reduces the loan.
// shock: { incomeDrop, spendingRise, months, oneOff, assetDrop }
//         drops/rises as fractions (0.25 = 25%)
// ==========================================================
export function personalStressTest(base, shock) {
    const months = Math.max(1, Math.round(shock.months || 1));
    const income = base.income * (1 - clamp01(shock.incomeDrop));
    const spending = base.spending * (1 + Math.max(0, shock.spendingRise || 0));
    const essential = base.essential * (1 + Math.max(0, shock.spendingRise || 0));
    const oneOff = Math.max(0, shock.oneOff || 0);

    const baseNet = base.income - base.spending - base.debtService;
    const stressedNet = income - spending - base.debtService;

    // month-by-month cash path; essentials are paid first, so cash can go negative (= shortfall)
    let cash = base.liquid - oneOff;
    let runOutMonth = cash < 0 ? 0 : null;
    const path = [cash];
    for (let m = 1; m <= months; m++) {
        cash += stressedNet;
        path.push(cash);
        if (runOutMonth === null && cash < 0) runOutMonth = m;
    }

    const shortfall = Math.max(0, -cash);
    const assetLoss = base.assets * clamp01(shock.assetDrop);
    // loan payments keep reducing principal during the shock; only interest is a cost
    const principalRepaid = Math.min(base.debt, Math.max(0, base.debtService - (base.interest || 0)) * months);
    const debtAfter = base.debt - principalRepaid;
    const netWorthBefore = base.liquid + base.assets - base.debt;
    const netWorthAfter = cash + base.assets - assetLoss - debtAfter;
    // cash actually consumed by the shock (what savings must cover)
    const cashUsed = Math.max(0, base.liquid - cash);

    // runway if the shock lasted indefinitely
    const startCash = base.liquid - oneOff;
    const runwayMonths = stressedNet >= 0 ? Infinity : Math.max(0, startCash) / -stressedNet;

    // HFRI before and during the shock (same model as the research)
    const hfri = (inc, spend, ess, liquid) => inc > 0
        ? computeHFRI({
            income: inc * 12, spending: spend * 12, debt: base.debt, debtService: base.debtService * 12,
            liquid: Math.max(0, liquid), essentialMonthly: ess, cv: base.cv ?? 0.2
        })
        : null;
    const hfriBefore = hfri(base.income, base.spending, base.essential, base.liquid);
    const hfriDuring = hfri(income, spending, essential, base.liquid - oneOff);
    const hfriAfter = hfri(base.income, base.spending, base.essential, cash);

    // income given up and extra spending caused by the shock
    const shockCost = Math.max(0, baseNet - stressedNet) * months + oneOff;

    return {
        months, income, spending, baseNet, stressedNet, path,
        endCash: cash, runOutMonth, shortfall, runwayMonths,
        assetLoss, netWorthBefore, netWorthAfter, debtAfter, principalRepaid,
        shockCost, cashUsed, covered: runOutMonth === null,
        hfriBefore, hfriDuring, hfriAfter
    };
}

export const PERSONAL_SCENARIOS = [
    { key: "jobloss", label: "Job loss", text: "Income stops completely for 6 months.", shock: { incomeDrop: 1, spendingRise: 0, months: 6, oneOff: 0, assetDrop: 0 } },
    { key: "paycut", label: "Pay cut (HFRI paper test)", text: "Income falls 25% for 3 months.", shock: { incomeDrop: 0.25, spendingRise: 0, months: 3, oneOff: 0, assetDrop: 0 } },
    { key: "medical", label: "Medical emergency", text: "A one-off ₹2,00,000 bill.", shock: { incomeDrop: 0, spendingRise: 0, months: 1, oneOff: 200000, assetDrop: 0 } },
    { key: "inflation", label: "Cost-of-living spike", text: "Spending rises 15% for 12 months.", shock: { incomeDrop: 0, spendingRise: 0.15, months: 12, oneOff: 0, assetDrop: 0 } },
    { key: "crash", label: "Market crash", text: "Investments fall 30%.", shock: { incomeDrop: 0, spendingRise: 0, months: 1, oneOff: 0, assetDrop: 0.3 } },
    { key: "perfect", label: "Perfect storm", text: "Income −50%, spending +10% for 6 months, and markets −25%.", shock: { incomeDrop: 0.5, spendingRise: 0.1, months: 6, oneOff: 0, assetDrop: 0.25 } }
];

// ==========================================================
// PERSONAL MONTE CARLO (monthly steps)
// ----------------------------------------------------------
// p = {
//   cash, assets: [{ value, rate }], loans: [{ balance, rate, payment }],
//   income, incomeVol, spending, spendingVol,
//   incomeGrowth, inflation, marketVol, jobLossProb, jobLossMonths,
//   years, sims, seed
// }
// Net worth = cash + assets − loans. Loans amortise with their payments
// (reducing balance); cash earns nothing; income and spending have
// noisy months around a growing trend; all investments share one market
// factor each month (fully correlated, a cautious assumption).
// ==========================================================
export function personalMonteCarlo(p) {
    const years = Math.max(1, Math.round(p.years || 10));
    const months = years * 12;
    const sims = Math.max(100, Math.round(p.sims || 2000));
    const R = rng(p.seed ?? 42);
    const g = (1 + (p.incomeGrowth || 0)) ** (1 / 12) - 1;
    const inf = (1 + (p.inflation || 0)) ** (1 / 12) - 1;
    const sigM = (p.marketVol || 0) / Math.sqrt(12);
    const incSig = (p.incomeVol || 0);
    const spSig = (p.spendingVol || 0);
    const hazard = 1 - (1 - clamp01(p.jobLossProb || 0)) ** (1 / 12);
    const assets0 = (p.assets || []).map(a => ({ value: Math.max(0, a.value), mu: a.rate || 0 }));
    const loans0 = (p.loans || []).map(l => ({ balance: Math.max(0, l.balance), r: (l.rate || 0) / 12, pay: Math.max(0, l.payment || 0) }));
    const startNW = p.cash + assets0.reduce((s, a) => s + a.value, 0) - loans0.reduce((s, l) => s + l.balance, 0);

    const yearly = Array.from({ length: years + 1 }, () => []);
    const finals = [];
    let ranOut = 0, grew = 0, beatInflation = 0;

    for (let s = 0; s < sims; s++) {
        let cash = p.cash;
        const assets = assets0.map(a => ({ ...a }));
        const loans = loans0.map(l => ({ ...l }));
        let unemployed = 0, everNegative = false;
        let trendIncome = p.income, trendSpend = p.spending;
        yearly[0].push(startNW);

        for (let m = 1; m <= months; m++) {
            trendIncome *= 1 + g;
            trendSpend *= 1 + inf;

            if (unemployed > 0) unemployed--;
            else if (R.uniform() < hazard) unemployed = Math.max(1, Math.round(p.jobLossMonths || 6));

            const income = unemployed > 0 ? 0 : Math.max(0, trendIncome * (1 + incSig * R.normal()));
            const spend = Math.max(0, trendSpend * (1 + spSig * R.normal()));

            let debtPaid = 0;
            for (const l of loans) {
                if (l.balance <= 0) continue;
                l.balance *= 1 + l.r;
                const pay = Math.min(l.pay, l.balance);
                l.balance -= pay;
                debtPaid += pay;
            }

            const z = R.normal();
            for (const a of assets) {
                // lognormal monthly return with the asset's expected annual rate
                const muM = Math.log(1 + a.mu) / 12;
                const sig = a.mu < 0 ? 0 : sigM; // depreciating assets: deterministic
                a.value *= Math.exp(muM - 0.5 * sig * sig + sig * z);
            }

            cash += income - spend - debtPaid;
            if (cash < 0) everNegative = true;

            if (m % 12 === 0) {
                const nw = cash + assets.reduce((t, a) => t + a.value, 0) - loans.reduce((t, l) => t + l.balance, 0);
                yearly[m / 12].push(nw);
            }
        }
        const final = yearly[years][yearly[years].length - 1];
        finals.push(final);
        if (everNegative) ranOut++;
        if (final > startNW) grew++;
        if (final > startNW * (1 + (p.inflation || 0)) ** years) beatInflation++;
    }

    finals.sort((a, b) => a - b);
    const bands = yearly.map((arr, year) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return { year, p5: percentile(sorted, 0.05), p25: percentile(sorted, 0.25), p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p95: percentile(sorted, 0.95) };
    });
    const realFactor = (1 + (p.inflation || 0)) ** years;
    return {
        sims, years, startNW, bands, finals,
        pGrow: grew / sims, pBeatInflation: beatInflation / sims, pCashShortfall: ranOut / sims,
        median: percentile(finals, 0.5), p5: percentile(finals, 0.05), p95: percentile(finals, 0.95),
        medianReal: percentile(finals, 0.5) / realFactor
    };
}

// ==========================================================
// BUSINESS STRESS TEST — break-even and runway
// ----------------------------------------------------------
// base: { revenue, variableCosts, fixedCosts, cash, receivables, payables }  (monthly flows)
// shock: { revenueDrop, costRise, months, collectionDelayDays }
// Variable costs (purchases, direct expenses) scale with sales;
// fixed costs (indirect expenses) do not.
// ==========================================================
export function businessStressTest(base, shock) {
    const months = Math.max(1, Math.round(shock.months || 1));
    const rev = base.revenue * (1 - clamp01(shock.revenueDrop));
    const varRatio = base.revenue > 0 ? base.variableCosts / base.revenue : 0;
    const variable = rev * varRatio * (1 + Math.max(0, shock.costRise || 0));
    const fixed = base.fixedCosts * (1 + Math.max(0, shock.costRise || 0));
    const profit = rev - variable - fixed;
    const baseProfit = base.revenue - base.variableCosts - base.fixedCosts;

    const contributionMargin = rev > 0 ? (rev - variable) / rev : 0;
    const breakEvenRevenue = contributionMargin > 0 ? fixed / contributionMargin : Infinity;
    const baseCM = base.revenue > 0 ? (base.revenue - base.variableCosts) / base.revenue : 0;
    const baseBreakEven = baseCM > 0 ? base.fixedCosts / baseCM : Infinity;

    // slower collections tie up cash once: extra receivables = daily sales × extra days
    const delayCash = (rev * 12 / 365) * Math.max(0, shock.collectionDelayDays || 0);

    let cash = base.cash - delayCash;
    let runOutMonth = cash < 0 ? 0 : null;
    const path = [cash];
    for (let m = 1; m <= months; m++) {
        cash += profit;
        path.push(cash);
        if (runOutMonth === null && cash < 0) runOutMonth = m;
    }
    const runwayMonths = profit >= 0 ? Infinity : Math.max(0, base.cash - delayCash) / -profit;

    return {
        months, revenue: rev, variable, fixed, profit, baseProfit,
        contributionMargin, breakEvenRevenue, baseBreakEven,
        marginOfSafety: rev > 0 && Number.isFinite(breakEvenRevenue) ? (rev - breakEvenRevenue) / rev : null,
        delayCash, path, endCash: cash, runOutMonth, runwayMonths, shortfall: Math.max(0, -cash)
    };
}

export const BUSINESS_SCENARIOS = [
    { key: "slump", label: "Sales slump", text: "Revenue falls 30% for 6 months.", shock: { revenueDrop: 0.3, costRise: 0, months: 6, collectionDelayDays: 0 } },
    { key: "costs", label: "Input-cost spike", text: "All costs rise 15% for 12 months.", shock: { revenueDrop: 0, costRise: 0.15, months: 12, collectionDelayDays: 0 } },
    { key: "client", label: "Big client pays late", text: "Customers take 45 extra days to pay.", shock: { revenueDrop: 0, costRise: 0, months: 3, collectionDelayDays: 45 } },
    { key: "lockdown", label: "Shutdown", text: "Revenue falls 80% for 3 months.", shock: { revenueDrop: 0.8, costRise: 0, months: 3, collectionDelayDays: 0 } },
    { key: "recession", label: "Recession", text: "Revenue −25%, costs +8%, customers pay 30 days later, for 12 months.", shock: { revenueDrop: 0.25, costRise: 0.08, months: 12, collectionDelayDays: 30 } }
];

// ==========================================================
// BUSINESS MONTE CARLO — cash forecast
// ----------------------------------------------------------
// p = { cash, revenue, revenueVol, revenueGrowth, variableRatio,
//       fixedCosts, costInflation, months, sims, seed, shockProb, shockDepth }
// Monthly revenue follows a lognormal random walk around its
// trend; variable costs move with revenue; fixed costs grow with
// inflation. Optional demand shocks (e.g. losing a client).
// ==========================================================
export function businessMonteCarlo(p) {
    const months = Math.max(1, Math.round(p.months || 24));
    const sims = Math.max(100, Math.round(p.sims || 2000));
    const R = rng(p.seed ?? 7);
    const g = (1 + (p.revenueGrowth || 0)) ** (1 / 12) - 1;
    const inf = (1 + (p.costInflation || 0)) ** (1 / 12) - 1;
    const sig = Math.max(0, p.revenueVol || 0);
    const shockHazard = clamp01(p.shockProb || 0) / 12;

    const paths = Array.from({ length: months + 1 }, () => []);
    const finals = [];
    let ranOut = 0, lossYears = 0;
    for (let s = 0; s < sims; s++) {
        let cash = p.cash, trend = p.revenue, fixed = p.fixedCosts, everNeg = false, shock = 1, profit12 = 0;
        paths[0].push(cash);
        for (let m = 1; m <= months; m++) {
            trend *= 1 + g;
            fixed *= 1 + inf;
            if (R.uniform() < shockHazard) shock *= 1 - clamp01(p.shockDepth || 0);
            const rev = trend * shock * Math.exp(sig * R.normal() - 0.5 * sig * sig);
            const profit = rev - rev * (p.variableRatio || 0) - fixed;
            cash += profit;
            if (m <= 12) profit12 += profit;
            if (cash < 0) everNeg = true;
            paths[m].push(cash);
        }
        finals.push(cash);
        if (everNeg) ranOut++;
        if (profit12 < 0) lossYears++;
    }
    finals.sort((a, b) => a - b);
    const bands = paths.map((arr, month) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return { month, p5: percentile(sorted, 0.05), p25: percentile(sorted, 0.25), p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p95: percentile(sorted, 0.95) };
    });
    return {
        sims, months, bands, finals,
        pCashOut: ranOut / sims, pLossFirstYear: lossYears / sims,
        median: percentile(finals, 0.5), p5: percentile(finals, 0.05), p95: percentile(finals, 0.95)
    };
}

// ---------- helpers for estimating inputs from history ----------
export function volatilityOf(series) {
    const vals = series.filter(v => Number.isFinite(v));
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    return mean > 0 ? sd(vals) / mean : 0;
}

// lognormal volatility of month-on-month revenue changes
export function logVolatility(series) {
    const r = [];
    for (let i = 1; i < series.length; i++) if (series[i] > 0 && series[i - 1] > 0) r.push(Math.log(series[i] / series[i - 1]));
    return r.length >= 2 ? sd(r) : 0;
}

function clamp01(x) { return Math.min(1, Math.max(0, Number(x) || 0)); }
