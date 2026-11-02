// ==========================================================
// ARBOR BUSINESS WORKSPACE
// Double-entry books: Journal → Ledger → Trial Balance →
// Trading A/c, Profit & Loss A/c, Balance Sheet, Cash Flow.
// ==========================================================
import {
    GROUPS, GROUP_ORDER, computeBooks, accountLedger, monthlyBusinessSeries,
    financialYear, validateEntry, fromPaise, toPaise
} from "./modules/accounting.js";
import {
    loadBooks, seedChartOfAccounts, createLedgerAccount, deleteLedgerAccount,
    postJournal, deleteJournal, addStockCount, deleteStockCount
} from "./modules/books.js";
import { businessStressTest, businessMonteCarlo, BUSINESS_SCENARIOS, logVolatility } from "./modules/simulate.js";
import {
    escapeHTML, formatMoney, formatShort, pct, kpi, emptyState, shortDate, localISODate,
    renderShell, barChart, fanChart, pathChart, numField, monthLabel
} from "./modules/ui.js";

const P = p => fromPaise(p);                          // paise → rupees
const money = p => formatMoney(fromPaise(p), { decimals: 2 });
const moneyR = r => formatMoney(r, { decimals: 2 });  // rupees

const NAV = [
    { key: "overview", label: "Overview" },
    { key: "journal", label: "Journal" },
    { key: "ledger", label: "Ledger" },
    { key: "trial", label: "Trial balance" },
    { key: "statements", label: "Final accounts" },
    { key: "accounts", label: "Chart of accounts" },
    { section: "Analysis" },
    { key: "stress", label: "Stress test" },
    { key: "forecast", label: "Cash forecast" },
    { section: "Help" },
    { key: "guide", label: "Guide" }
];
const VIEWS = NAV.filter(n => n.key).map(n => n.key);

// ---------- quick-entry templates ----------
const is = {
    cashbank: a => a.kind === "cash" || a.kind === "bank",
    receivable: a => a.kind === "receivable",
    payable: a => a.kind === "payable",
    group: (...g) => a => g.includes(a.group),
    expense: a => a.group === "direct_expense" || a.group === "indirect_expense",
    or: (...fs) => a => fs.some(f => f(a))
};

const TEMPLATES = [
    { key: "cash_sale", label: "Sale (paid now)", hint: "Goods or services sold and paid for immediately.", dr: ["Received into", is.cashbank], cr: ["Sales account", is.group("sales")], narr: "Being goods sold for cash" },
    { key: "credit_sale", label: "Sale on credit", hint: "Sold now, customer pays later. Creates a receivable.", dr: ["Customer (debtor)", is.receivable], cr: ["Sales account", is.group("sales")], narr: "Being goods sold on credit" },
    { key: "receipt", label: "Customer pays", hint: "A customer settles what they owe you.", dr: ["Received into", is.cashbank], cr: ["From customer", is.receivable], narr: "Being amount received from debtor" },
    { key: "sales_return", label: "Sales return", hint: "A customer returns goods.", dr: ["Sales returns account", is.group("sales_return")], cr: ["Credit to", is.or(is.receivable, is.cashbank)], narr: "Being goods returned by customer" },
    { key: "cash_purchase", label: "Purchase (paid now)", hint: "Stock or materials bought for resale or production, paid now.", dr: ["Purchases account", is.group("purchases")], cr: ["Paid from", is.cashbank], narr: "Being goods purchased for cash" },
    { key: "credit_purchase", label: "Purchase on credit", hint: "Bought now, you pay the supplier later. Creates a payable.", dr: ["Purchases account", is.group("purchases")], cr: ["Supplier (creditor)", is.payable], narr: "Being goods purchased on credit" },
    { key: "supplier_payment", label: "Pay a supplier", hint: "You settle what you owe a supplier.", dr: ["To supplier", is.payable], cr: ["Paid from", is.cashbank], narr: "Being amount paid to creditor" },
    { key: "purchase_return", label: "Purchase return", hint: "You return goods to a supplier.", dr: ["Debit", is.or(is.payable, is.cashbank)], cr: ["Purchase returns account", is.group("purchase_return")], narr: "Being goods returned to supplier" },
    { key: "expense", label: "Pay an expense", hint: "Rent, salaries, electricity, wages, advertising…", dr: ["Expense", is.expense], cr: ["Paid from", is.cashbank], narr: "Being expense paid" },
    { key: "accrual", label: "Expense due, not yet paid", hint: "An expense belongs to this period but is unpaid (outstanding).", dr: ["Expense", is.expense], cr: ["Liability", is.group("current_liability")], narr: "Being expense outstanding" },
    { key: "other_income", label: "Other income", hint: "Interest, commission or other non-sales income received.", dr: ["Received into", is.cashbank], cr: ["Income account", is.group("indirect_income")], narr: "Being income received" },
    { key: "asset", label: "Buy a fixed asset", hint: "Furniture, machinery, computers, vehicles…", dr: ["Asset", is.group("fixed_asset")], cr: ["Paid by", is.or(is.cashbank, is.payable, is.group("long_term_liability"))], narr: "Being fixed asset purchased" },
    { key: "depreciation", label: "Charge depreciation", hint: "Write down a fixed asset for wear and tear (no cash moves).", dr: ["Depreciation account", a => a.kind === "non_cash" || /depreciation/i.test(a.name)], cr: ["Asset", is.group("fixed_asset")], narr: "Being depreciation charged" },
    { key: "capital", label: "Owner adds capital", hint: "The owner invests money in the business.", dr: ["Received into", is.or(is.cashbank, is.group("fixed_asset"))], cr: ["Capital account", is.group("capital")], narr: "Being capital introduced" },
    { key: "drawings", label: "Owner withdraws (drawings)", hint: "The owner takes money out for personal use. This isn't an expense.", dr: ["Drawings account", is.group("drawings")], cr: ["Paid from", is.cashbank], narr: "Being cash withdrawn for personal use" },
    { key: "loan_in", label: "Loan received", hint: "Money borrowed by the business.", dr: ["Received into", is.cashbank], cr: ["Loan account", is.group("long_term_liability", "current_liability")], narr: "Being loan received" },
    { key: "loan_repay", label: "Repay loan principal", hint: "Principal only. Record interest with “Pay an expense” → Interest on Loan.", dr: ["Loan account", is.group("long_term_liability", "current_liability")], cr: ["Paid from", is.cashbank], narr: "Being loan repaid" },
    { key: "contra", label: "Move money (cash ↔ bank)", hint: "Deposit cash into the bank or withdraw it. A contra entry.", dr: ["Money goes to", is.cashbank], cr: ["Money comes from", is.cashbank], narr: "Being contra entry" },
    { key: "opening", label: "Opening balance", hint: "Bring an existing balance (bank, stock, asset, loan, debtor…) into the books. The other side goes to Capital.", opening: true, narr: "Being opening balance brought into books" }
];

const periodKey = pid => `arbor.bizPeriod.${pid}`;

