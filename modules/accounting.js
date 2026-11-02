// ==========================================================
// ARBOR BOOKS — double-entry accounting engine (pure functions)
// ----------------------------------------------------------
// Every journal entry has >= 2 lines and total debits equal
// total credits, so the books always balance. Final accounts
// follow the Indian T-format (Trading A/c, Profit & Loss A/c,
// Balance Sheet) with periodic inventory: purchases are
// expensed and stock is valued by physical count.
//
// Amounts are handled in paise (integers) internally so totals
// never drift by floating-point error.
// ==========================================================

export const GROUPS = {
    fixed_asset:         { label: "Fixed assets",          nature: "debit",  section: "asset" },
    current_asset:       { label: "Current assets",        nature: "debit",  section: "asset" },
    opening_stock:       { label: "Opening stock",         nature: "debit",  section: "trading" },
    current_liability:   { label: "Current liabilities",   nature: "credit", section: "liability" },
    long_term_liability: { label: "Long-term liabilities", nature: "credit", section: "liability" },
    capital:             { label: "Capital",               nature: "credit", section: "equity" },
    drawings:            { label: "Drawings",              nature: "debit",  section: "equity" },
    sales:               { label: "Sales",                 nature: "credit", section: "trading" },
    sales_return:        { label: "Sales returns",         nature: "debit",  section: "trading" },
    purchases:           { label: "Purchases",             nature: "debit",  section: "trading" },
    purchase_return:     { label: "Purchase returns",      nature: "credit", section: "trading" },
    direct_expense:      { label: "Direct expenses",       nature: "debit",  section: "trading" },
    indirect_expense:    { label: "Indirect expenses",     nature: "debit",  section: "pl" },
    indirect_income:     { label: "Other income",          nature: "credit", section: "pl" }
};

export const GROUP_ORDER = Object.keys(GROUPS);

// kind tags drive quick-entry pickers and ratios
// cash | bank | receivable | payable | inventory | non_cash (expenses that use no cash: depreciation, bad debts)
export const DEFAULT_CHART = [
    { code: "1001", name: "Cash in Hand", group: "current_asset", kind: "cash" },
    { code: "1002", name: "Bank Account", group: "current_asset", kind: "bank" },
    { code: "1101", name: "Debtors (Accounts Receivable)", group: "current_asset", kind: "receivable" },
    { code: "1201", name: "Prepaid Expenses", group: "current_asset" },
    { code: "1501", name: "Furniture & Fixtures", group: "fixed_asset" },
    { code: "1502", name: "Plant & Machinery", group: "fixed_asset" },
    { code: "1503", name: "Computers & Equipment", group: "fixed_asset" },
    { code: "1504", name: "Vehicles", group: "fixed_asset" },
    { code: "1601", name: "Opening Stock", group: "opening_stock", kind: "inventory" },
    { code: "2001", name: "Creditors (Accounts Payable)", group: "current_liability", kind: "payable" },
    { code: "2002", name: "Outstanding Expenses", group: "current_liability" },
    { code: "2501", name: "Bank Loan", group: "long_term_liability" },
    { code: "3001", name: "Capital", group: "capital" },
    { code: "3002", name: "Drawings", group: "drawings" },
    { code: "4001", name: "Sales", group: "sales" },
    { code: "4002", name: "Sales Returns", group: "sales_return" },
    { code: "4501", name: "Interest Received", group: "indirect_income" },
    { code: "4502", name: "Commission Received", group: "indirect_income" },
    { code: "4503", name: "Discount Received", group: "indirect_income" },
    { code: "5001", name: "Purchases", group: "purchases" },
    { code: "5002", name: "Purchase Returns", group: "purchase_return" },
    { code: "5101", name: "Wages", group: "direct_expense" },
    { code: "5102", name: "Carriage Inwards", group: "direct_expense" },
    { code: "5103", name: "Factory Power & Fuel", group: "direct_expense" },
    { code: "6001", name: "Salaries", group: "indirect_expense" },
    { code: "6002", name: "Rent", group: "indirect_expense" },
    { code: "6003", name: "Electricity", group: "indirect_expense" },
    { code: "6004", name: "Advertising & Marketing", group: "indirect_expense" },
    { code: "6005", name: "Office Expenses", group: "indirect_expense" },
    { code: "6006", name: "Depreciation", group: "indirect_expense", kind: "non_cash" },
    { code: "6007", name: "Interest on Loan", group: "indirect_expense" },
    { code: "6008", name: "Bank Charges", group: "indirect_expense" },
    { code: "6009", name: "Discount Allowed", group: "indirect_expense" },
    { code: "6010", name: "Bad Debts", group: "indirect_expense", kind: "non_cash" },
    { code: "6011", name: "Carriage Outwards", group: "indirect_expense" }
];

