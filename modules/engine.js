import { computeHFRI } from "./hfri.js";

// ==========================================================
// ARBOR FINANCIAL ENGINE
// ----------------------------------------------------------
// Pure function: takes the profile's raw records and returns
// every number the dashboard shows. Everything is computed
// "as of today": records dated in the future are ignored
// until their date arrives.
//
// Cash      = opening balances + dated cash movements + EMIs paid
// Assets    = purchase value grown at its rate, minus sales
// Loans     = principal grown at its rate, minus repayments
//             (each repayment stops accruing interest from the
//             day it is paid — i.e. reducing-balance logic)
// Net worth = cash + assets - loans
//
// Tax is not calculated automatically. Users record tax they pay
// as an Expense with subtype "tax"; HFRI treats it as a deduction
// from income (disposable income) rather than as spending.
// ==========================================================

const HFRI_WINDOW_MONTHS = 12;
const HFRI_MIN_MONTHS = 2;

const DAY_MS = 1000 * 60 * 60 * 24;
const MS_PER_YEAR = DAY_MS * 365;
const MAX_EMI_INSTALLMENTS = 1200; // safety cap (100 years)

export const CASH_IN_TYPES = ["income", "asset_sell", "liability_add"];
export const CASH_OUT_TYPES = ["expense", "asset_buy", "liability_payment"];