// ==========================================================
export async function renderBusiness({ user, profile, onSwitch, onLogout }) {
    let books = await loadBooks(profile.id);
    if (!books.accounts.length) {
        await seedChartOfAccounts(profile.id);
        books = await loadBooks(profile.id);
    }
    const { accounts, entries, stockCounts } = books;
    const byId = Object.fromEntries(accounts.map(a => [a.id, a]));

    // ---------- period ----------
    const today = localISODate();
    const fyNow = financialYear(new Date());
    const firstDate = entries.map(e => e.date).sort()[0] || today;
    const fyOptions = [];
    for (let fy = fyNow; ; ) {
        fyOptions.push(fy);
        // always offer the last 3 years (to start books for a past year), plus any year with entries
        if ((fy.from <= firstDate && fyOptions.length >= 3) || fyOptions.length > 15) break;
        const prev = new Date(`${fy.from}T00:00:00`); prev.setDate(prev.getDate() - 1);
        fy = financialYear(prev);
    }
    let periodChoice = localStorage.getItem(periodKey(profile.id)) || fyNow.from;
    if (!fyOptions.some(f => f.from === periodChoice)) periodChoice = fyNow.from;
    const fy = fyOptions.find(f => f.from === periodChoice);
    const isCurrent = fy.from === fyNow.from;
    const period = { from: fy.from, to: isCurrent && today < fy.to ? today : fy.to, label: fy.label + (isCurrent ? " (to date)" : "") };

    const b = computeBooks(books, period);
    const f = b.figures, r = b.ratios;

    let activeView = localStorage.getItem(`arbor.bizView.${profile.id}`) || "overview";
    if (!VIEWS.includes(activeView)) activeView = "overview";

    const periodSelect = `
        <label class="period-select" title="Accounting period">
            <span>Period</span>
            <select id="periodSelect">${fyOptions.map(o => `<option value="${o.from}" ${o.from === fy.from ? "selected" : ""}>${o.label}${o.from === fyNow.from ? " · current" : ""}</option>`).join("")}</select>
        </label>`;

    const periodText = `${shortDate(period.from)} – ${shortDate(period.to)}`;
    const META = {
        overview: [escapeHTML(profile.name), `Business overview · ${period.label} · ${periodText}`],
        journal: ["Journal", `Every transaction as a double entry · ${period.label}`],
        ledger: ["Ledger", "Each account's debits, credits and running balance"],
        trial: ["Trial balance", `As at ${shortDate(period.to)}: debits must equal credits`],
        statements: ["Final accounts", `Trading A/c, Profit & Loss A/c, Balance Sheet and Cash Flow · ${period.label}`],
        accounts: ["Chart of accounts", "The accounts your books use, and stock valuations"],
        stress: ["Stress test", "Break-even and cash runway if trading conditions turn"],
        forecast: ["Cash forecast", "Thousands of simulated futures for your bank balance (Monte Carlo)"],
        guide: ["Business guide", "How to keep proper books in Arbor, step by step"]
    };

    const ctx = { user, profile, accounts, entries, stockCounts, byId, books, b, f, r, period };
    const content = {
        overview: () => overviewView(ctx),
        journal: () => journalView(ctx),
        ledger: () => ledgerView(ctx),
        trial: () => trialView(ctx),
        statements: () => statementsView(ctx),
        accounts: () => accountsView(ctx),
        stress: () => stressView(ctx),
        forecast: () => forecastView(ctx),
        guide: () => businessGuide()
    }[activeView]();

    document.body.innerHTML = renderShell({
        user, profile, nav: NAV, activeView,
        title: META[activeView][0], subtitle: META[activeView][1],
        content, topExtra: periodSelect, addLabel: "+ Record transaction", addPanel: "quick",
        drawer: entryDrawer(ctx)
    });
    document.body.classList.add("is-business");

    const rerender = () => renderBusiness({ user, profile, onSwitch, onLogout });
    bindDrawer(ctx, rerender);
    if (activeView === "journal") bindJournalFilter();
    if (activeView === "ledger") bindLedger(ctx);
    if (activeView === "statements") bindStatements();
    if (activeView === "accounts") bindAccounts(ctx, rerender);
    if (activeView === "stress") bindStress(ctx);
    if (activeView === "forecast") bindForecast(ctx);

    document.getElementById("periodSelect").onchange = e => {
        localStorage.setItem(periodKey(profile.id), e.target.value);
        rerender();
    };

    let busy = false;
    document.body.onclick = async (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;
        const go = t.closest("[data-view], [data-go-view]");
        if (go && !t.closest(".drawer")) {
            const view = go.dataset.view || go.dataset.goView;
            if (go.dataset.ledgerAccount) sessionStorage.setItem("arbor.ledgerAccount", go.dataset.ledgerAccount);
            if (go.dataset.statement) sessionStorage.setItem("arbor.statement", go.dataset.statement);
            localStorage.setItem(`arbor.bizView.${profile.id}`, view);
            document.body.classList.remove("is-business");
            await rerender();
            window.scrollTo({ top: 0 });
            return;
        }
        if (t.id === "backBtn") { document.body.classList.remove("is-business"); await onSwitch(); return; }
        if (t.id === "logout") { await onLogout(); return; }
        const jump = t.closest("[data-guide-jump]");
        if (jump) { document.getElementById(jump.dataset.guideJump)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        const opener = t.closest("[data-open-panel]");
        if (opener) { openDrawer(opener.dataset.openPanel, opener.dataset.template); return; }
        if (t.closest("#overlay") || t.closest("#closePanel")) { closeDrawer(); return; }
        if (busy) return;

        const delEntry = t.closest("[data-delete-entry]");
        if (delEntry) {
            if (!confirm("Delete this journal entry? Both sides are removed together, so the books stay balanced.")) return;
            busy = true;
            try { await deleteJournal(profile.id, delEntry.dataset.deleteEntry); await rerender(); } finally { busy = false; }
            return;
        }
        const delAcc = t.closest("[data-delete-account]");
        if (delAcc) {
            const id = delAcc.dataset.deleteAccount;
            if (entries.some(en => (en.lines || []).some(l => l.accountId === id))) {
                alert("This account has entries. Accounts with history can't be deleted, so the books stay complete.");
                return;
            }
            if (!confirm("Delete this account?")) return;
            busy = true;
            try { await deleteLedgerAccount(profile.id, id); await rerender(); } finally { busy = false; }
            return;
        }
        const delCount = t.closest("[data-delete-count]");
        if (delCount) {
            if (!confirm("Delete this stock valuation?")) return;
            busy = true;
            try { await deleteStockCount(profile.id, delCount.dataset.deleteCount); await rerender(); } finally { busy = false; }
        }
    };
}

// ==========================================================
// OVERVIEW
// ==========================================================
function overviewView({ b, f, r, entries, byId, period, accounts }) {
    const series = monthlyBusinessSeries({ accounts, entries }, { to: period.to, months: 12 });
    const expenseBreakdown = [
        ...b.trading.dr.filter(x => !x.result && x.label !== "To Opening Stock").map(x => ({ label: x.label.replace(/^To /, ""), total: x.net ?? x.amount })),
        ...b.pl.dr.filter(x => !x.result && !/Gross Loss/.test(x.label)).map(x => ({ label: x.label.replace(/^To /, ""), total: x.amount }))
    ].filter(x => x.total > 0).sort((x, y) => y.total - x.total).slice(0, 7);
    const maxExp = expenseBreakdown[0]?.total || 1;

    const checks = [
        [b.trialBalance.balanced, "Trial balance agrees", `Debits ${money(b.trialBalance.debit)} = Credits ${money(b.trialBalance.credit)}`],
        [b.balanceSheet.balanced, "Balance sheet balances", `Assets ${money(b.balanceSheet.assetTotal)} = Liabilities + Capital`],
        [f.hasClosingCount || (!f.netPurchases && !f.closingStock), "Closing stock valued", f.hasClosingCount ? `Closing stock ${money(f.closingStock)}` : "No stock count in this period. Closing stock uses the last known value. Add a count in Chart of accounts → Stock valuation."],
        [f.cash >= 0, "Cash and bank not overdrawn", `Cash + bank ${money(f.cash)}`]
    ];

    const recent = [...entries].sort((x, y) => (y.date || "").localeCompare(x.date || "") || (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0)).slice(0, 6);

    return `
<div class="kpi-grid biz-kpis">
    ${kpi("Net sales", money(f.netSales), "Sales − returns this period")}
    ${kpi("Gross profit", money(f.grossProfit), `Gross margin ${pct(r.grossMargin)}`, f.grossProfit < 0 ? "neg" : "")}
    ${kpi("Net profit", money(f.netProfit), `Net margin ${pct(r.netMargin)}`, f.netProfit < 0 ? "neg" : "pos")}
    ${kpi("Cash & bank", money(f.cash), "Available now", f.cash < 0 ? "neg" : "")}
    ${kpi("Receivables", money(f.receivables), r.debtorDays !== null ? `≈ ${Math.round(r.debtorDays)} days of sales` : "Owed by customers")}
    ${kpi("Payables", money(f.payables), r.creditorDays !== null ? `≈ ${Math.round(r.creditorDays)} days of purchases` : "Owed to suppliers")}
    ${kpi("Working capital", money(f.workingCapital), "Current assets − current liabilities", f.workingCapital < 0 ? "neg" : "")}
    ${kpi("Current ratio", r.currentRatio === null ? "—" : r.currentRatio.toFixed(2), "Healthy ≈ 1.5–2.0", r.currentRatio !== null && r.currentRatio < 1 ? "neg" : "")}
    ${kpi("Quick ratio", r.quickRatio === null ? "—" : r.quickRatio.toFixed(2), "Excludes stock; ≥ 1 is comfortable")}
    ${kpi("Owner's equity", money(f.equity), `Return on equity ${pct(r.returnOnEquity)}`)}
    ${kpi("Debt to equity", r.debtToEquity === null ? "—" : r.debtToEquity.toFixed(2), "Long-term loans ÷ capital")}
</div>

<div class="grid-2-1">
    <section class="card">
        <div class="card-head"><h2>Revenue vs expenses</h2><div class="legend"><span><i class="bar-in"></i>Revenue</span><span><i class="bar-out"></i>Expenses</span></div></div>
        ${barChart(series, { a: "revenue", b: "expenses", labelA: "Revenue", labelB: "Expenses" })}
    </section>
    <section class="card">
        <div class="card-head"><h2>Books health</h2></div>
        <div class="checks">${checks.map(([ok, title, text]) => `
            <div class="check ${ok ? "ok" : "warn"}"><span>${ok ? "✓" : "!"}</span><div><strong>${title}</strong><p>${text}</p></div></div>`).join("")}
        </div>
    </section>
</div>

<div class="grid-1-2">
    <section class="card">
        <div class="card-head"><h2>Where costs go</h2></div>
        ${expenseBreakdown.length ? `<div class="cat-list">${expenseBreakdown.map(c => `
            <div class="cat-row"><div class="cat-head"><span>${escapeHTML(c.label)}</span><strong>${money(c.total)}</strong></div>
            <div class="progress"><i style="width:${(c.total / maxExp * 100).toFixed(1)}%"></i></div></div>`).join("")}</div>`
            : emptyState("No costs yet", "Purchases and expenses for this period will appear here.")}
    </section>
    <section class="card">
        <div class="card-head"><h2>Recent journal entries</h2><button class="link" data-go-view="journal">Open journal</button></div>
        ${recent.length ? journalTable(recent, byId, false) : emptyState("No entries yet", "Start by bringing in your opening balances, then record sales, purchases and expenses.", `<button class="btn btn-primary btn-sm" data-open-panel="quick" data-template="opening">Enter an opening balance</button>`)}
    </section>
</div>`;
}

// ==========================================================
// JOURNAL
// ==========================================================
function journalTable(list, byId, withActions = true) {
    return `<div class="table-wrap"><table class="table journal">
        <thead><tr><th>Date</th><th>Particulars</th><th class="num">Debit (₹)</th><th class="num">Credit (₹)</th>${withActions ? "<th></th>" : ""}</tr></thead>
        <tbody>${list.map(e => {
            const lines = [...(e.lines || [])].sort((x, y) => (toPaise(y.debit) ? 1 : 0) - (toPaise(x.debit) ? 1 : 0));
            const search = `${e.narration || ""} ${e.reference || ""} ${lines.map(l => byId[l.accountId]?.name || "").join(" ")}`.toLowerCase();
            return `<tr class="je" data-search="${escapeHTML(search)}">
                <td class="nowrap muted">${shortDate(e.date)}${e.reference ? `<div class="cell-sub">Ref ${escapeHTML(e.reference)}</div>` : ""}</td>
                <td>${lines.map(l => toPaise(l.debit)
                    ? `<div class="je-dr">${escapeHTML(byId[l.accountId]?.name || "Deleted account")} A/c <span class="muted">Dr.</span></div>`
                    : `<div class="je-cr">To ${escapeHTML(byId[l.accountId]?.name || "Deleted account")} A/c</div>`).join("")}
                    ${e.narration ? `<div class="je-narr">(${escapeHTML(e.narration)})</div>` : ""}</td>
                <td class="num">${lines.map(l => `<div>${toPaise(l.debit) ? moneyR(l.debit).replace("₹", "") : "&nbsp;"}</div>`).join("")}</td>
                <td class="num">${lines.map(l => `<div>${toPaise(l.credit) ? moneyR(l.credit).replace("₹", "") : "&nbsp;"}</div>`).join("")}</td>
                ${withActions ? `<td class="actions"><button class="row-delete" data-delete-entry="${e.id}" title="Delete entry" aria-label="Delete entry">×</button></td>` : ""}
            </tr>`;
        }).join("")}</tbody>
    </table></div>`;
}

function journalView({ entries, byId, period }) {
    const list = entries
        .filter(e => e.date >= period.from && e.date <= period.to)
        .sort((x, y) => x.date.localeCompare(y.date) || (x.createdAt?.seconds || 0) - (y.createdAt?.seconds || 0));
    const total = list.reduce((s, e) => s + (e.lines || []).reduce((t, l) => t + toPaise(l.debit), 0), 0);
    return `
<section class="card">
    <div class="toolbar">
        <div class="muted small">${list.length} entr${list.length === 1 ? "y" : "ies"} · total ${money(total)} debited and credited</div>
        <input class="search" id="journalSearch" type="search" placeholder="Search accounts, narration, reference…" aria-label="Search journal">
    </div>
    ${list.length ? journalTable(list, byId) : emptyState("No entries in this period", "Use “Record transaction” to post your first entry.", `<button class="btn btn-primary btn-sm" data-open-panel="quick">Record transaction</button>`)}
    <div class="empty filtered-empty" hidden><strong>No matching entries</strong><p>Try another search.</p></div>
</section>`;
}

function bindJournalFilter() {
    const input = document.getElementById("journalSearch");
    input?.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll("tr.je").forEach(row => { row.hidden = q && !row.dataset.search.includes(q); if (!row.hidden) shown++; });
        const empty = document.querySelector(".filtered-empty");
        if (empty) empty.hidden = shown > 0 || !document.querySelector("tr.je");
    });
}