// ---------- money in paise ----------
export const toPaise = v => Math.round((Number(v) || 0) * 100);
export const fromPaise = p => p / 100;

// ---------- dates ----------
function dayKey(value) {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Indian financial year (1 April – 31 March) containing `date`.
export function financialYear(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return { from: `${y}-04-01`, to: `${y + 1}-03-31`, label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}` };
}

// ---------- validation ----------
// Returns a list of problems; empty means the entry can be posted.
export function validateEntry(entry, accountsById) {
    const errors = [];
    if (!dayKey(entry?.date)) errors.push("Enter a valid date.");
    const lines = (entry?.lines || []).filter(l => l && (toPaise(l.debit) || toPaise(l.credit)));
    if (lines.length < 2) errors.push("A journal entry needs at least two lines (one debit and one credit).");

    let dr = 0, cr = 0, hasDr = false, hasCr = false;
    lines.forEach((l, i) => {
        const d = toPaise(l.debit), c = toPaise(l.credit);
        if (!l.accountId || !accountsById[l.accountId]) errors.push(`Line ${i + 1}: choose an account.`);
        if (d < 0 || c < 0) errors.push(`Line ${i + 1}: amounts cannot be negative.`);
        if (d && c) errors.push(`Line ${i + 1}: a line is either a debit or a credit, not both.`);
        dr += d; cr += c;
        if (d > 0) hasDr = true;
        if (c > 0) hasCr = true;
    });
    if (lines.length >= 2 && (!hasDr || !hasCr)) errors.push("An entry needs at least one debit and one credit.");
    if (dr !== cr) errors.push(`Debits (${fromPaise(dr).toFixed(2)}) must equal credits (${fromPaise(cr).toFixed(2)}).`);
    if (dr === 0) errors.push("The entry total cannot be zero.");
    return errors;
}

export function cleanLines(lines) {
    return lines
        .filter(l => l.accountId && (toPaise(l.debit) || toPaise(l.credit)))
        .map(l => ({ accountId: l.accountId, debit: fromPaise(toPaise(l.debit)), credit: fromPaise(toPaise(l.credit)) }));
}

// ---------- core aggregation ----------
function sortEntries(entries) {
    return [...entries].sort((a, b) => {
        const d = (dayKey(a.date) || "").localeCompare(dayKey(b.date) || "");
        if (d) return d;
        return (a.createdAt?.seconds || a.createdAt || 0) - (b.createdAt?.seconds || b.createdAt || 0);
    });
}

// Per-account debit/credit totals (paise) for entries with from <= date <= to.
function totals(entries, { from = null, to = null } = {}) {
    const map = {};
    for (const e of entries) {
        const d = dayKey(e.date);
        if (!d || (from && d < from) || (to && d > to)) continue;
        for (const l of e.lines || []) {
            const t = (map[l.accountId] ||= { dr: 0, cr: 0 });
            t.dr += toPaise(l.debit);
            t.cr += toPaise(l.credit);
        }
    }
    return map;
}

const net = (t, nature) => !t ? 0 : nature === "debit" ? t.dr - t.cr : t.cr - t.dr;

function dayBefore(key) {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// Inventory value on `date` (periodic method):
// the latest physical stock count on or before that date, plus any
// stock introduced (posted to an opening-stock account) after that
// count; before any count, the opening-stock balance to that date.
export function inventoryAt(date, stockCounts, openingStockPostings) {
    const key = dayKey(date);
    const posted = (afterExclusive) => openingStockPostings
        .filter(p => p.date <= key && (!afterExclusive || p.date > afterExclusive))
        .reduce((s, p) => s + p.amount, 0);
    const counts = (stockCounts || [])
        .filter(c => dayKey(c.date) && dayKey(c.date) <= key)
        .sort((a, b) => dayKey(a.date).localeCompare(dayKey(b.date)));
    if (!counts.length) return posted(null);
    const last = counts[counts.length - 1];
    return toPaise(last.value) + posted(dayKey(last.date));
}

// ==========================================================
// FULL BOOKS FOR A PERIOD
// ==========================================================
export function computeBooks({ accounts = [], entries = [], stockCounts = [] }, period) {
    const from = dayKey(period?.from);
    const to = dayKey(period?.to);
    const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
    const groupOf = id => byId[id]?.group;
    const natureOf = id => GROUPS[groupOf(id)]?.nature || "debit";

    const all = totals(entries, { to });                       // cumulative to period end
    const prior = from ? totals(entries, { to: dayBefore(from) }) : {};
    const inPeriod = totals(entries, { from, to });

    // every posting to opening-stock accounts, by date (paise, debit positive)
    const stockAccIds = new Set(accounts.filter(a => a.group === "opening_stock").map(a => a.id));
    const openingStockPostings = [];
    for (const e of entries) {
        const d = dayKey(e.date);
        if (!d) continue;
        for (const l of e.lines || []) {
            if (stockAccIds.has(l.accountId)) openingStockPostings.push({ date: d, amount: toPaise(l.debit) - toPaise(l.credit) });
        }
    }
    const postedBetween = (fromKey, toKey) => openingStockPostings
        .filter(p => (!fromKey || p.date >= fromKey) && p.date <= toKey)
        .reduce((s, p) => s + p.amount, 0);

    const stockBeforePeriod = from ? inventoryAt(dayBefore(from), stockCounts, openingStockPostings) : 0;
    // Trading A/c opening stock = stock carried in + stock introduced during the period
    const openingStock = stockBeforePeriod + postedBetween(from, to);
    const closingStock = inventoryAt(to, stockCounts, openingStockPostings);
    const hasClosingCount = (stockCounts || []).some(c => dayKey(c.date) && dayKey(c.date) <= to && (!from || dayKey(c.date) >= from));

    const sumGroup = (map, group) => accounts
        .filter(a => a.group === group)
        .reduce((s, a) => s + net(map[a.id], GROUPS[group].nature), 0);

    const listGroup = (map, group) => accounts
        .filter(a => a.group === group)
        .map(a => ({ id: a.id, name: a.name, amount: net(map[a.id], GROUPS[group].nature) }))
        .filter(r => r.amount !== 0);

    // ---- profit before the period (retained earnings b/f) ----
    const profitOf = (map, openStock, closeStock) => {
        const income = ["sales", "purchase_return", "indirect_income"].reduce((s, g) => s + sumGroup(map, g), 0);
        const expense = ["sales_return", "purchases", "direct_expense", "indirect_expense"].reduce((s, g) => s + sumGroup(map, g), 0);
        return income - expense + (closeStock - openStock);
    };
    const retainedBF = from ? profitOf(prior, from ? postedBetween(null, dayBefore(from)) : 0, stockBeforePeriod) : 0;

    // ---- TRADING ACCOUNT ----
    const sales = sumGroup(inPeriod, "sales");
    const salesReturns = sumGroup(inPeriod, "sales_return");
    const purchases = sumGroup(inPeriod, "purchases");
    const purchaseReturns = sumGroup(inPeriod, "purchase_return");
    const directExpenses = listGroup(inPeriod, "direct_expense");
    const directTotal = directExpenses.reduce((s, r) => s + r.amount, 0);

    const netSales = sales - salesReturns;
    const netPurchases = purchases - purchaseReturns;
    const cogs = openingStock + netPurchases + directTotal - closingStock;
    const grossProfit = netSales - cogs;

    const tradingDr = [
        { label: "To Opening Stock", amount: openingStock },
        { label: "To Purchases", amount: purchases, less: purchaseReturns ? { label: "Less: Purchase Returns", amount: purchaseReturns } : null, net: netPurchases },
        ...directExpenses.map(r => ({ label: `To ${r.name}`, amount: r.amount }))
    ].filter(r => r.amount || r.less);
    const tradingCr = [
        { label: "By Sales", amount: sales, less: salesReturns ? { label: "Less: Sales Returns", amount: salesReturns } : null, net: netSales },
        { label: "By Closing Stock", amount: closingStock }
    ].filter(r => r.amount || r.less);
    if (grossProfit >= 0) tradingDr.push({ label: "To Gross Profit c/d", amount: grossProfit, result: true });
    else tradingCr.push({ label: "By Gross Loss c/d", amount: -grossProfit, result: true });

    const lineValue = r => (r.net !== undefined ? r.net : r.amount);
    const tradingTotal = Math.max(
        tradingDr.reduce((s, r) => s + lineValue(r), 0),
        tradingCr.reduce((s, r) => s + lineValue(r), 0)
    );

    // ---- PROFIT & LOSS ACCOUNT ----
    const indirectExpenses = listGroup(inPeriod, "indirect_expense");
    const indirectIncome = listGroup(inPeriod, "indirect_income");
    const indirectExpTotal = indirectExpenses.reduce((s, r) => s + r.amount, 0);
    const indirectIncTotal = indirectIncome.reduce((s, r) => s + r.amount, 0);
    const netProfit = grossProfit + indirectIncTotal - indirectExpTotal;

    const plDr = [], plCr = [];
    if (grossProfit >= 0) plCr.push({ label: "By Gross Profit b/d", amount: grossProfit });
    else plDr.push({ label: "To Gross Loss b/d", amount: -grossProfit });
    indirectExpenses.forEach(r => plDr.push({ label: `To ${r.name}`, amount: r.amount }));
    indirectIncome.forEach(r => plCr.push({ label: `By ${r.name}`, amount: r.amount }));
    if (netProfit >= 0) plDr.push({ label: "To Net Profit (transferred to Capital)", amount: netProfit, result: true });
    else plCr.push({ label: "By Net Loss (transferred to Capital)", amount: -netProfit, result: true });
    const plTotal = Math.max(plDr.reduce((s, r) => s + r.amount, 0), plCr.reduce((s, r) => s + r.amount, 0));

    // ---- BALANCE SHEET (as at period end) ----
    const capitalAccounts = listGroup(all, "capital");
    const capitalTotal = capitalAccounts.reduce((s, r) => s + r.amount, 0);
    const drawings = sumGroup(all, "drawings");
    const closingCapital = capitalTotal + retainedBF + netProfit - drawings;

    const longTerm = listGroup(all, "long_term_liability");
    const currentLiab = listGroup(all, "current_liability");
    const fixedAssets = listGroup(all, "fixed_asset");
    const currentAssets = listGroup(all, "current_asset");

    const liabTotal = closingCapital
        + longTerm.reduce((s, r) => s + r.amount, 0)
        + currentLiab.reduce((s, r) => s + r.amount, 0);
    const assetTotal = fixedAssets.reduce((s, r) => s + r.amount, 0)
        + currentAssets.reduce((s, r) => s + r.amount, 0)
        + closingStock;

    const balanceSheet = {
        capital: {
            accounts: capitalAccounts,
            retainedBF,
            netProfit,
            drawings,
            closing: closingCapital
        },
        longTerm,
        currentLiab,
        fixedAssets,
        currentAssets,
        closingStock,
        liabTotal,
        assetTotal,
        balanced: liabTotal === assetTotal
    };

    // ---- TRIAL BALANCE (period view, before closing stock adjustment) ----
    const tbRows = [];
    for (const a of accounts) {
        const nature = GROUPS[a.group]?.nature || "debit";
        const isNominal = ["trading", "pl"].includes(GROUPS[a.group]?.section);
        if (a.group === "opening_stock") continue; // shown as one line below
        const map = isNominal ? inPeriod : all;
        const t = map[a.id];
        if (!t) continue;
        const bal = t.dr - t.cr;
        if (bal === 0) continue;
        tbRows.push({ id: a.id, code: a.code, name: a.name, group: a.group, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0, nature });
    }
    if (openingStock) tbRows.unshift({ id: "_opening_stock", name: "Opening Stock", group: "opening_stock", debit: openingStock, credit: 0 });
    if (retainedBF) tbRows.push({ id: "_retained", name: "Profit & Loss A/c (balance b/f)", group: "capital", debit: retainedBF < 0 ? -retainedBF : 0, credit: retainedBF > 0 ? retainedBF : 0 });
    tbRows.sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group) || String(x.code || "").localeCompare(String(y.code || "")));
    const tbDebit = tbRows.reduce((s, r) => s + r.debit, 0);
    const tbCredit = tbRows.reduce((s, r) => s + r.credit, 0);

    // ---- CASH FLOW STATEMENT (direct method) ----
    const isCash = id => ["cash", "bank"].includes(byId[id]?.kind);
    const cashFlow = { operating: 0, investing: 0, financing: 0, lines: { operating: {}, investing: {}, financing: {} } };
    const cashOpening = accounts.filter(a => isCash(a.id)).reduce((s, a) => s + net(prior[a.id], "debit"), 0);
    for (const e of entries) {
        const d = dayKey(e.date);
        if (!d || (from && d < from) || d > to) continue;
        const lines = e.lines || [];
        const cashDelta = lines.filter(l => isCash(l.accountId)).reduce((s, l) => s + toPaise(l.debit) - toPaise(l.credit), 0);
        if (!cashDelta) continue;
        const others = lines.filter(l => !isCash(l.accountId)).map(l => groupOf(l.accountId));
        let activity = "operating";
        if (others.includes("fixed_asset")) activity = "investing";
        else if (others.some(g => ["capital", "drawings", "long_term_liability"].includes(g))) activity = "financing";
        cashFlow[activity] += cashDelta;
        // label by the main non-cash account
        const main = lines.filter(l => !isCash(l.accountId)).sort((a, b) => (toPaise(b.debit) + toPaise(b.credit)) - (toPaise(a.debit) + toPaise(a.credit)))[0];
        const label = main ? (byId[main.accountId]?.name || "Other") : "Transfers between cash and bank";
        cashFlow.lines[activity][label] = (cashFlow.lines[activity][label] || 0) + cashDelta;
    }
    cashFlow.netChange = cashFlow.operating + cashFlow.investing + cashFlow.financing;
    cashFlow.opening = cashOpening;
    cashFlow.closing = accounts.filter(a => isCash(a.id)).reduce((s, a) => s + net(all[a.id], "debit"), 0);

    // ---- KEY FIGURES + RATIOS ----
    const sumKind = (kind) => accounts.filter(a => a.kind === kind).reduce((s, a) => s + net(all[a.id], GROUPS[a.group].nature), 0);
    const cash = sumKind("cash") + sumKind("bank");
    const receivables = sumKind("receivable");
    const payables = sumKind("payable");
    const currentAssetsTotal = currentAssets.reduce((s, r) => s + r.amount, 0) + closingStock;
    const currentLiabTotal = currentLiab.reduce((s, r) => s + r.amount, 0);
    const longTermTotal = longTerm.reduce((s, r) => s + r.amount, 0);
    const ratio = (a, b) => (b > 0 ? a / b : null);
    const operatingExpenses = netPurchases + directTotal + indirectExpTotal;
    const nonCashExpenses = accounts.filter(a => a.kind === "non_cash").reduce((s, a) => s + net(inPeriod[a.id], "debit"), 0);

    const figures = {
        netSales, cogs, grossProfit, netProfit, indirectExpTotal, indirectIncTotal, directTotal,
        netPurchases, openingStock, closingStock, hasClosingCount,
        cash, receivables, payables,
        workingCapital: currentAssetsTotal - currentLiabTotal,
        currentAssetsTotal, currentLiabTotal, longTermTotal,
        equity: closingCapital,
        totalAssets: assetTotal,
        operatingExpenses,
        nonCashExpenses
    };
    const ratios = {
        grossMargin: ratio(grossProfit, netSales),
        netMargin: ratio(netProfit, netSales),
        currentRatio: ratio(currentAssetsTotal, currentLiabTotal),
        quickRatio: ratio(currentAssetsTotal - closingStock, currentLiabTotal),
        debtToEquity: closingCapital > 0 ? longTermTotal / closingCapital : null,
        returnOnEquity: ratio(netProfit, closingCapital),
        debtorDays: netSales > 0 ? (receivables / netSales) * periodDays(from, to) : null,
        creditorDays: netPurchases > 0 ? (payables / netPurchases) * periodDays(from, to) : null
    };

    return {
        period: { from, to },
        trading: { dr: tradingDr, cr: tradingCr, total: tradingTotal },
        pl: { dr: plDr, cr: plCr, total: plTotal },
        balanceSheet,
        trialBalance: { rows: tbRows, debit: tbDebit, credit: tbCredit, balanced: tbDebit === tbCredit },
        cashFlow,
        figures,
        ratios
    };
}

function periodDays(from, to) {
    if (!from || !to) return 365;
    return Math.max(1, Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1);
}

// ---------- LEDGER for one account ----------
export function accountLedger(accountId, { accounts = [], entries = [] }, period) {
    const from = dayKey(period?.from), to = dayKey(period?.to);
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return null;
    const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
    const nominal = ["trading", "pl"].includes(GROUPS[acc.group]?.section);

    // Real accounts carry a balance forward; nominal accounts start each period at zero.
    let running = 0;
    if (from && !nominal) {
        const t = totals(entries, { to: dayBefore(from) })[accountId];
        running = t ? t.dr - t.cr : 0;
    }
    const opening = running;

    const rows = [];
    for (const e of sortEntries(entries)) {
        const d = dayKey(e.date);
        if (!d || (from && d < from) || (to && d > to)) continue;
        const mine = (e.lines || []).filter(l => l.accountId === accountId);
        if (!mine.length) continue;
        const contra = (e.lines || []).filter(l => l.accountId !== accountId).map(l => byId[l.accountId]?.name).filter(Boolean);
        for (const l of mine) {
            const dr = toPaise(l.debit), cr = toPaise(l.credit);
            running += dr - cr;
            rows.push({
                entryId: e.id, date: d, narration: e.narration || "",
                particulars: contra.length ? `${dr ? "To" : "By"} ${contra.length > 2 ? `${contra[0]} & others` : contra.join(", ")}` : "",
                debit: dr, credit: cr, balance: running
            });
        }
    }
    return { account: acc, opening, rows, closing: running, nominal };
}

// ---------- monthly business series (for charts + forecasting) ----------
export function monthlyBusinessSeries({ accounts = [], entries = [] }, { to, months = 12 } = {}) {
    const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
    const end = dayKey(to) || new Date().toISOString().slice(0, 10);
    const keys = [];
    const [y, m] = end.split("-").map(Number);
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        keys.push(d.toISOString().slice(0, 7));
    }
    const rows = Object.fromEntries(keys.map(k => [k, { month: k, revenue: 0, expenses: 0, operatingCash: 0 }]));
    const isCash = id => ["cash", "bank"].includes(byId[id]?.kind);

    for (const e of entries) {
        const d = dayKey(e.date);
        if (!d || d > end) continue;
        const row = rows[d.slice(0, 7)];
        if (!row) continue;
        let opCash = true;
        for (const l of e.lines || []) {
            const g = byId[l.accountId]?.group;
            const dr = toPaise(l.debit), cr = toPaise(l.credit);
            if (g === "sales" || g === "indirect_income") row.revenue += cr - dr;
            if (g === "sales_return") row.revenue -= dr - cr;
            if (["purchases", "direct_expense", "indirect_expense"].includes(g)) row.expenses += dr - cr;
            if (g === "purchase_return") row.expenses -= cr - dr;
            if (["fixed_asset", "capital", "drawings", "long_term_liability"].includes(g)) opCash = false;
        }
        if (opCash) row.operatingCash += (e.lines || []).filter(l => isCash(l.accountId)).reduce((s, l) => s + toPaise(l.debit) - toPaise(l.credit), 0);
    }
    return keys.map(k => ({
        month: k,
        revenue: fromPaise(rows[k].revenue),
        expenses: fromPaise(rows[k].expenses),
        operatingCash: fromPaise(rows[k].operatingCash)
    }));
}