export function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "object" && typeof value.seconds === "number") {
        return new Date(value.seconds * 1000);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Adds whole months, clamping to the last day of shorter months
// (31 Jan + 1 month = 28/29 Feb).
export function addMonths(dateValue, months) {
    const base = toDate(dateValue);
    if (!base) return null;
    const day = base.getUTCDate();
    const result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
    return result;
}

export function monthKey(dateValue) {
    const date = toDate(dateValue);
    return date ? date.toISOString().slice(0, 7) : null;
}

function amountOf(item) {
    const amount = Number(item?.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function timestampValue(createdAt) {
    if (!createdAt) return 0;
    if (typeof createdAt === "number") return createdAt;
    if (typeof createdAt.seconds === "number") return createdAt.seconds * 1000;
    const date = toDate(createdAt);
    return date ? date.getTime() : 0;
}

// A rate of 0 is valid; only a missing / unparseable rate falls back.
function rateOf(item, defaultRate) {
    if (item?.rate === null || item?.rate === undefined || item?.rate === "") return defaultRate;
    const rate = Number(item.rate);
    return Number.isFinite(rate) ? rate : defaultRate;
}

function isCompound(item) {
    // assets store it in `compounding`, liabilities in `type`
    return item?.compounding === "compound" || item?.type === "compound";
}

export function computeFinancials(state, options = {}) {
    const {
        assets = [],
        liabilities = [],
        transactions = [],
        accounts = [],
        emis = []
    } = state || {};

    const today = toDate(options.today) || new Date();

    function isEffective(dateValue) {
        // undated records are treated as already happened
        if (!dateValue) return true;
        const date = toDate(dateValue);
        return !!date && date <= today;
    }

    // Growth multiplier for money tied to `item` between two dates,
    // honouring the item's start/end dates, rate and compounding.
    function growthFactor(item, defaultRate, direction, fromValue, toValue) {
        if (!item?.startDate) return 1;

        const start = toDate(item.startDate);
        let from = toDate(fromValue) || start;
        let to = toDate(toValue) || today;
        if (!start) return 1;

        if (from < start) from = start;
        const end = toDate(item.endDate);
        if (end && to > end) to = end;

        const years = Math.max(0, (to - from) / MS_PER_YEAR);
        const rate = rateOf(item, defaultRate) / 100;

        const factor = isCompound(item)
            ? Math.pow(1 + direction * rate, years)
            : 1 + direction * rate * years;

        return Math.max(0, factor);
    }

    function hasStarted(item, atValue = today) {
        if (!item?.startDate) return true;
        const start = toDate(item.startDate);
        const at = toDate(atValue) || today;
        return !!start && start <= at;
    }

    // ------------------------
    // INIT BALANCES
    // ------------------------
    const balances = {};
    accounts.forEach(a => {
        balances[a.id] = Number(a.openingBalance) || 0;
    });

    const effectiveTxns = transactions
        .filter(t => amountOf(t) > 0 && isEffective(t.date))
        .sort((a, b) => {
            const aTime = toDate(a.date)?.getTime() || 0;
            const bTime = toDate(b.date)?.getTime() || 0;
            if (aTime !== bTime) return aTime - bTime;
            return timestampValue(a.createdAt) - timestampValue(b.createdAt);
        });

    let income = 0;
    let expense = 0;

    // Per-month household ledger used by HFRI.
    const household = {};
    // months in which the user actually recorded entries (auto EMIs excluded)
    const recordedMonths = new Set();
    const hh = dateValue => {
        const m = monthKey(dateValue);
        if (!m) return null;
        return (household[m] ||= { income: 0, tax: 0, spending: 0, essential: 0, debtService: 0 });
    };

    // Every outgoing spend (expense, loan payment, EMI) with its date.
    // Feeds category, monthly and average metrics.
    const outflows = [];
    const inflows = [];

    // ------------------------
    // CORE FLOW ENGINE
    // ------------------------
    effectiveTxns.forEach(t => {
        const amount = amountOf(t);
        const acc = t.accountId;
        if (!acc || balances[acc] === undefined) return;

        const recorded = monthKey(t.date);
        if (recorded) recordedMonths.add(recorded);

        switch (t.type) {
            case "income":
                income += amount;
                balances[acc] += amount;
                inflows.push({ date: t.date, amount });
                if (hh(t.date)) hh(t.date).income += amount;
                break;
            case "expense": {
                expense += amount;
                balances[acc] -= amount;
                outflows.push({ date: t.date, amount, category: t.category || t.subtype || "other" });
                const month = hh(t.date);
                if (month) {
                    if (t.subtype === "tax") {
                        month.tax += amount;
                    } else {
                        month.spending += amount;
                        if (t.subtype !== "discretionary") month.essential += amount;
                    }
                }
                break;
            }
            case "asset_buy":
                balances[acc] -= amount;
                break;
            case "asset_sell":
                balances[acc] += amount;
                break;
            case "liability_add":
                balances[acc] += amount;
                break;
            case "liability_payment":
                expense += amount;
                balances[acc] -= amount;
                outflows.push({ date: t.date, amount, category: t.category || "loan payment" });
                if (hh(t.date)) hh(t.date).debtService += amount;
                break;
            case "transfer": {
                const to = t.toAccountId;
                if (!to || balances[to] === undefined || to === acc) return;
                balances[acc] -= amount;
                balances[to] += amount;
                break;
            }
            default:
                break;
        }
    });

    // ------------------------
    // LIABILITIES + EMI SCHEDULES
    // ------------------------
    const liabilityById = Object.fromEntries(liabilities.map(l => [l.id, l]));

    // payments[liabilityId] = [{ date, amount }]
    const payments = {};
    liabilities.forEach(l => { payments[l.id] = []; });

    effectiveTxns.forEach(t => {
        if (t.type !== "liability_payment" || !payments[t.liabilityId]) return;
        payments[t.liabilityId].push({ date: t.date, amount: amountOf(t) });
    });

    function outstandingAt(l, atValue) {
        if (!hasStarted(l, atValue)) return 0;
        const at = toDate(atValue) || today;
        const principal = (Number(l.value) || 0) * growthFactor(l, 8, 1, l.startDate, at);
        const repaid = (payments[l.id] || [])
            .filter(p => { const d = toDate(p.date); return !d || d <= at; })
            .reduce((sum, p) => sum + p.amount * growthFactor(l, 8, 1, p.date, at), 0);
        return principal - repaid;
    }

    function linkedLiability(emi) {
        if (emi.liabilityId) return liabilityById[emi.liabilityId] || null;
        // legacy EMIs were saved without liabilityId — they share the loan's name
        return liabilities.find(l => l.name && l.name === emi.name) || null;
    }

    const emiStatus = {};

    emis.forEach(e => {
        const emiAmount = amountOf(e);
        const first = toDate(e.firstDate || e.nextDate);
        const tenure = Number(e.tenure) > 0 ? Math.floor(Number(e.tenure)) : MAX_EMI_INSTALLMENTS;
        const accountOk = !!e.accountId && balances[e.accountId] !== undefined;
        const liability = linkedLiability(e);

        const status = {
            paidCount: 0,
            paidAmount: 0,
            tenure: Number(e.tenure) > 0 ? tenure : null,
            nextDue: null,
            completed: false,
            liabilityId: liability?.id || null
        };
        emiStatus[e.id] = status;

        if (!emiAmount || !first || !accountOk) {
            status.nextDue = first;
            return;
        }

        let k = 0;
        for (; k < Math.min(tenure, MAX_EMI_INSTALLMENTS); k++) {
            const due = addMonths(first, k);
            if (due > today) break;

            let amount = emiAmount;
            if (liability) {
                const remaining = outstandingAt(liability, due);
                if (remaining <= 0.5) { status.completed = true; break; }
                amount = Math.min(emiAmount, remaining);
                payments[liability.id].push({ date: due, amount });
            }

            balances[e.accountId] -= amount;
            expense += amount;
            outflows.push({ date: due, amount, category: e.name || "EMI" });
            if (hh(due)) hh(due).debtService += amount;
            status.paidCount++;
            status.paidAmount += amount;
        }

        if (k >= tenure) status.completed = true;
        if (!status.completed && liability && outstandingAt(liability, today) <= 0.5) status.completed = true;
        if (!status.completed) status.nextDue = addMonths(first, k);
    });

    const liabilityOutstanding = {};
    const totalLiabilities = liabilities.reduce((sum, l) => {
        const value = Math.max(0, outstandingAt(l, today));
        liabilityOutstanding[l.id] = value;
        return sum + value;
    }, 0);

    // ------------------------
    // ASSETS
    // ------------------------
    const assetValues = {};
    const totalAssets = assets.reduce((sum, a) => {
        if (!hasStarted(a)) {
            assetValues[a.id] = 0;
            return sum;
        }

        const direction = a.type === "depreciating" ? -1 : 1;
        const base = (Number(a.value) || 0) * growthFactor(a, 5, direction, a.startDate, today);

        // a sale removes that amount of value from the date it happened,
        // so it no longer appreciates / depreciates afterwards
        const sold = effectiveTxns
            .filter(t => t.assetId === a.id && t.type === "asset_sell")
            .reduce((s, t) => s + amountOf(t) * growthFactor(a, 5, direction, t.date, today), 0);

        const value = Math.max(0, base - sold);
        assetValues[a.id] = value;
        return sum + value;
    }, 0);

    // ------------------------
    // CASH + NET WORTH
    // ------------------------
    const totalCash = Object.values(balances).reduce((a, b) => a + (b || 0), 0);
    const netWorth = totalCash + totalAssets - totalLiabilities;

    const savingsRate = income > 0
        ? (income - expense) / income
        : 0;

    let status = "Vulnerable";
    if (savingsRate >= 0.4) status = "Strong";
    else if (savingsRate >= 0.15) status = "Stable";

    // ------------------------
    // TOP SPEND CATEGORY (case-insensitive: "Rent" == "rent ")
    // ------------------------
    const categoryMap = {};
    outflows.forEach(o => {
        const label = String(o.category).trim() || "other";
        const key = label.toLowerCase();
        if (!categoryMap[key]) categoryMap[key] = { label, total: 0 };
        categoryMap[key].total += o.amount;
    });

    let topCategory = "—";
    let max = 0;
    Object.values(categoryMap).forEach(({ label, total }) => {
        if (total > max) {
            max = total;
            topCategory = label;
        }
    });

    // ------------------------
    // MRR (salary only)
    // ------------------------
    const monthlySalary = {};
    effectiveTxns.forEach(t => {
        if (t.type !== "income" || t.subtype !== "salary") return;
        const m = monthKey(t.date);
        if (!m) return;
        monthlySalary[m] = (monthlySalary[m] || 0) + amountOf(t);
    });

    const salaryMonths = Object.values(monthlySalary);
    const MRR = salaryMonths.length
        ? salaryMonths.reduce((a, b) => a + b, 0) / salaryMonths.length
        : 0;

    // ------------------------
    // MONTHLY CASH FLOW
    // ------------------------
    const monthlyFlow = {};
    const bucket = m => (monthlyFlow[m] ||= { inc: 0, exp: 0 });

    inflows.forEach(i => {
        const m = monthKey(i.date);
        if (m) bucket(m).inc += i.amount;
    });
    outflows.forEach(o => {
        const m = monthKey(o.date);
        if (m) bucket(m).exp += o.amount;
    });

    const flowMonths = Object.keys(monthlyFlow).sort();
    const last = flowMonths[flowMonths.length - 1];
    const lastMonthFlow = last ? monthlyFlow[last].inc - monthlyFlow[last].exp : 0;

    // ------------------------
    // AVG EXPENSE (latest 3 months with spending)
    // ------------------------
    const expenseMonths = flowMonths.filter(m => monthlyFlow[m].exp > 0);
    const last3 = expenseMonths.slice(-3);
    const avgExpense = last3.length
        ? last3.reduce((s, m) => s + monthlyFlow[m].exp, 0) / last3.length
        : 0;

    // Months of spending current cash can cover.
    const emergencyCoverage = avgExpense > 0 ? Math.max(0, totalCash) / avgExpense : 0;

    // ------------------------
    // AVG TRANSACTION SIZE (outgoing)
    // ------------------------
    const avgTransaction = outflows.length
        ? outflows.reduce((s, o) => s + o.amount, 0) / outflows.length
        : 0;

    // ------------------------
    // HFRI (last 12 months of activity)
    // ------------------------
    const hfri = computeHouseholdHFRI({
        household,
        recordedMonths,
        today,
        debt: totalLiabilities,
        liquid: Math.max(0, totalCash)
    });

    return {
        balances,
        totalCash,
        income,
        expense,
        totalAssets,
        totalLiabilities,
        netWorth,
        savingsRate,
        emergencyCoverage,
        MRR,
        topCategory,
        status,
        avgExpense,
        avgTransaction,
        lastMonthFlow,
        assetValues,
        liabilityOutstanding,
        emiStatus,
        hfri
    };
}

function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.toISOString().slice(0, 7);
}

// Turns Arbor's monthly ledger into the paper's HFRI inputs.
//   Y  = annual disposable income   (income - tax)
//   C  = annual spending            (expenses, excluding tax and debt service)
//   DS = annual debt service        (loan repayments + EMIs)
//   Db = outstanding debt           (all liabilities today)
//   L  = liquid savings             (total cash in accounts)
//   C_essential,m = avg monthly essential spending (non-discretionary)
//   CV = std dev / mean of monthly spending
// Monthly averages cover every month from the first to the latest
// month in which the user recorded entries (max 12 months back), so a
// month with no spending counts as a real zero. Automatic EMIs never
// extend the window: otherwise an EMI due on the 1st would add a
// mostly-empty current month and drag average income down.
function computeHouseholdHFRI({ household, recordedMonths, today, debt, liquid }) {
    const currentMonth = monthKey(today);
    const windowStart = shiftMonth(currentMonth, -(HFRI_WINDOW_MONTHS - 1));

    const active = [...recordedMonths]
        .filter(m => m >= windowStart && m <= currentMonth)
        .sort();

    if (!active.length) {
        return { available: false, reason: "Add income and expenses to calculate HFRI." };
    }

    const months = [];
    for (let m = active[0]; m <= active[active.length - 1]; m = shiftMonth(m, 1)) months.push(m);

    const rows = months.map(m => household[m] || { income: 0, tax: 0, spending: 0, essential: 0, debtService: 0 });
    const n = rows.length;
    const sum = key => rows.reduce((s, r) => s + r[key], 0);

    const monthlyIncome = (sum("income") - sum("tax")) / n;
    const monthlySpending = sum("spending") / n;
    const monthlyEssential = sum("essential") / n;
    const monthlyDebtService = sum("debtService") / n;

    if (monthlyIncome <= 0) {
        return { available: false, reason: "HFRI needs income (after tax) in the last 12 months.", months: n };
    }
    if (n < HFRI_MIN_MONTHS) {
        return {
            available: false,
            reason: `HFRI needs at least ${HFRI_MIN_MONTHS} months of activity to measure expense stability.`,
            months: n
        };
    }

    const spendSeries = rows.map(r => r.spending);
    const variance = spendSeries.reduce((s, v) => s + (v - monthlySpending) ** 2, 0) / n;
    const cv = monthlySpending > 0 ? Math.sqrt(variance) / monthlySpending : 0;

    const inputs = {
        income: monthlyIncome * 12,
        spending: monthlySpending * 12,
        debt,
        debtService: monthlyDebtService * 12,
        liquid,
        // fall back to all spending if nothing is tagged essential
        essentialMonthly: monthlyEssential > 0 ? monthlyEssential : monthlySpending,
        cv
    };

    return { available: true, months: n, inputs, ...computeHFRI(inputs) };
}