// ==========================================================
// LEDGER
// ==========================================================
function ledgerView({ accounts, entries, period }) {
    const used = new Set(entries.flatMap(e => (e.lines || []).map(l => l.accountId)));
    let selected = sessionStorage.getItem("arbor.ledgerAccount");
    if (!accounts.some(a => a.id === selected)) selected = (accounts.find(a => used.has(a.id) && (a.kind === "bank" || a.kind === "cash")) || accounts.find(a => used.has(a.id)) || accounts[0])?.id;
    return `
<section class="card">
    <div class="toolbar">
        <label class="period-select wide"><span>Account</span>
            <select id="ledgerAccount">${GROUP_ORDER.map(g => {
                const list = accounts.filter(a => a.group === g);
                return list.length ? `<optgroup label="${GROUPS[g].label}">${list.map(a => `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${escapeHTML(a.name)}${used.has(a.id) ? "" : " (no entries)"}</option>`).join("")}</optgroup>` : "";
            }).join("")}</select>
        </label>
    </div>
    <div id="ledgerBody">${ledgerBody(selected, { accounts, entries }, period)}</div>
</section>`;
}

function ledgerBody(accountId, books, period) {
    const lg = accountLedger(accountId, books, period);
    if (!lg) return "";
    const nature = GROUPS[lg.account.group]?.nature || "debit";
    const balLabel = v => v === 0 ? "0.00" : `${moneyR(Math.abs(P(v))).replace("₹", "")} ${v > 0 ? "Dr" : "Cr"}`;
    const totalDr = lg.rows.reduce((s, x) => s + x.debit, 0) + (lg.opening > 0 ? lg.opening : 0);
    const totalCr = lg.rows.reduce((s, x) => s + x.credit, 0) + (lg.opening < 0 ? -lg.opening : 0);
    return `
    <div class="ledger-head">
        <h3>${escapeHTML(lg.account.name)} Account</h3>
        <span class="badge">${GROUPS[lg.account.group].label}</span>
        <span class="muted small">Normal balance: ${nature === "debit" ? "Debit" : "Credit"}${lg.nominal ? " · nominal account (starts each period at zero)" : ""}</span>
    </div>
    <div class="table-wrap"><table class="table ledger">
        <thead><tr><th>Date</th><th>Particulars</th><th class="num">Debit (₹)</th><th class="num">Credit (₹)</th><th class="num">Balance</th></tr></thead>
        <tbody>
            ${lg.opening ? `<tr class="muted-row"><td>${shortDate(period.from)}</td><td>${lg.opening > 0 ? "To" : "By"} Balance b/d</td><td class="num">${lg.opening > 0 ? money(lg.opening).replace("₹", "") : ""}</td><td class="num">${lg.opening < 0 ? money(-lg.opening).replace("₹", "") : ""}</td><td class="num">${balLabel(lg.opening)}</td></tr>` : ""}
            ${lg.rows.map(x => `<tr>
                <td class="nowrap">${shortDate(x.date)}</td>
                <td>${escapeHTML(x.particulars)}${x.narration ? `<div class="cell-sub">${escapeHTML(x.narration)}</div>` : ""}</td>
                <td class="num">${x.debit ? money(x.debit).replace("₹", "") : ""}</td>
                <td class="num">${x.credit ? money(x.credit).replace("₹", "") : ""}</td>
                <td class="num">${balLabel(x.balance)}</td></tr>`).join("")}
            ${!lg.rows.length && !lg.opening ? `<tr><td colspan="5">${emptyState("No entries", "Nothing has been posted to this account in this period.")}</td></tr>` : ""}
        </tbody>
        <tfoot>
            <tr><td colspan="2">${lg.closing >= 0 ? "By" : "To"} Balance c/d</td><td class="num">${lg.closing < 0 ? money(-lg.closing).replace("₹", "") : ""}</td><td class="num">${lg.closing > 0 ? money(lg.closing).replace("₹", "") : ""}</td><td></td></tr>
            <tr class="total"><td colspan="2">Total</td><td class="num">${money(totalDr + (lg.closing < 0 ? -lg.closing : 0)).replace("₹", "")}</td><td class="num">${money(totalCr + (lg.closing > 0 ? lg.closing : 0)).replace("₹", "")}</td><td class="num"><strong>${balLabel(lg.closing)}</strong></td></tr>
        </tfoot>
    </table></div>`;
}

function bindLedger({ accounts, entries, period }) {
    const sel = document.getElementById("ledgerAccount");
    sel?.addEventListener("change", () => {
        sessionStorage.setItem("arbor.ledgerAccount", sel.value);
        document.getElementById("ledgerBody").innerHTML = ledgerBody(sel.value, { accounts, entries }, period);
    });
}

// ==========================================================
// TRIAL BALANCE
// ==========================================================
function trialView({ b }) {
    const tb = b.trialBalance;
    let lastGroup = null;
    return `
<section class="card">
    <div class="tb-status ${tb.balanced ? "ok" : "bad"}">${tb.balanced ? "✓ The trial balance agrees: total debits equal total credits." : "✗ The trial balance does not agree. Please report this."}</div>
    ${tb.rows.length ? `<div class="table-wrap"><table class="table tb">
        <thead><tr><th>Account</th><th class="num">Debit (₹)</th><th class="num">Credit (₹)</th></tr></thead>
        <tbody>${tb.rows.map(row => {
            const head = row.group !== lastGroup ? `<tr class="group-row"><td colspan="3">${GROUPS[row.group]?.label || ""}</td></tr>` : "";
            lastGroup = row.group;
            const link = row.id.startsWith("_") ? escapeHTML(row.name) : `<button class="link plain" data-go-view="ledger" data-ledger-account="${row.id}">${escapeHTML(row.name)}</button>`;
            return `${head}<tr><td>${link}</td><td class="num">${row.debit ? money(row.debit).replace("₹", "") : ""}</td><td class="num">${row.credit ? money(row.credit).replace("₹", "") : ""}</td></tr>`;
        }).join("")}</tbody>
        <tfoot><tr class="total"><td>Total</td><td class="num">${money(tb.debit)}</td><td class="num">${money(tb.credit)}</td></tr></tfoot>
    </table></div>
    <p class="small muted note-below">Income and expense accounts show this period's totals. Profit from earlier periods appears as “Profit & Loss A/c (balance b/f)”. Closing stock is not part of the trial balance; it enters the Trading Account and Balance Sheet.</p>`
    : emptyState("Nothing to show", "Post journal entries to build the trial balance.")}
</section>`;
}

// ==========================================================
// FINAL ACCOUNTS
// ==========================================================
function tAccount(title, subtitle, drHead, crHead, dr, cr, total) {
    const row = r => {
        if (r.less) return `<div class="t-line"><span>${escapeHTML(r.label)}<em class="t-inner">${money(r.amount)}<br>${escapeHTML(r.less.label)} (${money(r.less.amount)})</em></span><strong>${money(r.net)}</strong></div>`;
        return `<div class="t-line ${r.result ? "result" : ""}"><span>${escapeHTML(r.label)}</span><strong>${money(r.amount)}</strong></div>`;
    };
    return `
    <div class="statement">
        <div class="st-head"><h3>${title}</h3><p>${subtitle}</p></div>
        <div class="t-grid">
            <div class="t-side"><div class="t-cap"><span>${drHead}</span><span>₹</span></div>${dr.map(row).join("")}</div>
            <div class="t-side"><div class="t-cap"><span>${crHead}</span><span>₹</span></div>${cr.map(row).join("")}</div>
        </div>
        <div class="t-grid t-total"><div><span>Total</span><strong>${money(total)}</strong></div><div><span>Total</span><strong>${money(total)}</strong></div></div>
    </div>`;
}

function statementsView({ b, profile, period }) {
    const bs = b.balanceSheet;
    const sub = `of ${escapeHTML(profile.name)} for the period ${shortDate(period.from)} to ${shortDate(period.to)}`;
    const line = (label, amount, cls = "") => ({ label, amount, cls });
    const liab = [
        { head: "Capital", rows: [
            ...bs.capital.accounts.map(a => line(`Opening capital / introduced (${a.name})`, a.amount)),
            ...(bs.capital.retainedBF ? [line(bs.capital.retainedBF >= 0 ? "Add: Profit brought forward" : "Less: Loss brought forward", bs.capital.retainedBF)] : []),
            line(bs.capital.netProfit >= 0 ? "Add: Net profit for the period" : "Less: Net loss for the period", bs.capital.netProfit),
            ...(bs.capital.drawings ? [line("Less: Drawings", -bs.capital.drawings)] : [])
        ], total: bs.capital.closing },
        { head: "Long-term liabilities", rows: bs.longTerm.map(x => line(x.name, x.amount)), total: bs.longTerm.reduce((s, x) => s + x.amount, 0) },
        { head: "Current liabilities", rows: bs.currentLiab.map(x => line(x.name, x.amount)), total: bs.currentLiab.reduce((s, x) => s + x.amount, 0) }
    ];
    const assets = [
        { head: "Fixed assets", rows: bs.fixedAssets.map(x => line(x.name, x.amount)), total: bs.fixedAssets.reduce((s, x) => s + x.amount, 0) },
        { head: "Current assets", rows: [...(bs.closingStock ? [line("Closing stock", bs.closingStock)] : []), ...bs.currentAssets.map(x => line(x.name, x.amount))], total: bs.closingStock + bs.currentAssets.reduce((s, x) => s + x.amount, 0) }
    ];
    const side = groups => groups.filter(g => g.rows.length || g.total).map(g => `
        <div class="bs-group"><div class="bs-head"><span>${g.head}</span></div>
        ${g.rows.map(x => `<div class="t-line sub"><span>${escapeHTML(x.label)}</span><em>${money(x.amount)}</em></div>`).join("")}
        <div class="t-line bs-sum"><span></span><strong>${money(g.total)}</strong></div></div>`).join("");

    const cf = b.cashFlow;
    const cfSection = (title, key) => {
        const lines = Object.entries(cf.lines[key]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
        return `<div class="bs-group"><div class="bs-head"><span>${title}</span></div>
            ${lines.length ? lines.map(([label, v]) => `<div class="t-line sub"><span>${v >= 0 ? "Received: " : "Paid: "}${escapeHTML(label)}</span><em class="${v < 0 ? "neg" : ""}">${money(v)}</em></div>`).join("") : `<div class="t-line sub"><span class="muted">None</span><em></em></div>`}
            <div class="t-line bs-sum"><span>Net cash from ${title.toLowerCase()}</span><strong class="${cf[key] < 0 ? "neg" : ""}">${money(cf[key])}</strong></div></div>`;
    };

    const tab = sessionStorage.getItem("arbor.statement") || "trading";
    const tabs = [["trading", "Trading A/c"], ["pl", "Profit & Loss A/c"], ["bs", "Balance Sheet"], ["cf", "Cash Flow"]];
    return `
<section class="card statements-card">
    <div class="toolbar no-print">
        <div class="chips">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? "active" : ""}" data-st-tab="${k}">${l}</button>`).join("")}<button class="chip" data-st-tab="all">All four</button></div>
        <button class="btn btn-ghost btn-sm" id="printStatements">Print / save as PDF</button>
    </div>
    ${!b.figures.hasClosingCount && (b.figures.netPurchases || b.figures.closingStock) ? `<div class="verdict warn no-print"><strong>No closing stock valuation for this period.</strong> Closing stock is taken as the last known value (${money(b.figures.closingStock)}). Count your stock and add it under Chart of accounts → Stock valuation for accurate gross profit.</div>` : ""}

    <div class="st-pane" data-st="trading" ${tab === "trading" ? "" : "hidden"}>
        ${tAccount("Trading Account", sub, "Dr. Particulars", "Cr. Particulars", b.trading.dr, b.trading.cr, b.trading.total)}
    </div>
    <div class="st-pane" data-st="pl" ${tab === "pl" ? "" : "hidden"}>
        ${tAccount("Profit &amp; Loss Account", sub, "Dr. Particulars", "Cr. Particulars", b.pl.dr, b.pl.cr, b.pl.total)}
    </div>
    <div class="st-pane" data-st="bs" ${tab === "bs" ? "" : "hidden"}>
        <div class="statement">
            <div class="st-head"><h3>Balance Sheet</h3><p>of ${escapeHTML(profile.name)} as at ${shortDate(period.to)}</p></div>
            <div class="t-grid">
                <div class="t-side"><div class="t-cap"><span>Liabilities</span><span>₹</span></div>${side(liab)}</div>
                <div class="t-side"><div class="t-cap"><span>Assets</span><span>₹</span></div>${side(assets)}</div>
            </div>
            <div class="t-grid t-total"><div><span>Total</span><strong>${money(bs.liabTotal)}</strong></div><div><span>Total</span><strong>${money(bs.assetTotal)}</strong></div></div>
            <div class="tb-status ${bs.balanced ? "ok" : "bad"} slim">${bs.balanced ? "✓ Balanced: total liabilities and capital equal total assets." : "✗ Not balanced. Please report this."}</div>
        </div>
    </div>
    <div class="st-pane" data-st="cf" ${tab === "cf" ? "" : "hidden"}>
        <div class="statement">
            <div class="st-head"><h3>Cash Flow Statement</h3><p>(direct method) ${sub}</p></div>
            <div class="cf-body">
                ${cfSection("Operating activities", "operating")}
                ${cfSection("Investing activities", "investing")}
                ${cfSection("Financing activities", "financing")}
                <div class="bs-group"><div class="t-line"><span>Net increase / (decrease) in cash</span><strong>${money(cf.netChange)}</strong></div>
                <div class="t-line"><span>Add: Cash and bank at the start of the period</span><strong>${money(cf.opening)}</strong></div>
                <div class="t-line result"><span>Cash and bank at the end of the period</span><strong>${money(cf.closing)}</strong></div></div>
            </div>
        </div>
    </div>
</section>

<section class="card no-print">
    <div class="card-head"><h2>Key ratios</h2></div>
    <div class="kpi-grid compact">
        ${kpi("Gross margin", pct(b.ratios.grossMargin), "Gross profit ÷ net sales")}
        ${kpi("Net margin", pct(b.ratios.netMargin), "Net profit ÷ net sales")}
        ${kpi("Current ratio", b.ratios.currentRatio === null ? "—" : b.ratios.currentRatio.toFixed(2), "Current assets ÷ current liabilities")}
        ${kpi("Quick ratio", b.ratios.quickRatio === null ? "—" : b.ratios.quickRatio.toFixed(2), "(Current assets − stock) ÷ current liabilities")}
        ${kpi("Return on equity", pct(b.ratios.returnOnEquity), "Net profit ÷ closing capital")}
        ${kpi("Debtor days", b.ratios.debtorDays === null ? "—" : Math.round(b.ratios.debtorDays), "How long customers take to pay")}
        ${kpi("Creditor days", b.ratios.creditorDays === null ? "—" : Math.round(b.ratios.creditorDays), "How long you take to pay suppliers")}
    </div>
</section>`;
}

function bindStatements() {
    document.querySelectorAll("[data-st-tab]").forEach(btn => {
        btn.onclick = () => {
            const k = btn.dataset.stTab;
            if (k !== "all") sessionStorage.setItem("arbor.statement", k);
            document.querySelectorAll("[data-st-tab]").forEach(x => x.classList.toggle("active", x === btn));
            document.querySelectorAll(".st-pane").forEach(p => { p.hidden = k !== "all" && p.dataset.st !== k; });
        };
    });
    document.getElementById("printStatements").onclick = () => {
        document.querySelectorAll(".st-pane").forEach(p => { p.dataset.wasHidden = p.hidden ? "1" : ""; p.hidden = false; });
        window.print();
        document.querySelectorAll(".st-pane").forEach(p => { p.hidden = p.dataset.wasHidden === "1"; });
    };
}

// ==========================================================
// CHART OF ACCOUNTS + STOCK
// ==========================================================
function accountsView({ accounts, entries, b, stockCounts, period }) {
    const balanceOf = id => {
        const tbRow = b.trialBalance.rows.find(r => r.id === id);
        return tbRow ? tbRow.debit - tbRow.credit : 0;
    };
    const used = new Set(entries.flatMap(e => (e.lines || []).map(l => l.accountId)));
    const kinds = { cash: "Cash", bank: "Bank", receivable: "Receivable", payable: "Payable", inventory: "Stock", non_cash: "Non-cash" };
    const counts = [...stockCounts].sort((x, y) => y.date.localeCompare(x.date));
    return `
<div class="grid-2-1">
    <section class="card">
        <div class="card-head"><h2>Accounts</h2><span class="muted small">Balances for ${escapeHTML(period.label)}</span></div>
        <div class="table-wrap"><table class="table">
            <thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Balance</th><th></th></tr></thead>
            <tbody>${GROUP_ORDER.map(g => {
                const list = accounts.filter(a => a.group === g);
                if (!list.length) return "";
                return `<tr class="group-row"><td colspan="5">${GROUPS[g].label} <span class="muted">· normal ${GROUPS[g].nature} balance</span></td></tr>` + list.map(a => {
                    const bal = balanceOf(a.id);
                    return `<tr>
                        <td class="muted">${escapeHTML(a.code || "")}</td>
                        <td><button class="link plain" data-go-view="ledger" data-ledger-account="${a.id}">${escapeHTML(a.name)}</button></td>
                        <td>${a.kind ? `<span class="badge">${kinds[a.kind] || a.kind}</span>` : ""}</td>
                        <td class="num">${bal ? `${money(Math.abs(bal)).replace("₹", "")} ${bal > 0 ? "Dr" : "Cr"}` : "—"}</td>
                        <td class="actions">${used.has(a.id) ? "" : `<button class="row-delete" data-delete-account="${a.id}" title="Delete account" aria-label="Delete account">×</button>`}</td>
                    </tr>`;
                }).join("");
            }).join("")}</tbody>
        </table></div>
    </section>
    <div class="stack">
        <section class="card">
            <div class="card-head"><h2>Add an account</h2></div>
            <form id="newAccountForm" class="form-grid one">
                <label class="field">Account name<input id="naName" required placeholder="e.g. HDFC Current A/c, Ramesh Traders" /></label>
                <label class="field">Type<select id="naGroup">${GROUP_ORDER.filter(g => g !== "opening_stock").map(g => `<option value="${g}">${GROUPS[g].label}</option>`).join("")}</select></label>
                <label class="field">Role (optional)<select id="naKind">
                    <option value="">None</option><option value="bank">Bank account</option><option value="cash">Cash</option>
                    <option value="receivable">Customer (debtor)</option><option value="payable">Supplier (creditor)</option><option value="non_cash">Non-cash expense</option>
                </select><small class="field-note">Roles decide where an account appears in quick entries and ratios. Mark each customer as a debtor and each supplier as a creditor.</small></label>
                <div id="naMsg" class="auth-message"></div>
                <button class="btn btn-primary btn-block" type="submit">Add account</button>
            </form>
        </section>
        <section class="card">
            <div class="card-head"><h2>Stock valuation</h2></div>
            <p class="small muted">At the end of each period, count your unsold stock and value it at cost (or market value, if lower). This closing stock goes into the Trading Account and the Balance Sheet, and becomes next period's opening stock.</p>
            <form id="stockForm" class="field-row">
                <label class="field">Date<input id="scDate" type="date" value="${period.to}" required /></label>
                <label class="field">Value (₹)<input id="scValue" type="number" step="0.01" min="0" required /></label>
            </form>
            <button class="btn btn-primary btn-block" id="addStockCount">Save stock valuation</button>
            ${counts.length ? `<div class="mini-list">${counts.map(c => `<div class="mini-row two"><div><div class="cell-title">${money(toPaise(c.value))}</div><div class="cell-sub">${shortDate(c.date)}</div></div><button class="row-delete" data-delete-count="${c.id}" aria-label="Delete">×</button></div>`).join("")}</div>` : ""}
        </section>
    </div>
</div>`;
}

function bindAccounts({ profile, accounts }, rerender) {
    const form = document.getElementById("newAccountForm");
    form.onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById("naName").value.trim();
        const group = document.getElementById("naGroup").value;
        const kind = document.getElementById("naKind").value || null;
        const msg = document.getElementById("naMsg");
        if (!name) return;
        if (accounts.some(a => a.name.trim().toLowerCase() === name.toLowerCase())) {
            msg.textContent = "An account with this name already exists."; msg.className = "auth-message error"; return;
        }
        const prefix = { fixed_asset: "15", current_asset: "11", current_liability: "20", long_term_liability: "25", capital: "30", drawings: "30", sales: "40", sales_return: "40", indirect_income: "45", purchases: "50", purchase_return: "50", direct_expense: "51", indirect_expense: "60" }[group] || "90";
        const used = accounts.map(a => a.code).filter(c => c && c.startsWith(prefix)).map(Number);
        const code = String((used.length ? Math.max(...used) : Number(prefix + "00")) + 1);
        form.querySelector("button").disabled = true;
        await createLedgerAccount(profile.id, { name, group, kind, code });
        await rerender();
    };
    document.getElementById("addStockCount").onclick = async (e) => {
        const date = document.getElementById("scDate").value;
        const value = Number(document.getElementById("scValue").value);
        if (!date || !(value >= 0) || document.getElementById("scValue").value === "") return alert("Enter the date and value of the stock count.");
        e.currentTarget.disabled = true;
        await addStockCount(profile.id, date, value);
        await rerender();
    };
}

// ==========================================================
// ENTRY DRAWER (quick entry + journal entry)
// ==========================================================
function entryDrawer({ accounts }) {
    const opts = (list, empty = "Choose account") => `<option value="">${empty}</option>` + GROUP_ORDER.map(g => {
        const l = list.filter(a => a.group === g);
        return l.length ? `<optgroup label="${GROUPS[g].label}">${l.map(a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
    return `
<aside class="side drawer wide" aria-label="Record transaction">
    <div class="panel-head">
        <div><h2>Record transaction</h2><p>Every entry is posted as a balanced double entry.</p></div>
        <button id="closePanel" class="icon-btn" title="Close" aria-label="Close">×</button>
    </div>
    <div class="panel-tabs">
        <button class="panel-tab active" data-panel="quick">Quick entry</button>
        <button class="panel-tab" data-panel="journal">Journal entry</button>
    </div>

    <div class="panel-section active" data-panel-section="quick">
        <label class="field">What happened?<select id="qTemplate">${TEMPLATES.map(t => `<option value="${t.key}">${t.label}</option>`).join("")}</select></label>
        <p class="field-help" id="qHint"></p>
        <label class="field"><span id="qDrLabel">Debit</span><select id="qDr"></select></label>
        <label class="field"><span id="qCrLabel">Credit</span><select id="qCr"></select></label>
        <div class="field-row">
            <label class="field">Amount (₹)<input id="qAmount" type="number" step="0.01" min="0" inputmode="decimal" /></label>
            <label class="field">Date<input id="qDate" type="date" value="${localISODate()}" /></label>
        </div>
        <div class="field-row">
            <label class="field">Narration<input id="qNarr" /></label>
            <label class="field">Reference (optional)<input id="qRef" placeholder="Invoice / bill no." /></label>
        </div>
        <div class="je-preview" id="qPreview"></div>
        <div id="qMsg" class="auth-message"></div>
        <button class="btn btn-primary btn-block" id="qPost">Post entry</button>
    </div>

    <div class="panel-section" data-panel-section="journal">
        <div class="field-row">
            <label class="field">Date<input id="jDate" type="date" value="${localISODate()}" /></label>
            <label class="field">Reference (optional)<input id="jRef" /></label>
        </div>
        <div class="je-lines" id="jLines"></div>
        <button class="btn btn-ghost btn-sm" id="jAddLine" type="button">+ Add line</button>
        <div class="je-totals" id="jTotals"></div>
        <label class="field">Narration<input id="jNarr" placeholder="Being …" /></label>
        <div id="jMsg" class="auth-message"></div>
        <button class="btn btn-primary btn-block" id="jPost">Post journal entry</button>
        <template id="jLineTpl">
            <div class="je-line">
                <select class="jl-acc">${opts(accounts)}</select>
                <input class="jl-dr" type="number" step="0.01" min="0" placeholder="Debit" inputmode="decimal" />
                <input class="jl-cr" type="number" step="0.01" min="0" placeholder="Credit" inputmode="decimal" />
                <button class="row-delete jl-del" type="button" aria-label="Remove line">×</button>
            </div>
        </template>
    </div>
</aside>`;
}

function openDrawer(panel = "quick", template) {
    document.querySelector(".drawer")?.classList.add("open");
    document.getElementById("overlay")?.classList.add("show");
    selectPanel(panel === "activity" ? "quick" : panel);
    if (template) {
        const sel = document.getElementById("qTemplate");
        sel.value = template;
        sel.dispatchEvent(new Event("change"));
    }
}
function closeDrawer() {
    document.querySelector(".drawer")?.classList.remove("open");
    document.getElementById("overlay")?.classList.remove("show");
}
function selectPanel(name) {
    document.querySelectorAll(".panel-tab").forEach(t => t.classList.toggle("active", t.dataset.panel === name));
    document.querySelectorAll(".panel-section").forEach(s => s.classList.toggle("active", s.dataset.panelSection === name));
}

function bindDrawer({ profile, accounts, byId }, rerender) {
    document.querySelectorAll(".panel-tab").forEach(t => { t.onclick = () => selectPanel(t.dataset.panel); });
    const $ = id => document.getElementById(id);
    const option = a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`;
    const fill = (sel, filter, preferKinds = []) => {
        const list = accounts.filter(filter);
        sel.innerHTML = list.length ? list.map(option).join("") : `<option value="">No matching account. Add one in Chart of accounts.</option>`;
        const pref = preferKinds.map(k => list.find(a => a.kind === k)).find(Boolean);
        if (pref) sel.value = pref.id;
    };

    // ---- quick entry ----
    const realAccounts = a => ["fixed_asset", "current_asset", "opening_stock", "current_liability", "long_term_liability"].includes(a.group);
    const capitalAcc = () => accounts.find(a => a.group === "capital");
    const setupTemplate = () => {
        const t = TEMPLATES.find(x => x.key === $("qTemplate").value);
        $("qHint").textContent = t.hint;
        $("qNarr").value = t.narr;
        if (t.opening) {
            $("qDrLabel").textContent = "Account";
            fill($("qDr"), realAccounts, ["bank"]);
            $("qCr").closest("label").hidden = true;
        } else {
            $("qCr").closest("label").hidden = false;
            $("qDrLabel").textContent = `${t.dr[0]} (debit)`;
            $("qCrLabel").textContent = `${t.cr[0]} (credit)`;
            fill($("qDr"), t.dr[1], t.key === "contra" ? ["bank"] : ["bank", "receivable", "payable"]);
            fill($("qCr"), t.cr[1], t.key === "contra" ? ["cash"] : ["bank", "receivable", "payable"]);
        }
        preview();
    };
    const buildQuick = () => {
        const t = TEMPLATES.find(x => x.key === $("qTemplate").value);
        const amount = Number($("qAmount").value);
        let dr = $("qDr").value, cr = $("qCr").value;
        if (t.opening) {
            const acc = byId[dr], cap = capitalAcc();
            if (!cap) return { error: "Add a Capital account first." };
            // assets carry a debit balance, liabilities a credit balance; Capital takes the other side
            if (acc && GROUPS[acc.group].nature === "credit") { cr = dr; dr = cap.id; } else cr = cap.id;
        }
        return {
            entry: {
                date: $("qDate").value, narration: $("qNarr").value.trim(), reference: $("qRef").value.trim(), template: t.key,
                lines: [{ accountId: dr, debit: amount, credit: 0 }, { accountId: cr, debit: 0, credit: amount }]
            }
        };
    };
    const preview = () => {
        const { entry } = buildQuick();
        if (!entry) { $("qPreview").innerHTML = ""; return; }
        const [d, c] = entry.lines;
        const amt = Number($("qAmount").value) > 0 ? moneyR(Number($("qAmount").value)) : "₹—";
        $("qPreview").innerHTML = d.accountId && c.accountId ? `
            <div class="card-label">Journal entry</div>
            <div class="je-row"><span>${escapeHTML(byId[d.accountId]?.name || "")} A/c <em>Dr.</em></span><strong>${amt}</strong></div>
            <div class="je-row cr"><span>To ${escapeHTML(byId[c.accountId]?.name || "")} A/c</span><strong>${amt}</strong></div>` : "";
    };
    $("qTemplate").onchange = setupTemplate;
    ["qDr", "qCr", "qAmount"].forEach(id => $(id).addEventListener("input", () => { $("qMsg").textContent = ""; $("qMsg").className = "auth-message"; preview(); }));
    ["qDr", "qCr"].forEach(id => $(id).addEventListener("change", preview));
    setupTemplate();

    const post = async (button, msgEl, entry) => {
        const errors = validateEntry(entry, byId);
        if (entry.lines.some(l => l.accountId) && new Set(entry.lines.map(l => l.accountId)).size === 1) errors.unshift("Debit and credit must be different accounts.");
        if (errors.length) { msgEl.textContent = errors[0]; msgEl.className = "auth-message error"; return; }
        button.disabled = true;
        msgEl.textContent = "Posting…"; msgEl.className = "auth-message info";
        try {
            await postJournal(profile.id, entry, byId);
            await rerender();
        } catch (err) {
            msgEl.textContent = err.message || "Could not post. Check your connection."; msgEl.className = "auth-message error";
            button.disabled = false;
        }
    };
    $("qPost").onclick = () => {
        const built = buildQuick();
        if (built.error) { $("qMsg").textContent = built.error; $("qMsg").className = "auth-message error"; return; }
        post($("qPost"), $("qMsg"), built.entry);
    };

    // ---- manual journal ----
    const linesEl = $("jLines");
    const addLine = () => {
        linesEl.appendChild($("jLineTpl").content.cloneNode(true));
        totals();
    };
    const readLines = () => [...linesEl.querySelectorAll(".je-line")].map(row => ({
        accountId: row.querySelector(".jl-acc").value,
        debit: Number(row.querySelector(".jl-dr").value) || 0,
        credit: Number(row.querySelector(".jl-cr").value) || 0
    }));
    const totals = () => {
        const lines = readLines();
        const dr = lines.reduce((s, l) => s + toPaise(l.debit), 0), cr = lines.reduce((s, l) => s + toPaise(l.credit), 0);
        $("jTotals").innerHTML = `<span>Debits <strong>${money(dr)}</strong></span><span>Credits <strong>${money(cr)}</strong></span>
            <span class="${dr === cr && dr > 0 ? "pos" : "neg"}">${dr === cr ? (dr > 0 ? "✓ Balanced" : "Enter amounts") : `Difference ${money(Math.abs(dr - cr))}`}</span>`;
    };
    linesEl.addEventListener("input", e => {
        $("jMsg").textContent = ""; $("jMsg").className = "auth-message";
        // typing a debit clears the credit on the same line, and vice versa
        const row = e.target.closest(".je-line");
        if (e.target.classList.contains("jl-dr") && e.target.value) row.querySelector(".jl-cr").value = "";
        if (e.target.classList.contains("jl-cr") && e.target.value) row.querySelector(".jl-dr").value = "";
        totals();
    });
    linesEl.addEventListener("click", e => {
        if (e.target.closest(".jl-del") && linesEl.querySelectorAll(".je-line").length > 2) { e.target.closest(".je-line").remove(); totals(); }
    });
    $("jAddLine").onclick = addLine;
    addLine(); addLine();
    $("jPost").onclick = () => post($("jPost"), $("jMsg"), {
        date: $("jDate").value, reference: $("jRef").value.trim(), narration: $("jNarr").value.trim(), template: "manual",
        lines: readLines()
    });
}

// ==========================================================
// STRESS TEST + FORECAST
// ==========================================================
function monthsElapsed(period, entries) {
    const inPeriod = entries.map(e => e.date).filter(d => d >= period.from && d <= period.to).sort();
    if (!inPeriod.length) return 0;
    const start = new Date(`${inPeriod[0]}T00:00:00Z`), end = new Date(`${period.to}T00:00:00Z`);
    return Math.max(1, (end - start) / (86400000 * 30.4375));
}

// Monthly averages for the period. Variable costs = cost of goods sold
// (moves with sales); fixed cash costs = indirect expenses excluding
// non-cash items such as depreciation.
function businessBase({ f, period, entries }) {
    const months = monthsElapsed(period, entries);
    if (!months || f.netSales <= 0) return null;
    const m = v => P(v) / months;
    return {
        months,
        revenue: m(f.netSales + f.indirectIncTotal),
        variableCosts: m(Math.max(0, f.cogs)),
        fixedCosts: m(Math.max(0, f.indirectExpTotal - f.nonCashExpenses)),
        cash: P(f.cash)
    };
}

const bizNoData = () => emptyState("Not enough trading history", "Stress tests and forecasts use this period's sales and costs. Record some sales and expenses first.", `<button class="btn btn-primary btn-sm" data-open-panel="quick" data-template="cash_sale">Record a sale</button>`);

function stressView(ctx) {
    const base = businessBase(ctx);
    if (!base) return `<section class="card">${bizNoData()}</section>`;
    return `
<section class="card">
    <div class="card-head"><h2>Your starting point</h2><span class="muted small">Monthly averages over ${base.months.toFixed(1)} months of ${escapeHTML(ctx.period.label)}</span></div>
    <div class="summary-strip inner">
        <div><span>Revenue</span><strong>${formatMoney(base.revenue)}</strong></div>
        <div><span>Variable costs (COGS)</span><strong>${formatMoney(base.variableCosts)}</strong></div>
        <div><span>Fixed cash costs</span><strong>${formatMoney(base.fixedCosts)}</strong></div>
        <div><span>Cash & bank</span><strong>${formatMoney(base.cash)}</strong></div>
    </div>
</section>
<section class="card">
    <div class="card-head"><h2>Choose a scenario</h2></div>
    <div class="scenario-grid">${BUSINESS_SCENARIOS.map((s, i) => `<button class="scenario ${i === 0 ? "active" : ""}" data-scenario="${s.key}"><strong>${s.label}</strong><span>${s.text}</span></button>`).join("")}</div>
    <div class="form-grid" id="bStressForm">
        ${numField("bsRev", "Revenue falls by", 30, { suffix: "%", step: "5" })}
        ${numField("bsCost", "Costs rise by", 0, { suffix: "%", step: "5" })}
        ${numField("bsMonths", "For how long", 6, { suffix: "months", step: "1" })}
        ${numField("bsDelay", "Customers pay later by", 0, { suffix: "days", step: "5" })}
    </div>
</section>
<div id="bStressResult"></div>
<section class="card">
    <div class="card-head"><h2>All scenarios at a glance</h2></div>
    <div class="table-wrap"><table class="table">
        <thead><tr><th>Scenario</th><th class="num">Monthly profit</th><th class="num">Break-even revenue</th><th class="num">Cash lasts</th><th>Verdict</th></tr></thead>
        <tbody>${BUSINESS_SCENARIOS.map(s => {
            const r = businessStressTest(base, s.shock);
            return `<tr><td><div class="cell-title">${s.label}</div><div class="cell-sub">${s.text}</div></td>
                <td class="num ${r.profit < 0 ? "neg" : "pos"}">${formatMoney(r.profit)}</td>
                <td class="num">${Number.isFinite(r.breakEvenRevenue) ? formatMoney(r.breakEvenRevenue) : "Never"}</td>
                <td class="num">${r.runwayMonths === Infinity ? "Indefinitely" : `${r.runwayMonths.toFixed(1)} mo`}</td>
                <td>${r.runOutMonth === null ? `<span class="badge badge-income">Survives</span>` : `<span class="badge badge-expense">Cash out in month ${r.runOutMonth}</span>`}</td></tr>`;
        }).join("")}</tbody>
    </table></div>
</section>`;
}

function bindStress(ctx) {
    const base = businessBase(ctx);
    const form = document.getElementById("bStressForm");
    if (!base || !form) return;
    const v = id => Number(document.getElementById(id).value) || 0;
    const render = () => {
        const r = businessStressTest(base, {
            revenueDrop: Math.min(100, Math.max(0, v("bsRev"))) / 100,
            costRise: Math.max(0, v("bsCost")) / 100,
            months: Math.max(1, Math.round(v("bsMonths"))),
            collectionDelayDays: Math.max(0, v("bsDelay"))
        });
        const verdict = r.runOutMonth === null
            ? `<div class="verdict ok"><strong>The business stays solvent.</strong> Cash ends at ${formatMoney(r.endCash)} after ${r.months} months.</div>`
            : `<div class="verdict bad"><strong>Cash runs out ${r.runOutMonth === 0 ? "immediately" : `in month ${r.runOutMonth}`}.</strong> You'd need ${formatMoney(r.shortfall)} of extra funding (a loan, owner capital, or faster collections) to get through.</div>`;
        document.getElementById("bStressResult").innerHTML = `
<section class="card">
    <div class="card-head"><h2>Result</h2></div>
    ${verdict}
    <div class="kpi-grid compact">
        ${kpi("Monthly profit today", formatMoney(r.baseProfit), "Before the shock", r.baseProfit < 0 ? "neg" : "")}
        ${kpi("During the shock", formatMoney(r.profit), "Revenue − variable − fixed costs", r.profit < 0 ? "neg" : "pos")}
        ${kpi("Break-even revenue", Number.isFinite(r.breakEvenRevenue) ? formatMoney(r.breakEvenRevenue) : "Never", `Today ${Number.isFinite(r.baseBreakEven) ? formatMoney(r.baseBreakEven) : "—"} / month`)}
        ${kpi("Margin of safety", r.marginOfSafety === null ? "—" : pct(r.marginOfSafety), "How far sales can fall before a loss", r.marginOfSafety !== null && r.marginOfSafety < 0 ? "neg" : "")}
        ${kpi("Cash tied up by late payers", formatMoney(r.delayCash), "Extra receivables")}
        ${kpi("Cash lasts", r.runwayMonths === Infinity ? "Indefinitely" : `${r.runwayMonths.toFixed(1)} mo`, "If the shock never ended")}
    </div>
    <div class="card-label">Cash and bank, month by month</div>
    ${pathChart(r.path)}
</section>`;
    };
    document.querySelectorAll(".scenario[data-scenario]").forEach(btn => {
        btn.onclick = () => {
            const s = BUSINESS_SCENARIOS.find(x => x.key === btn.dataset.scenario).shock;
            document.querySelectorAll(".scenario").forEach(x => x.classList.toggle("active", x === btn));
            document.getElementById("bsRev").value = Math.round(s.revenueDrop * 100);
            document.getElementById("bsCost").value = Math.round(s.costRise * 100);
            document.getElementById("bsMonths").value = s.months;
            document.getElementById("bsDelay").value = s.collectionDelayDays;
            render();
        };
    });
    form.addEventListener("input", () => { document.querySelectorAll(".scenario").forEach(x => x.classList.remove("active")); render(); });
    render();
}

function forecastView(ctx) {
    const base = businessBase(ctx);
    if (!base) return `<section class="card">${bizNoData()}</section>`;
    const series = monthlyBusinessSeries(ctx, { to: ctx.period.to, months: 12 }).map(s => s.revenue).filter(v => v > 0);
    const vol = logVolatility(series);
    const variableRatio = base.revenue > 0 ? base.variableCosts / base.revenue : 0;
    return `
<div class="grid-1-2 forecast-layout">
    <section class="card">
        <div class="card-head"><h2>Assumptions</h2><button class="link" id="bfReset">Reset</button></div>
        <p class="small muted">Pre-filled from ${escapeHTML(ctx.period.label)}. Change anything to see how it moves the outcome.</p>
        <div class="form-grid one" id="bfForm">
            ${numField("bfMonths", "Months ahead", 24, { step: "1", suffix: "months" })}
            ${numField("bfRevenue", "Monthly revenue", Math.round(base.revenue), { step: "1000", suffix: "₹" })}
            ${numField("bfVar", "Variable costs as % of revenue", (variableRatio * 100).toFixed(1), { suffix: "%", help: "Cost of goods sold ÷ revenue." })}
            ${numField("bfFixed", "Fixed cash costs per month", Math.round(base.fixedCosts), { step: "1000", suffix: "₹", help: "Salaries, rent, utilities… excluding depreciation." })}
            ${numField("bfGrowth", "Revenue growth per year", 10, { suffix: "%" })}
            ${numField("bfVol", "Revenue volatility", ((series.length >= 3 && vol > 0 ? Math.min(0.8, vol) : 0.15) * 100).toFixed(0), { suffix: "% / month", help: series.length >= 3 ? `Measured from your last ${series.length} months of sales.` : "Default: not enough months of sales to measure it yet." })}
            ${numField("bfInflation", "Cost inflation per year", 5, { suffix: "%" })}
            ${numField("bfShock", "Chance of a demand shock in a year", 10, { suffix: "%", help: "For example, losing a major customer." })}
            ${numField("bfDepth", "Revenue lost if it happens", 20, { suffix: "%" })}
        </div>
    </section>
    <div id="bfResult" class="stack"></div>
</div>`;
}

function bindForecast(ctx) {
    const base = businessBase(ctx);
    const form = document.getElementById("bfForm");
    if (!base || !form) return;
    const defaults = Object.fromEntries([...form.querySelectorAll("input")].map(i => [i.id, i.value]));
    const v = id => Number(document.getElementById(id).value) || 0;
    let timer;
    const run = () => {
        const months = Math.min(120, Math.max(1, Math.round(v("bfMonths"))));
        const r = businessMonteCarlo({
            cash: base.cash, revenue: Math.max(0, v("bfRevenue")),
            variableRatio: Math.min(1.5, Math.max(0, v("bfVar") / 100)),
            fixedCosts: Math.max(0, v("bfFixed")),
            revenueGrowth: v("bfGrowth") / 100, revenueVol: Math.max(0, v("bfVol")) / 100,
            costInflation: v("bfInflation") / 100,
            shockProb: Math.min(100, Math.max(0, v("bfShock"))) / 100, shockDepth: Math.min(100, Math.max(0, v("bfDepth"))) / 100,
            months, sims: 2000, seed: 2026
        });
        const start = new Date();
        const label = i => { const d = new Date(start.getFullYear(), start.getMonth() + i, 1); return monthLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`) + (d.getMonth() === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ""); };
        document.getElementById("bfResult").innerHTML = `
<section class="card">
    <div class="card-head"><h2>Cash & bank in ${months} months</h2><span class="muted small">${r.sims.toLocaleString("en-IN")} simulated futures</span></div>
    <div class="kpi-grid compact">
        ${kpi("Most likely (median)", formatShort(r.median), `Today ${formatShort(base.cash)}`, r.median < 0 ? "neg" : "")}
        ${kpi("Bad case (5%)", formatShort(r.p5), "1 in 20 futures end lower", r.p5 < 0 ? "neg" : "")}
        ${kpi("Good case (95%)", formatShort(r.p95), "1 in 20 futures end higher")}
        ${kpi("Cash runs out", pct(r.pCashOut, 0), "Chance cash goes negative at any point", r.pCashOut > 0.1 ? "neg" : "")}
        ${kpi("Loss in first 12 months", pct(r.pLossFirstYear, 0), "Chance the next year is loss-making", r.pLossFirstYear > 0.3 ? "neg" : "")}
    </div>
    ${fanChart(r.bands, { xLabel: label })}
</section>
<section class="card prose-card">
    <div class="card-head"><h2>How this forecast works</h2></div>
    <p>Each simulated month, revenue moves randomly around a growing trend, with the volatility measured from your sales. Variable costs move with revenue, fixed costs rise with inflation, and occasionally a demand shock permanently removes part of revenue. Profit flows into cash. Loan repayments, owner drawings, new capital and asset purchases aren't included, so treat the result as cash generated by trading.</p>
</section>`;
    };
    form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 250); });
    document.getElementById("bfReset").onclick = () => { Object.entries(defaults).forEach(([id, val]) => { document.getElementById(id).value = val; }); run(); };
    run();
}

// ==========================================================
// GUIDE
// ==========================================================
function businessGuide() {
    const steps = items => `<ol class="guide-steps">${items.map(i => `<li>${i}</li>`).join("")}</ol>`;
    const note = t => `<div class="guide-note">${t}</div>`;
    const sec = (id, kicker, title, body) => `<section class="guide-panel guide-wide guide-section" id="${id}"><div class="guide-kicker">${kicker}</div><h2>${title}</h2>${body}</section>`;
    const toc = [["bg-how", "How the books work"], ["bg-setup", "1 · Set up"], ["bg-daily", "2 · Daily entries"], ["bg-journal", "3 · Journal entries"], ["bg-close", "4 · Period end"], ["bg-reports", "5 · Reports"], ["bg-analysis", "6 · Stress & forecast"], ["bg-fix", "Fixing mistakes"], ["bg-rules", "Golden rules"]];
    return `
<div class="guide-hero">
    <div>
        <div class="profile-kicker">Business guide</div>
        <h2>Proper double-entry books, without needing to be an accountant.</h2>
        <p>Every transaction you record is posted as a journal entry where total debits equal total credits. From the journal, Arbor builds every ledger, the trial balance, and the final accounts: Trading Account, Profit &amp; Loss Account, Balance Sheet and Cash Flow Statement.</p>
    </div>
    <div class="guide-checklist"><span>1. Bring in opening balances</span><span>2. Record every transaction</span><span>3. Value stock at period end</span></div>
</div>
<nav class="guide-toc">${toc.map(([id, t]) => `<button data-guide-jump="${id}">${t}</button>`).join("")}</nav>
<div class="guide-grid">
${sec("bg-how", "Concepts", "How the books work", `
    <div class="guide-table">
        <div class="guide-table-row"><span>Journal</span><strong>The book of original entry</strong><p>Every transaction, in date order, showing which accounts were debited and credited.</p></div>
        <div class="guide-table-row"><span>Ledger</span><strong>One page per account</strong><p>All the debits and credits to one account, with its running balance.</p></div>
        <div class="guide-table-row"><span>Trial balance</span><strong>The arithmetic check</strong><p>Every account's balance in one list. Total debits must equal total credits.</p></div>
        <div class="guide-table-row"><span>Final accounts</span><strong>The results</strong><p>Trading A/c (gross profit), Profit &amp; Loss A/c (net profit), Balance Sheet (financial position) and Cash Flow.</p></div>
    </div>
    <h3 class="guide-subhead">Debit and credit, in one table</h3>
    <div class="guide-metric-list">
        <div><strong>Assets and expenses</strong><span>Increase with a <b>debit</b>, decrease with a credit. Examples: cash, bank, debtors, machinery, purchases, rent.</span></div>
        <div><strong>Liabilities, capital and income</strong><span>Increase with a <b>credit</b>, decrease with a debit. Examples: creditors, loans, capital, sales, commission received.</span></div>
        <div><strong>Drawings</strong><span>Money the owner takes out. A <b>debit</b> that reduces capital. It's not an expense of the business.</span></div>
    </div>
`)}
${sec("bg-setup", "Step 1", "Set up your books", `
    ${steps([
        "Create a <strong>Business</strong> workspace. Arbor creates a standard chart of accounts: cash, bank, debtors, creditors, capital, sales, purchases, common expenses and more.",
        "Open <strong>Chart of accounts</strong> and add what's specific to you: each bank account (role: Bank), each major customer (type: Current assets, role: Customer) and each supplier (type: Current liabilities, role: Supplier).",
        "Choose the <strong>Period</strong> at the top (Indian financial year, April–March).",
        "Bring in opening balances: press <strong>+ Record transaction</strong> → <em>Opening balance</em>. Pick the account (bank, stock, machinery, loan, debtor…), enter its balance on the day you start, and post. Arbor puts the other side to Capital automatically, so the books balance from day one."
    ])}
    ${note("Starting a brand-new business? Skip opening balances and use <em>Owner adds capital</em> for the money you put in.")}
    <div class="guide-actions"><button class="guide-try" data-open-panel="quick" data-template="opening">Enter an opening balance →</button><button class="guide-try ghost" data-go-view="accounts">Open Chart of accounts →</button></div>
`)}
${sec("bg-daily", "Step 2", "Record everyday transactions with Quick entry", `
    <p>Press <strong>+ Record transaction</strong>. In <em>Quick entry</em>, choose what happened. Arbor picks which account to debit and which to credit, and shows you the journal entry before you post it.</p>
    <div class="guide-table">
        <div class="guide-table-row"><span>Sales</span><strong>Sale (paid now) · Sale on credit · Customer pays · Sales return</strong><p>Credit sales go to the customer's debtor account; when they pay, use <em>Customer pays</em>.</p></div>
        <div class="guide-table-row"><span>Purchases</span><strong>Purchase (paid now) · Purchase on credit · Pay a supplier · Purchase return</strong><p>Use Purchases only for goods you resell or use in production.</p></div>
        <div class="guide-table-row"><span>Expenses</span><strong>Pay an expense · Expense due, not yet paid</strong><p>Wages and carriage inwards are direct (Trading A/c); rent, salaries and electricity are indirect (P&amp;L A/c).</p></div>
        <div class="guide-table-row"><span>Owner &amp; finance</span><strong>Owner adds capital · Drawings · Loan received · Repay loan principal</strong><p>Record loan interest separately with <em>Pay an expense</em> → Interest on Loan.</p></div>
        <div class="guide-table-row"><span>Assets</span><strong>Buy a fixed asset · Charge depreciation</strong><p>Assets go on the Balance Sheet; depreciation is an expense that moves no cash.</p></div>
        <div class="guide-table-row"><span>Contra</span><strong>Move money (cash ↔ bank)</strong><p>Depositing or withdrawing cash. It's neither income nor expense.</p></div>
    </div>
    <div class="guide-actions"><button class="guide-try" data-open-panel="quick" data-template="cash_sale">Record a sale →</button><button class="guide-try ghost" data-open-panel="quick" data-template="expense">Pay an expense →</button></div>
`)}
${sec("bg-journal", "Step 3", "Compound and unusual entries: Journal entry", `
    ${steps([
        "Press <strong>+ Record transaction</strong> → <strong>Journal entry</strong>.",
        "On each line pick an account and enter <em>either</em> a debit or a credit amount. Use <strong>+ Add line</strong> for more lines.",
        "Watch the totals: you can only post when total debits equal total credits.",
        "Write a narration (“Being …”) and post."
    ])}
    ${note("Example: you pay an EMI of ₹12,000 that includes ₹2,000 of interest. Debit Bank Loan ₹10,000 and Interest on Loan ₹2,000; credit Bank Account ₹12,000.")}
    <div class="guide-actions"><button class="guide-try" data-open-panel="journal">Open journal entry →</button></div>
`)}
${sec("bg-close", "Step 4", "At the end of each period", `
    ${steps([
        "<strong>Count and value your closing stock</strong> (at cost, or market value if lower). Add it in <em>Chart of accounts → Stock valuation</em>, dated the last day of the period.",
        "<strong>Charge depreciation</strong> on fixed assets with Quick entry → <em>Charge depreciation</em>.",
        "<strong>Record outstanding expenses</strong> (e.g. March salary paid in April) with <em>Expense due, not yet paid</em>.",
        "Check <strong>Trial balance</strong> agrees and the Overview's <em>Books health</em> is all green.",
        "Open <strong>Final accounts</strong> and print or save them as PDF."
    ])}
    ${note("You don't post closing entries. Arbor carries profit to Capital automatically, carries real-account balances forward, starts income and expense accounts at zero each period, and makes this period's closing stock next period's opening stock.")}
`)}
${sec("bg-reports", "Step 5", "Reading the reports", `
    <div class="guide-metric-list">
        <div><strong>Trading Account</strong><span>Net sales − cost of goods sold (opening stock + net purchases + direct expenses − closing stock) = <b>gross profit</b>.</span></div>
        <div><strong>Profit &amp; Loss Account</strong><span>Gross profit + other income − indirect expenses = <b>net profit</b>, transferred to Capital.</span></div>
        <div><strong>Balance Sheet</strong><span>Capital and liabilities on one side, assets on the other. They must be equal.</span></div>
        <div><strong>Cash Flow Statement</strong><span>Cash in and out from operating, investing (fixed assets) and financing (capital, loans, drawings) activities.</span></div>
        <div><strong>Current &amp; quick ratio</strong><span>Can you pay short-term bills? Above 1 means current assets cover current liabilities.</span></div>
        <div><strong>Debtor / creditor days</strong><span>How long customers take to pay you, and how long you take to pay suppliers.</span></div>
    </div>
    <div class="guide-actions"><button class="guide-try" data-go-view="statements">Open Final accounts →</button></div>
`)}
${sec("bg-analysis", "Step 6", "Stress test and cash forecast", `
    <p><strong>Stress test</strong> splits your costs into variable (cost of goods sold, which moves with sales) and fixed cash costs (overheads, excluding depreciation). It shows your break-even revenue, margin of safety, and how long cash lasts if sales fall, costs rise, or customers pay late.</p>
    <p><strong>Cash forecast</strong> runs 2,000 simulated futures of your bank balance, with revenue moving around its trend at the volatility measured from your own sales. It gives the chance that cash runs out and the range of outcomes.</p>
    <div class="guide-actions"><button class="guide-try" data-go-view="stress">Open Stress test →</button><button class="guide-try ghost" data-go-view="forecast">Open Cash forecast →</button></div>
`)}
${sec("bg-fix", "Corrections", "Fixing mistakes", `
    ${steps([
        "Open <strong>Journal</strong>, find the entry, and press <strong>×</strong>. Both sides are removed together, so the books stay balanced.",
        "Post the corrected entry.",
        "Accounts with entries can't be deleted, so no history is lost. Unused accounts can be deleted from Chart of accounts."
    ])}
`)}
${sec("bg-rules", "Remember", "Golden rules", `
    <div class="guide-metric-list">
        <div><strong>Personal account</strong><span>Debit the receiver, credit the giver. (Debtors, creditors, capital.)</span></div>
        <div><strong>Real account</strong><span>Debit what comes in, credit what goes out. (Cash, bank, furniture, stock.)</span></div>
        <div><strong>Nominal account</strong><span>Debit all expenses and losses, credit all incomes and gains. (Rent, wages, sales, commission.)</span></div>
    </div>
`)}
</div>`;
}
