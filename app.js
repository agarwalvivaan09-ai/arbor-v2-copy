import { signUp, login, resetPassword, observeAuth, logout } from "./firebase/auth.js";
import { createProfile, getProfiles } from "./profiles/profiles.js";
import { addTransaction, getTransactions } from "./modules/transactions.js";
import { addAsset, addLiability, getAssets, getLiabilities } from "./modules/networth.js";
import { deleteTransaction } from "./modules/transactions.js";
import { deleteAsset } from "./modules/networth.js";
import { deleteLiability } from "./modules/networth.js";
import { createAccount, getAccounts } from "./modules/accounts.js";
import { createEMI, getEMIs } from "./modules/emi.js";
import { computeFinancials, addMonths, toDate } from "./modules/engine.js";
import { deleteAccount } from "./modules/accounts.js";
import { deleteEMI } from "./modules/emi.js";
import { HFRI_LINKS } from "./modules/hfri.js";
let state = {
    assets: [],
    liabilities: [],
    transactions: [],
    accounts: [],
    emis: []
};

// Guards the Add buttons against double clicks creating duplicate records.
let isSubmitting = false;
// ==========================
// MAIN ROUTER
// ==========================

async function renderApp(user) {
    let selectedProfile = localStorage.getItem("selectedProfile");

    try {
        // a profile id left in localStorage by another user (or a deleted
        // profile) must never be opened
        if (selectedProfile) {
            const ownProfiles = await getProfiles(user.uid);
            if (!ownProfiles.some(p => p.id === selectedProfile)) {
                localStorage.removeItem("selectedProfile");
                selectedProfile = null;
            }
        }

        if (selectedProfile) {
            await renderDashboard(user, selectedProfile);
        } else {
            await renderProfiles(user);
        }
    } catch (error) {
        console.error("App render failed:", error);
        localStorage.removeItem("selectedProfile");
        await renderProfiles(user);
    }
}

function getAuthErrorMessage(error) {
    const code = error?.code || "";

    const messages = {
        "auth/email-already-in-use": "That email already has an account. Try logging in.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/missing-password": "Enter your password.",
        "auth/network-request-failed": "Network error. Check your connection and try again.",
        "auth/too-many-requests": "Too many attempts. Wait a bit and try again.",
        "auth/user-not-found": "No account found for that email.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/wrong-password": "Email or password is incorrect."
    };

    return messages[code] || error?.message || "Something went wrong. Please try again.";
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatMoney(value) {
    const rounded = Math.round(Number(value) || 0);
    const sign = rounded < 0 ? "-" : "";
    return `${sign}₹${Math.abs(rounded).toLocaleString("en-IN")}`;
}

// Empty input → fallback; "0" is a valid rate.
function parseRate(inputValue, fallback) {
    const raw = String(inputValue ?? "").trim();
    if (raw === "") return fallback;
    const rate = Number(raw);
    return Number.isFinite(rate) && rate >= 0 ? rate : fallback;
}

function formatDate(value) {
    const date = toDate(value);
    return date ? date.toLocaleDateString() : "not set";
}

const EMPTY_STATE = () => ({
    assets: [],
    liabilities: [],
    transactions: [],
    accounts: [],
    emis: []
});

async function logoutUser() {
    state = EMPTY_STATE();
    localStorage.removeItem("selectedProfile");
    localStorage.removeItem("dashboardView");
    await logout();
}

function readableType(type) {
    const labels = {
        income: "Income",
        expense: "Expense",
        asset_buy: "Buy asset",
        asset_sell: "Sell asset",
        liability_add: "New loan",
        liability_payment: "Loan payment",
        transfer: "Transfer",
        appreciating: "Appreciating",
        depreciating: "Depreciating",
        cash: "Cash",
        bank: "Bank",
        wallet: "Wallet"
    };

    return labels[type] || type || "Other";
}

function renderGuideContent() {
    // [id, title] — the jump menu at the top of the guide
    const toc = [
        ["guide-map", "Find your way around"],
        ["guide-setup", "Step 1 · Profile"],
        ["guide-accounts", "Step 2 · Accounts"],
        ["guide-daily", "Step 3 · Income & spending"],
        ["guide-transfer", "Step 4 · Transfers"],
        ["guide-assets", "Step 5 · Investments"],
        ["guide-loans", "Step 6 · Loans & EMIs"],
        ["guide-tax", "Step 7 · Tax"],
        ["guide-metrics", "Step 8 · Read the dashboard"],
        ["guide-hfri", "HFRI score"],
        ["guide-mistakes", "Fixing mistakes"],
        ["guide-routine", "Monthly routine"],
        ["guide-trouble", "Troubleshooting"]
    ];

    const steps = items => `<ol class="guide-steps">${items.map(i => `<li>${i}</li>`).join("")}</ol>`;
    const tryIt = (label, panelName, txnType = "") =>
        `<button class="guide-try" data-open-panel="${panelName}"${txnType ? ` data-txn-type="${txnType}"` : ""}>${label} →</button>`;
    const goTo = (label, view) => `<button class="guide-try ghost" data-go-view="${view}">${label} →</button>`;
    const note = text => `<div class="guide-note">${text}</div>`;
    const section = (id, kicker, title, body) => `
    <section class="guide-panel guide-wide guide-section" id="${id}">
        <div class="guide-kicker">${kicker}</div>
        <h2>${title}</h2>
        ${body}
    </section>`;

    const metrics = [
        ["Income", "Every Income entry up to today. Loans and asset sales are not income."],
        ["Expense", "Expenses (including tax you record) + loan repayments + EMIs that have fallen due."],
        ["Total Cash", "Sum of all account balances: opening balance plus every entry dated up to today."],
        ["Net Worth", "Total Cash + current value of assets − what you still owe on loans."],
        ["Savings", "(Income − Expense) ÷ Income. The share of income you kept."],
        ["Emergency", "Months of spending your cash covers: Total Cash ÷ 3M Avg Expense."],
        ["Status", "Quick label from the savings rate: Strong (40%+), Stable (15%+), else Vulnerable."],
        ["HFRI", "Household Financial Resilience Index, 0–100. See the HFRI section below."],
        ["Top Spend", "The description with the most money spent (\"Rent\" and \"rent\" count together)."],
        ["3M Avg Expense", "Average spending of the latest three months that had spending."],
        ["Avg Transaction Size", "Average size of an outgoing payment (expenses, repayments, EMIs)."],
        ["Monthly Flow", "Income − spending in the latest month with activity."],
        ["MRR", "Average monthly income from entries with the salary subtype."]
    ];

    const entryTypes = [
        ["Income", "income", "Money you earned arrives in an account: salary, business revenue, interest, dividends, refunds.", "Cash ↑, Income ↑"],
        ["Expense", "expense", "Money you spent leaves an account: rent, food, bills, fuel, fees, tax.", "Cash ↓, Expense ↑"],
        ["Transfer", "transfer", "You move your own money between two of your accounts.", "One account ↓, the other ↑. Nothing else changes."],
        ["Buy Asset", "asset_buy", "You turn cash into something you own: a fund, shares, gold, property, a vehicle.", "Cash ↓, Assets ↑, Net Worth unchanged on the day"],
        ["Sell Asset", "asset_sell", "You sell all or part of an asset Arbor is tracking.", "Cash ↑, that asset's value ↓"],
        ["New Loan", "liability_add", "Borrowed money arrives in an account. Optionally creates an EMI schedule.", "Cash ↑, Liabilities ↑, Net Worth unchanged on the day"],
        ["Repay Loan", "liability_payment", "You make a one-off or extra payment on a loan (not a scheduled EMI).", "Cash ↓, that loan ↓, Expense ↑"]
    ];

    return `
<div class="guide-hero">
    <div>
        <div class="profile-kicker">Arbor Guide</div>
        <h2>Set up Arbor once, then keep it accurate in five minutes a month.</h2>
        <p>Follow the steps in order the first time. Each step tells you exactly which button to press, what to type, and what will change on your dashboard. Buttons marked → open the right form for you.</p>
    </div>
    <div class="guide-checklist">
        <span>1. Create accounts with today's balances</span>
        <span>2. Record each real money event once</span>
        <span>3. Check Total Cash against your bank</span>
    </div>
</div>

<nav class="guide-toc" aria-label="Guide sections">
    ${toc.map(([id, title]) => `<button data-guide-jump="${id}">${title}</button>`).join("")}
</nav>

<div class="guide-grid">

${section("guide-map", "Orientation", "Find your way around", `
    <div class="guide-table">
        <div class="guide-table-row"><span>Top bar</span><strong>Add Data</strong><p>Opens the Command Panel on the right. Everything you enter goes through it.</p></div>
        <div class="guide-table-row"><span>Top bar</span><strong>Profiles</strong><p>Goes back to the profile list so you can open another workspace.</p></div>
        <div class="guide-table-row"><span>Top bar</span><strong>Logout</strong><p>Signs you out. Your data stays saved in your account.</p></div>
        <div class="guide-table-row"><span>Tab</span><strong>Overview</strong><p>All metrics, your HFRI score, account balances and recent activity.</p></div>
        <div class="guide-table-row"><span>Tab</span><strong>Accounts</strong><p>Your accounts, assets, loans and EMI schedules with their current values.</p></div>
        <div class="guide-table-row"><span>Tab</span><strong>Activity</strong><p>The full ledger of every entry, newest first. Delete entries here with ×.</p></div>
        <div class="guide-table-row"><span>Command Panel</span><strong>Add Activity</strong><p>Record income, spending, transfers, investments and loans.</p></div>
        <div class="guide-table-row"><span>Command Panel</span><strong>Add Account</strong><p>Create a new place where money is kept. Close the panel with × or by clicking outside it.</p></div>
    </div>
`)}

${section("guide-setup", "Step 1", "Create and open a profile", `
    <p>A profile is a separate workspace. Money in one profile never mixes with another, so use one for Personal, one for Business, and so on.</p>
    ${steps([
        "Press <strong>Profiles</strong> in the top bar to reach the profile list.",
        "Under <strong>Create Profile</strong>, type a name such as <em>Personal</em>.",
        "Choose <strong>Personal</strong>, <strong>Business</strong> or <strong>Family</strong>, then press <strong>Create Profile</strong>.",
        "Click the profile card to open it. Arbor creates a starter account called <strong>Main Account</strong> with a ₹0 balance."
    ])}
`)}

${section("guide-accounts", "Step 2", "Add every place your money is kept", `
    <p>An account is a real place that holds money: a bank account, the cash in your wallet, Paytm or another wallet. It is <strong>not</strong> a category like Rent or Food.</p>
    ${steps([
        "Press <strong>Add Data</strong>, then the <strong>Add Account</strong> tab.",
        "Type the account name exactly as you know it, e.g. <em>HDFC Savings</em>.",
        "In <strong>Current Balance</strong>, type what the account holds <strong>today</strong>. Arbor counts forward from this number.",
        "Pick <strong>Cash</strong>, <strong>Bank</strong> or <strong>Wallet</strong>. For Bank, also pick Savings or Current.",
        "Press <strong>Add Account</strong>. Repeat for every account you use.",
        "Open the <strong>Accounts</strong> tab and check each balance matches reality."
    ])}
    ${note("The starter Main Account has a ₹0 balance. If you don't need it, delete it with × before recording anything in it. An account with entries can't be deleted, so its history stays correct.")}
    <div class="guide-actions">${tryIt("Add an account", "account")}${goTo("Open Accounts tab", "accounts")}</div>
`)}

${section("guide-daily", "Step 3", "Record income and spending", `
    <p>Record each real event once, on the day it happened. All entries use the same form:</p>
    ${steps([
        "Press <strong>Add Data</strong>. The <strong>Add Activity</strong> tab opens.",
        "Choose the <strong>Activity Type</strong> (Income or Expense).",
        "Choose the <strong>subtype</strong> in the first drop-down. For Income: salary, business, interest, dividend or other. For Expense: <em>fixed</em> (rent, EMIs you track as bills, school fees), <em>variable</em> (groceries, fuel, utilities), <em>discretionary</em> (eating out, shopping, travel) or <em>tax</em>.",
        "Type the <strong>Amount</strong> in rupees, numbers only, no commas.",
        "Type a short <strong>Description</strong>. Use the same word every time (always \"Rent\", never \"House rent\").",
        "Pick the <strong>account</strong> the money went into or came out of.",
        "Pick the <strong>date</strong>. If you leave it empty, Arbor uses today.",
        "Press <strong>Add</strong>. The dashboard updates immediately."
    ])}
    ${note("Subtypes matter: salary feeds MRR, and fixed and variable expenses count as <strong>essential spending</strong> in your HFRI score. Discretionary spending does not.")}
    <div class="guide-actions">${tryIt("Add income", "activity", "income")}${tryIt("Add an expense", "activity", "expense")}</div>
`)}

${section("guide-transfer", "Step 4", "Move money between your own accounts", `
    ${steps([
        "Press <strong>Add Data</strong> and choose <strong>Transfer</strong>.",
        "Type the amount and a description such as <em>ATM withdrawal</em>.",
        "Pick the <strong>From account</strong> (money leaves) and the <strong>To account</strong> (money arrives).",
        "Press <strong>Add</strong>."
    ])}
    ${note("A transfer is never income or an expense. Don't record an ATM withdrawal as an expense, or your spending will be counted twice: once at the ATM and again when you spend the cash.")}
    <div class="guide-actions">${tryIt("Add a transfer", "activity", "transfer")}</div>
`)}

${section("guide-assets", "Step 5", "Investments and other assets", `
    <p><strong>Buying</strong>: mutual funds, shares, gold, property, a vehicle.</p>
    ${steps([
        "Press <strong>Add Data</strong> and choose <strong>Buy Asset</strong>.",
        "Type the price paid as the Amount and the asset name as the Description (e.g. <em>Nifty 50 Index Fund</em>). The description becomes the asset's name.",
        "Pick the account you paid from, and the purchase date.",
        "Optional: type an expected yearly <strong>Return %</strong> (empty = 5%, 0 is allowed). Choose <strong>Appreciating</strong> for things that grow, <strong>Depreciating</strong> for things like vehicles and electronics. Choose Simple or Compound growth.",
        "Press <strong>Add</strong>. Cash goes down and Assets go up by the same amount."
    ])}
    <p><strong>Selling</strong>: choose <strong>Sell Asset</strong>, pick the asset from the drop-down, type the amount you received, and pick the receiving account. A partial sale reduces the asset's value by the amount sold.</p>
    ${note("An asset's value is an estimate from the return % you entered. To bring it in line with the market, sell it in Arbor at today's value, then buy it again at that value.")}
    <div class="guide-actions">${tryIt("Buy an asset", "activity", "asset_buy")}${tryIt("Sell an asset", "activity", "asset_sell")}</div>
`)}

${section("guide-loans", "Step 6", "Loans and EMIs", `
    <p><strong>Taking a loan</strong>: home loan, car loan, personal loan, money borrowed from family.</p>
    ${steps([
        "Press <strong>Add Data</strong> and choose <strong>New Loan</strong>.",
        "Type the amount borrowed and a name for the loan (e.g. <em>Car Loan SBI</em>).",
        "Pick the account the money arrived in, and the loan date.",
        "Type the yearly <strong>Interest %</strong> (empty = 8%, 0 is allowed) and choose Simple or Compound.",
        "If you repay in fixed monthly installments, fill in <strong>Tenure (Months)</strong> and <strong>EMI Amount</strong>. Arbor then creates an EMI schedule. Leave both empty for a loan without EMIs.",
        "Press <strong>Add</strong>. Cash and Liabilities both go up, so Net Worth doesn't change."
    ])}
    <p><strong>How EMIs work</strong>: the first EMI is due one month after the loan date. Every EMI whose date has arrived is taken from the chosen account and from the loan automatically. Arbor stops when the tenure ends or the loan is fully paid. The Accounts tab shows how many have been paid and the next due date.</p>
    <p><strong>Extra or one-off payments</strong>: choose <strong>Repay Loan</strong>, pick the loan, type the amount, pick the account, then press Add.</p>
    ${note("Never record a scheduled EMI with Repay Loan. Arbor already counts it, and it would be paid twice.")}
    <div class="guide-actions">${tryIt("Add a loan", "activity", "liability_add")}${tryIt("Repay a loan", "activity", "liability_payment")}</div>
`)}

${section("guide-tax", "Step 7", "Tax: you record it, Arbor never calculates it", `
    <p>Arbor doesn't estimate tax, because every person's situation is different. When you actually pay tax (TDS on salary, advance tax, property tax, GST you bear), record it yourself:</p>
    ${steps([
        "Press <strong>Add Data</strong> and choose <strong>Expense</strong>.",
        "In the subtype drop-down choose <strong>tax</strong>.",
        "Type the amount paid and a description such as <em>Advance tax Q2</em> or <em>TDS – March</em>.",
        "Pick the account it was paid from and the date, then press <strong>Add</strong>."
    ])}
    ${note("If your salary arrives after TDS is deducted, record only the amount you received as Income. You don't need a tax entry for TDS you never received. Tax entries count in Expense, and the HFRI subtracts them from income to get disposable income.")}
    <div class="guide-actions">${tryIt("Record a tax payment", "activity", "expense")}</div>
`)}

${section("guide-metrics", "Step 8", "Read your dashboard", `
    <p>Open the <strong>Overview</strong> tab. Everything is calculated <strong>as of today</strong>. Entries dated in the future appear in the ledger marked <em>scheduled</em>, but they don't affect any number until their date arrives.</p>
    <div class="guide-metric-list">
        ${metrics.map(([label, description]) => `<div><strong>${label}</strong><span>${description}</span></div>`).join("")}
    </div>
    <div class="guide-actions">${goTo("Open Overview", "overview")}</div>
`)}

${section("guide-hfri", "Resilience", "HFRI: Household Financial Resilience Index", `
    <p>HFRI is a 0–100 score of how well your household could absorb a financial shock, such as a job loss, a medical bill or an income cut, while still meeting essential obligations. It was developed by Vivaan Agarwal and combines four dimensions, each scored 0–100 with the calibrated functions from the research paper:</p>
    <div class="guide-table">
        <div class="guide-table-row"><span>25% · S</span><strong>Savings Strength</strong><p>Savings rate (Y − C) ÷ Y. Can you create a surplus each month?</p></div>
        <div class="guide-table-row"><span>25% · D</span><strong>Debt Sustainability</strong><p>40% debt-to-income (Debt ÷ Y) + 60% debt-service-to-income (repayments ÷ Y). How heavy are your loans and EMIs?</p></div>
        <div class="guide-table-row"><span>25% · E</span><strong>Emergency Coverage</strong><p>Liquid savings ÷ monthly essential spending. How many months could you cover?</p></div>
        <div class="guide-table-row"><span>25% · X</span><strong>Expense Stability</strong><p>Coefficient of variation of monthly spending (std dev ÷ mean). How predictable is your spending?</p></div>
    </div>
    <h3 class="guide-subhead">Where Arbor gets each number</h3>
    <div class="guide-metric-list">
        <div><strong>Y: disposable income</strong><span>Income minus tax entries, averaged per month over your last 12 months of activity, × 12.</span></div>
        <div><strong>C: spending</strong><span>Expense entries except tax. Loan payments and EMIs are counted separately as debt service.</span></div>
        <div><strong>Debt and debt service</strong><span>Outstanding loans today, and repayments plus EMIs per year.</span></div>
        <div><strong>L: liquid savings</strong><span>Total Cash across all accounts. Investments are not counted as liquid.</span></div>
        <div><strong>Essential spending</strong><span>Expenses with the fixed or variable subtype. If none are tagged, all spending is used.</span></div>
        <div><strong>CV: stability</strong><span>Calculated from your month-by-month spending. A month with no spending counts as zero.</span></div>
    </div>
    <h3 class="guide-subhead">What your score means</h3>
    <div class="guide-bands">
        <div class="band very-low"><strong>Below 60</strong><span>Very low</span></div>
        <div class="band low"><strong>60–65</strong><span>Low</span></div>
        <div class="band transition"><strong>65–70</strong><span>Transition zone: small gains in liquidity matter most</span></div>
        <div class="band high"><strong>70–75</strong><span>High</span></div>
        <div class="band very-high"><strong>75+</strong><span>Very high</span></div>
    </div>
    <p>To see your score: open <strong>Overview</strong>. The HFRI card shows the total and its band, and the <strong>Financial Resilience</strong> panel shows all four dimension scores and the inputs used. You need income and at least two months of activity before a score appears.</p>
    <p><strong>To improve it</strong>: build cash to cover more months of essential spending (biggest effect in the transition zone), keep total EMIs low relative to income, spend less than you earn, and smooth large one-off purchases.</p>
    ${note("The bands are provisional. They come from the paper's 1,000-household simulation and have not been validated on real household data. Use HFRI as a guide, not a guarantee.")}
    <div class="guide-actions">
        <a class="guide-try" href="${HFRI_LINKS.calculator}" target="_blank" rel="noopener">Open the HFRI Calculator →</a>
        <a class="guide-try ghost" href="${HFRI_LINKS.paper}" target="_blank" rel="noopener">Read the research paper →</a>
    </div>
    <p class="guide-small">The calculator lets you try what-if scenarios and income or spending shocks with your own numbers. Arbor's figures are good inputs for it.</p>
`)}

${section("guide-mistakes", "Corrections", "Fixing mistakes", `
    <p>Entries can't be edited. To correct one, delete it and add it again.</p>
    ${steps([
        "Open the <strong>Activity</strong> tab and find the entry.",
        "Press <strong>×</strong> on the right and confirm.",
        "Add the corrected entry with <strong>Add Data</strong>."
    ])}
    <div class="guide-metric-list">
        <div><strong>Buy Asset entry</strong><span>Deleting it also deletes the asset. If you've already recorded a sale of that asset, delete the sale first.</span></div>
        <div><strong>New Loan entry</strong><span>Deleting it also deletes the loan and its EMI schedule. If repayments exist, delete them first.</span></div>
        <div><strong>Accounts</strong><span>Only accounts with no entries and no EMI schedules can be deleted. A profile always keeps at least one account.</span></div>
        <div><strong>EMI schedule</strong><span>Delete with × on the Accounts tab. EMIs it already paid are no longer counted, so cash and the loan balance go back up.</span></div>
    </div>
    <div class="guide-actions">${goTo("Open Activity", "activity")}</div>
`)}

${section("guide-routine", "Habit", "Your monthly routine (5 minutes)", `
    ${steps([
        "Add any income, expenses, tax payments and transfers you missed this month.",
        "Open <strong>Accounts</strong>. Compare each account balance with your bank app or wallet. If one is off, look in <strong>Activity</strong> for a missing or duplicate entry.",
        "Check the EMI schedule shows the right number of EMIs paid.",
        "Open <strong>Overview</strong> and look at Savings, Emergency and HFRI. Compare them with last month.",
        "If HFRI is in the transition zone (65–70) or below, use the HFRI Calculator to see which change would help most."
    ])}
`)}

${section("guide-trouble", "Help", "Troubleshooting: when a number looks wrong", `
    <p>Check these in order. They cause almost every mismatch:</p>
    ${steps([
        "<strong>Opening balances</strong>: is each account's opening balance its balance on the day you started tracking?",
        "<strong>Dates</strong>: an entry dated in the future is ignored until that date. A wrong year is a common slip.",
        "<strong>Account picked</strong>: was the entry recorded against the right account?",
        "<strong>Wrong type</strong>: a transfer recorded as an expense, or a loan recorded as income.",
        "<strong>Duplicates</strong>: the same event entered twice, or an EMI also entered as Repay Loan.",
        "<strong>Old EMI schedules</strong>: a schedule for a loan that was closed early still deducts money. Delete it."
    ])}
    ${note("HFRI shows \"Not enough data\" until you have income and at least two months of activity.")}
`)}

</div>
`;
}


function renderHFRIPanel(hfri) {
    if (!hfri?.available) {
        return `
<div class="section hfri-panel">
    <h2>Financial Resilience (HFRI)</h2>
    <div class="content">
        <div class="empty-state">${escapeHTML(hfri?.reason || "Not enough data yet.")} <button class="link-btn" data-go-view="guide">How HFRI works</button></div>
    </div>
</div>`;
    }

    const { scores, indicators, inputs, band, total, months } = hfri;
    const pct = v => `${(v * 100).toFixed(1)}%`;
    const ec = indicators.ec === Infinity ? "∞" : `${indicators.ec.toFixed(1)} months`;
    const dims = [
        ["Savings Strength", scores.S, `Savings rate ${pct(indicators.sr)}`],
        ["Debt Sustainability", scores.D, `Debt ${pct(indicators.dti)} of income • repayments ${pct(indicators.dsti)} of income`],
        ["Emergency Coverage", scores.E, `${ec} of essential spending`],
        ["Expense Stability", scores.X, `Spending variation (CV) ${indicators.cv.toFixed(2)}`]
    ];

    return `
<div class="section hfri-panel">
    <h2>Financial Resilience (HFRI)</h2>
    <div class="content">
        <div class="hfri-head band-${band.key}">
            <div class="hfri-score"><strong>${total.toFixed(1)}</strong><span>/ 100</span></div>
            <div>
                <div class="hfri-band">${escapeHTML(band.label)}</div>
                <p>${escapeHTML(band.text)} Based on your last ${months} month${months === 1 ? "" : "s"} of activity. Bands are provisional.</p>
            </div>
        </div>
        <div class="hfri-dims">
            ${dims.map(([label, score, detail]) => `
            <div class="hfri-dim">
                <div class="hfri-dim-top"><span>${label}</span><strong>${score.toFixed(0)}</strong></div>
                <div class="hfri-bar"><i style="width:${Math.max(0, Math.min(100, score)).toFixed(1)}%"></i></div>
                <small>${detail}</small>
            </div>`).join("")}
        </div>
        <div class="hfri-inputs">
            Inputs: disposable income ${formatMoney(inputs.income)}/yr • spending ${formatMoney(inputs.spending)}/yr •
            debt ${formatMoney(inputs.debt)} • repayments ${formatMoney(inputs.debtService)}/yr •
            liquid cash ${formatMoney(inputs.liquid)} • essential ${formatMoney(inputs.essentialMonthly)}/mo
        </div>
        <div class="guide-actions">
            <a class="guide-try" href="${HFRI_LINKS.calculator}" target="_blank" rel="noopener">Try what-ifs in the HFRI Calculator →</a>
            <button class="guide-try ghost" data-go-view="guide">How HFRI works →</button>
        </div>
    </div>
</div>`;
}

// ==========================
// PROFILE SCREEN
// ==========================

async function renderProfiles(user) {
    const profiles = await getProfiles(user.uid);

    let selectedType = "personal";

    // drop the dashboard's click handler so it can't act on this screen
    document.body.onclick = null;

    document.body.innerHTML = `
    <div class="profile-shell">
        <header class="profile-topbar">
            <div>
                <div class="brand-mark">Arbor</div>
                <p>${escapeHTML(user.email)}</p>
            </div>
            <button id="logout" class="top-action danger-action">Logout</button>
        </header>

        <main class="profile-layout">
            <section class="profile-hero-panel">
                <div class="profile-kicker">Workspace Selection</div>
                <h1>Choose the financial workspace you want to manage.</h1>
                <p>Keep personal, business, and family finances separate while using the same account, metric, and ledger system.</p>
                <div class="profile-stats">
                    <div><strong>${profiles.length}</strong><span>Profiles</span></div>
                    <div><strong>3</strong><span>Workspace Types</span></div>
                </div>
            </section>

            <section class="profile-card-panel">
                <div class="panel-title-row">
                    <div>
                        <h2>Your Profiles</h2>
                        <p>Select a workspace to open its dashboard.</p>
                    </div>
                </div>

                <div class="profiles-grid">
                    ${profiles.length === 0
        ? `<div class="empty-state">No profiles yet. Create one below to start tracking.</div>`
        : profiles.map(p => `
                        <button class="profile-card" data-id="${p.id}">
                            <div class="profile-icon">${p.name ? escapeHTML(p.name[0].toUpperCase()) : "P"}</div>
                            <div class="profile-info">
                                <div class="profile-name">${escapeHTML(p.name)}</div>
                                <div class="profile-sub">${escapeHTML(p.type)}</div>
                            </div>
                            <span>Open</span>
                        </button>
                    `).join("")}
                </div>

                <div class="create-profile-panel">
                    <div class="panel-title-row">
                        <div>
                            <h2>Create Profile</h2>
                            <p>Use a clear name like Personal, Studio, Family, or Startup.</p>
                        </div>
                    </div>

                    <input id="profileName" placeholder="Profile name" />
                    <div id="profileMessage" class="auth-message" role="status"></div>

                    <div class="select profile-type-toggle">
                        <button id="personalBtn" class="active">Personal</button>
                        <button id="businessBtn">Business</button>
                        <button id="familyBtn">Family</button>
                    </div>

                    <button id="createProfile" class="primary">Create Profile</button>
                </div>
            </section>
        </main>
    </div>
    `;






    // profile type toggle
    ["personal","business","family"].forEach(type => {
        document.getElementById(type+"Btn").onclick = () => {
            selectedType = type;
            document.querySelectorAll(".select button").forEach(b => b.classList.remove("active"));
            document.getElementById(type+"Btn").classList.add("active");
        };
    });

    // click profile
    document.querySelectorAll(".profile-card").forEach(card => {
        card.onclick = async () => {
            localStorage.setItem("selectedProfile", card.dataset.id);
            await renderApp(user);
        };
    });

    // create profile
    document.getElementById("createProfile").onclick = async () => {
        const name = document.getElementById("profileName").value.trim();
        const profileMessage = document.getElementById("profileMessage");

if (!name) {
    profileMessage.textContent = "Enter a profile name.";
    profileMessage.className = "auth-message error";
    return;
}
        if (profiles.some(p => p.name?.trim().toLowerCase() === name.toLowerCase())) {
            profileMessage.textContent = "A profile with this name already exists.";
            profileMessage.className = "auth-message error";
            return;
        }

        try {
            profileMessage.textContent = "Creating profile...";
            profileMessage.className = "auth-message info";
            await createProfile(user.uid, selectedType, name);
            await renderApp(user);
        } catch (error) {
            console.error("Profile creation failed:", error);
            profileMessage.textContent = "Could not create profile. Please try again.";
            profileMessage.className = "auth-message error";
        }
    };

    document.getElementById("logout").onclick = async () => {
        await logoutUser();
    };
}

// ==========================
// DASHBOARD
// ==========================

async function renderDashboard(user, profileId) {

// LOAD ONLY IF EMPTY
const [assets, liabilities, allTransactions, accounts, emis] = await Promise.all([
    getAssets(profileId),
    getLiabilities(profileId),
    getTransactions(profileId),
    getAccounts(profileId),
    getEMIs(profileId)
]);

state.assets = assets;
state.liabilities = liabilities;
state.transactions = allTransactions;
state.accounts = accounts;
state.emis = emis;


// AUTO CREATE DEFAULT ACCOUNT
if (!accounts || accounts.length === 0) {
    await createAccount(profileId, "Main Account", "bank");

    // 🔥 UPDATE STATE
    state.accounts = await getAccounts(profileId);

    return renderDashboard(user, profileId);
}

const metrics = computeFinancials(state);

// Values come from the engine so every screen shows the same numbers
// (interest growth, EMIs and repayments included).
function getLiabilityOutstanding(l) {
    return metrics.liabilityOutstanding[l.id] || 0;
}

function getAssetCurrentValue(a) {
    return metrics.assetValues[a.id] || 0;
}

// No UI sets a month filter any more; clear any stale value so it
// can't silently hide transactions.
localStorage.removeItem("selectedMonth");

const transactions = [...allTransactions].sort((a, b) => {
    const t1 = new Date(b.date).getTime();
    const t2 = new Date(a.date).getTime();

    if (!isNaN(t1) && !isNaN(t2) && t1 !== t2) return t1 - t2;

    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
});

const netWorth = metrics.netWorth;

const {
    income,
    expense,
    totalCash,
    savingsRate,
    emergencyCoverage,
    MRR,
    balances: accountBalances,
    topCategory,
    status,
    avgExpense,
    avgTransaction,
    lastMonthFlow,
    hfri
} = metrics;
let activeView = localStorage.getItem("dashboardView") || "overview";
if (!["overview", "accounts", "activity", "guide"].includes(activeView)) {
    activeView = "overview";
}
const accountRows = accounts.map(a => {
    const balance = accountBalances[a.id] || 0;
    const transactionCount = allTransactions.filter(t => t.accountId === a.id || t.toAccountId === a.id).length;
    const typeLabel = readableType(a.type);
    const details = a.type === "bank" && a.subtype
        ? `${typeLabel} • ${a.subtype}${a.rate ? ` • ${a.rate}% interest` : ""}`
        : typeLabel;

    return `
        <div class="list-item account-item">
            <div>
                <div class="title">${escapeHTML(a.name)}</div>
                <div class="sub">${escapeHTML(details)} • Opening ${formatMoney(a.openingBalance || 0)} • ${transactionCount} entries</div>
            </div>
            <div class="item-actions">
                <strong class="${balance >= 0 ? "green" : "red"}">${formatMoney(balance)}</strong>
                <button class="delete-account" data-id="${a.id}" title="Delete account">×</button>
            </div>
        </div>
    `;
}).join("");

const accountNameById = Object.fromEntries(accounts.map(a => [a.id, a.name]));

const todayDate = new Date();

function transactionAccountLabel(t) {
    const from = accountNameById[t.accountId] || "No account";
    if (t.type !== "transfer") return escapeHTML(from);
    return `${escapeHTML(from)} → ${escapeHTML(accountNameById[t.toAccountId] || "No account")}`;
}

function amountClass(type) {
    if (type === "transfer") return "";
    return ["income", "asset_sell", "liability_add"].includes(type) ? "green" : "red";
}

const transactionRows = transactions.length
    ? transactions.map(t => `
        <div class="list-item">
            <div>
                <div class="title">${escapeHTML(t.category || "Untitled transaction")}</div>
                <div class="sub">${readableType(t.type)} • ${t.subtype ? `${escapeHTML(t.subtype)} • ` : ""}${transactionAccountLabel(t)} • ${t.date ? new Date(t.date).toLocaleDateString() : "No date"}${toDate(t.date) > todayDate ? " • scheduled" : ""}</div>
            </div>
            <div class="item-actions">
                <strong class="${amountClass(t.type)}">${formatMoney(t.amount)}</strong>
                <button class="delete" data-id="${t.id}" title="Delete transaction">×</button>
            </div>
        </div>
    `).join("")
    : `<div class="empty-state">No transactions yet. Add income, expenses, assets, or loans from the Add panel.</div>`;

const assetRows = assets.length
    ? assets.map(a => `
        <div class="list-item">
            <div>
                <div class="title">${escapeHTML(a.name)}</div>
                <div class="sub">${escapeHTML(readableType(a.type))} • ${escapeHTML(a.rate ?? 5)}% • ${escapeHTML(a.compounding || "simple")}${toDate(a.startDate) > todayDate ? ` • starts ${formatDate(a.startDate)}` : ""}</div>
            </div>
            <div class="item-actions">
                <strong>${formatMoney(getAssetCurrentValue(a))}</strong>
                <button class="delete-asset" data-id="${a.id}" title="Delete asset">×</button>
            </div>
        </div>
    `).join("")
    : `<div class="empty-state">No assets yet. Use Buy asset when you purchase an investment or valuable item.</div>`;

const liabilityRows = liabilities.length
    ? liabilities.map(l => `
        <div class="list-item">
            <div>
                <div class="title">${escapeHTML(l.name)}</div>
                <div class="sub">${escapeHTML(l.rate ?? 8)}% • ${escapeHTML(l.type || "simple")} interest${toDate(l.startDate) > todayDate ? ` • starts ${formatDate(l.startDate)}` : ""}</div>
            </div>
            <div class="item-actions">
                <strong class="red">${formatMoney(getLiabilityOutstanding(l))}</strong>
                <button class="delete-liability" data-id="${l.id}" title="Delete liability">×</button>
            </div>
        </div>
    `).join("")
    : `<div class="empty-state">No loans or liabilities yet. Use New loan when money is borrowed.</div>`;

function emiSummary(e) {
    const info = metrics.emiStatus[e.id] || {};
    const progress = info.tenure
        ? `${info.paidCount || 0}/${info.tenure} paid`
        : `${info.paidCount || 0} paid`;
    const next = info.completed
        ? "Completed"
        : `Next due ${formatDate(info.nextDue || e.firstDate || e.nextDate)}`;
    const account = accountNameById[e.accountId] ? ` • from ${escapeHTML(accountNameById[e.accountId])}` : " • account missing";
    return `${next} • ${progress}${account}`;
}

const emiRows = state.emis.length
    ? state.emis.map(e => `
        <div class="list-item">
            <div>
                <div class="title">${escapeHTML(e.name || "EMI")}</div>
                <div class="sub">${emiSummary(e)}</div>
            </div>
            <div class="item-actions">
                <strong class="red">${formatMoney(e.amount)}</strong>
                <button class="delete-emi" data-id="${e.id}" title="Delete EMI">×</button>
            </div>
        </div>
    `).join("")
    : `<div class="empty-state">No EMI schedule yet. Add one while creating a new loan.</div>`;
   document.body.innerHTML = `
<div class="app">

    <!-- TOP BAR -->
    <div class="topbar">
    <div class="left">
        <button id="togglePanel" class="top-action primary-action">Add Data</button>
        <button id="backBtn" class="top-action">Profiles</button>
    </div>

    <div class="center">Arbor Dashboard</div>

    <div class="right">
        <button id="logout" class="top-action danger-action">Logout</button>
    </div>
</div>

    <div class="dashboard-tabs">
        <button class="view-tab ${activeView === "overview" ? "active" : ""}" data-view="overview">Overview</button>
        <button class="view-tab ${activeView === "accounts" ? "active" : ""}" data-view="accounts">Accounts</button>
        <button class="view-tab ${activeView === "activity" ? "active" : ""}" data-view="activity">Activity</button>
        <button class="view-tab ${activeView === "guide" ? "active" : ""}" data-view="guide">Guide</button>
    </div>

    <div class="layout">

        <!-- LEFT SIDE -->
        <div class="main">

${activeView === "overview" ? `
<div class="page-heading">
    <div>
        <h1>Financial Overview</h1>
        <p>Track cash, spending, investments, loans, and repayment health in one place.</p>
    </div>
    <button id="openAddPanel" class="btn-primary compact" data-open-panel="activity">Add entry</button>
</div>

<div class="metrics-row">

    <div class="metric-box">
        <div>Income</div>
        <strong>${formatMoney(income)}</strong>
        <span>Money added to accounts.</span>
    </div>

    <div class="metric-box">
        <div>Expense</div>
        <strong>${formatMoney(expense)}</strong>
        <span>Spending, loan payments and EMIs.</span>
    </div>

    <div class="metric-box ${totalCash>=0?'green':'red'}">
    <div>Total Cash</div>
<strong>${formatMoney(totalCash)}</strong>
<span>Sum of all account balances.</span>
</div>

    
    <div class="metric-box">
        <div>Net Worth</div>
        <strong>${formatMoney(netWorth)}</strong>
        <span>Cash + assets - liabilities.</span>
    </div>

    <div class="metric-box">
        <div>Savings</div>
        <strong>${(savingsRate * 100).toFixed(1)}%</strong>
        <span>Income left after expenses.</span>
    </div>

    <div class="metric-box">
        <div>Emergency</div>
        <strong>${emergencyCoverage.toFixed(1)} mo</strong>
        <span>Months of spending cash can cover.</span>
    </div>

    <div class="metric-box">
        <div>Status</div>
        <strong>${status}</strong>
        <span>Based on savings rate.</span>
    </div>

    <div class="metric-box hfri-metric ${hfri.available ? `band-${hfri.band.key}` : ""}">
        <div>HFRI</div>
        <strong>${hfri.available ? `${hfri.total.toFixed(1)}<small>/100</small>` : "—"}</strong>
        <span>${hfri.available ? `${escapeHTML(hfri.band.label)} resilience.` : "Not enough data yet."}</span>
    </div>

    <div class="metric-box">
        <div>Top Spend</div>
        <strong>${escapeHTML(topCategory)}</strong>
        <span>Largest expense category.</span>
    </div>

    <div class="metric-box">
    <div>3M Avg Expense</div>
    <strong>${formatMoney(avgExpense)}</strong>
    <span>Average recent monthly spend.</span>
</div>
<div class="metric-box">
    <div>Avg Transaction Size</div>
    <strong>${formatMoney(avgTransaction)}</strong>
    <span>Typical outgoing entry.</span>
</div>
<div class="metric-box ${lastMonthFlow >= 0 ? 'green' : 'red'}">
    <div>Monthly Flow</div>
    <strong>${formatMoney(lastMonthFlow)}</strong>
    <span>Income minus expenses.</span>
</div>
<div class="metric-box">
    <div>MRR</div>
    <strong>${formatMoney(MRR)}</strong>
    <span>Average monthly salary income.</span>
</div>
</div>

${renderHFRIPanel(hfri)}

<div class="summary-grid">
    <div class="section">
        <h2>Account Balances</h2>
        <div class="content">${accountRows}</div>
    </div>
    <div class="section">
        <h2>Recent Activity</h2>
        <div class="content">${transactionRows}</div>
    </div>
</div>
` : ""}

${activeView === "accounts" ? `
<div class="page-heading">
    <div>
        <h1>Accounts</h1>
        <p>Accounts are where cash lives. Every transaction credits or debits one account.</p>
    </div>
    <button id="openAddPanel" class="btn-primary compact" data-open-panel="account">Add account</button>
</div>
<div class="section">
    <h2>Cash Locations</h2>
    <div class="content">${accountRows}</div>
</div>
<div class="two-column">
    <div class="section">
        <h2>Assets</h2>
        <div class="content">${assetRows}</div>
    </div>
    <div class="section">
        <h2>Liabilities</h2>
        <div class="content">${liabilityRows}</div>
    </div>
</div>
<div class="section">
    <h2>EMI Schedule</h2>
    <div class="content">${emiRows}</div>
</div>
` : ""}

${activeView === "activity" ? `
<div class="page-heading">
    <div>
        <h1>Activity</h1>
        <p>Review all income, expenses, investments, asset sales, loans, and repayments.</p>
    </div>
    <button id="openAddPanel" class="btn-primary compact" data-open-panel="activity">Add transaction</button>
</div>
<div class="section">
    <h2>Transaction Ledger</h2>
    <div class="content">${transactionRows}</div>
</div>
` : ""}

${activeView === "guide" ? `
<div class="page-heading">
    <div>
        <h1>Guide</h1>
        <p>Step-by-step instructions for every screen and every kind of entry, plus how to read your HFRI score.</p>
    </div>
</div>
${renderGuideContent()}
` : ""}
<div class="overlay" id="overlay"></div>
        </div>

        <!-- RIGHT PANEL -->
        <div class="side">
<div class="panel-head">
    <div>
        <h2>Command Panel</h2>
        <p>Add one clean record at a time. Accounts are cash locations; activity changes balances.</p>
    </div>
    <button id="closePanel" class="icon-btn" title="Close">×</button>
</div>

<div class="panel-tabs">
    <button class="panel-tab active" data-panel="activity">Add Activity</button>
    <button class="panel-tab" data-panel="account">Add Account</button>
</div>

<div class="panel-section active" data-panel-section="activity">
<div class="form-card">
    <div class="form-label">Activity Type</div>
    <p class="field-help">Choose the real-world event you want to record.</p>

    <div class="segmented" id="txnTypeToggle">
        <button data-value="income" class="active">Income</button>
        <button data-value="expense">Expense</button>
        <button data-value="asset_buy">Buy Asset</button>
        <button data-value="asset_sell">Sell Asset</button>
        <button data-value="liability_add">New Loan</button>
        <button data-value="liability_payment">Repay Loan</button>
        <button data-value="transfer">Transfer</button>
    </div>
</div>

<select id="txnSubType"></select>

<div class="form-group">
    <input id="amount" placeholder="Amount" />
    <input id="category" placeholder="Description (e.g. Rent, Salary, Nifty Fund)" />
    
    <select id="accountSelect"></select>
    <select id="toAccountSelect" style="display:none;"></select>
    <select id="assetSelect" style="display:none;"></select>
    <select id="liabilitySelect" style="display:none;"></select>

    <input id="date" type="date" />
</div>
<div id="assetFields" class="hidden">
    <input id="assetRate" placeholder="Return %" />

    <select id="assetDirection">
        <option value="appreciating">Appreciating</option>
        <option value="depreciating">Depreciating</option>
    </select>

    <select id="assetCompounding">
        <option value="simple">Simple</option>
        <option value="compound">Compound</option>
    </select>
</div>
<div id="liabilityFields" class="hidden">

    <div class="form-card">
        <div class="form-label">Loan Details</div>

        <div class="form-row">
            <input id="liabilityRate" placeholder="Interest %" />
            <select id="liabilityCompounding">
                <option value="simple">Simple Interest</option>
                <option value="compound">Compound Interest</option>
            </select>
        </div>

        <div class="form-row split">
            <input id="emiTenure" placeholder="Tenure (Months)" />
            <input id="emiAmount" placeholder="EMI Amount" />
        </div>
    </div>

</div>
<button id="addTxn" class="btn-primary">Add</button>
</div>

<div class="panel-section" data-panel-section="account">
<div class="form-card">
    <div class="form-label">Create Account</div>
    <p class="field-help">Accounts are real places where cash lives. Add one for each balance you want to track.</p>

    <div class="form-row">
        <input id="accName" placeholder="e.g. HDFC Savings, Cash, Paytm Wallet" />
        <input id="accOpeningBalance" placeholder="Current Balance (optional)" />
    </div>

    <div class="form-row">
        <div class="segmented" id="accTypeToggle">
            <button data-value="cash" class="active">Cash</button>
            <button data-value="bank">Bank</button>
            <button data-value="wallet">Wallet</button>
        </div>
    </div>

    <div id="bankDetails" class="bank-details hidden">
        <div class="form-label">Bank Account Type</div>
        <div class="segmented compact-segmented" id="accSubTypeToggle">
            <button data-value="savings" class="active">Savings</button>
            <button data-value="current">Current</button>
        </div>
        <input id="accRate" placeholder="Interest % (optional)" />
    </div>
</div>
<button id="addAccount">Add Account</button>
</div>

    </div>
</div>
</div>
`;

const panel = document.querySelector(".side");

async function runExclusive(button, action) {
    if (isSubmitting) return;
    isSubmitting = true;
    if (button) button.disabled = true;
    try {
        await action();
    } catch (error) {
        console.error("Save failed:", error);
        alert("Could not save. Please check your connection and try again.");
    } finally {
        isSubmitting = false;
        if (button && document.body.contains(button)) button.disabled = false;
    }
}

let accType = "cash";
let accSubType = "savings";

document.getElementById("addAccount").onclick = async (event) => {
    const button = event.currentTarget;
    const name = document.getElementById("accName").value.trim();
    const subtype = accType === "bank" ? accSubType : null;
    if (!name) return alert("Enter an account name");

    if (accounts.some(a => a.name?.trim().toLowerCase() === name.toLowerCase())) {
        return alert("An account with this name already exists.");
    }

    const openingRaw = document.getElementById("accOpeningBalance").value.trim();
    const openingBalance = openingRaw === "" ? 0 : Number(openingRaw);
    if (!Number.isFinite(openingBalance)) return alert("Enter a valid opening balance (numbers only)");

    const rate = accType === "bank" ? parseRate(document.getElementById("accRate").value, 0) : 0;

    await runExclusive(button, async () => {
        await createAccount(profileId, name, accType, subtype, rate, openingBalance);
        await renderDashboard(user, profileId);
    });
};

const overlay = document.getElementById("overlay");
function openPanel() {
    panel.classList.add("open");
    overlay.classList.add("show");
}

function closePanel() {
    panel.classList.remove("open");
    overlay.classList.remove("show");
}

function selectPanel(panelName) {
    document.querySelectorAll(".panel-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.panel === panelName);
    });

    document.querySelectorAll(".panel-section").forEach(section => {
        section.classList.toggle("active", section.dataset.panelSection === panelName);
    });
}

const assetSelect = document.getElementById("assetSelect");
const accountSelect = document.getElementById("accountSelect");
const toAccountSelect = document.getElementById("toAccountSelect");
const liabilitySelect = document.getElementById("liabilitySelect");
const txnSubTypeEl = document.getElementById("txnSubType");
let txnType = "income";

const subtypeMap = {
    income: ["salary", "business", "interest", "dividend", "other"],
    expense: ["fixed", "variable", "discretionary", "tax"],
    asset_buy: ["investment"],
    asset_sell: ["liquidation"],
    liability_add: ["loan"],
    liability_payment: ["repayment"],
    transfer: ["transfer"]
};

document.querySelectorAll(".panel-tab").forEach(btn => {
    btn.onclick = () => {
        selectPanel(btn.dataset.panel);
    };
});

document.querySelectorAll("#txnTypeToggle button").forEach(btn => {
    btn.onclick = () => {
        txnType = btn.dataset.value;

        document.querySelectorAll("#txnTypeToggle button")
            .forEach(b => b.classList.remove("active"));

        btn.classList.add("active");

        updateFormForType();
    };
});

function populateAccounts() {
    const options = accounts
        .map(a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`)
        .join("");

    accountSelect.innerHTML = `<option value="">${txnType === "transfer" ? "From account" : "Select Account"}</option>${options}`;
    toAccountSelect.innerHTML = `<option value="">To account</option>${options}`;
}

function populateAssets() {
    const available = assets.filter(a => getAssetCurrentValue(a) > 0);
    assetSelect.innerHTML = `<option value="">Select Asset</option>` + available
        .map(a => `<option value="${a.id}">${escapeHTML(a.name)} (${formatMoney(getAssetCurrentValue(a))})</option>`)
        .join("");
}

function populateLiabilities() {
    const open = liabilities.filter(l => getLiabilityOutstanding(l) > 0);
    liabilitySelect.innerHTML = `<option value="">Select Loan / Liability</option>` + open
        .map(l => `<option value="${l.id}">${escapeHTML(l.name)} (${formatMoney(getLiabilityOutstanding(l))})</option>`)
        .join("");
}

function updateFormForType() {
    const type = txnType;

    document.getElementById("assetFields").classList.toggle("hidden", type !== "asset_buy");
    document.getElementById("liabilityFields").classList.toggle("hidden", type !== "liability_add");

    assetSelect.style.display = type === "asset_sell" ? "block" : "none";
    liabilitySelect.style.display = type === "liability_payment" ? "block" : "none";
    toAccountSelect.style.display = type === "transfer" ? "block" : "none";

    txnSubTypeEl.innerHTML = (subtypeMap[type] || [])
        .map(s => `<option value="${s}">${s}</option>`)
        .join("");
    txnSubTypeEl.style.display = type === "transfer" ? "none" : "";

    populateAccounts();
    if (type === "asset_sell") populateAssets();
    if (type === "liability_payment") populateLiabilities();
}

updateFormForType();

document.querySelectorAll("#accTypeToggle button").forEach(btn => {
    btn.onclick = () => {
        accType = btn.dataset.value;

        document.querySelectorAll("#accTypeToggle button")
            .forEach(b => b.classList.remove("active"));

        btn.classList.add("active");

        // show/hide extra fields
        document.getElementById("bankDetails")?.classList.toggle("hidden", accType !== "bank");
    };
});

document.querySelectorAll("#accSubTypeToggle button").forEach(btn => {
    btn.onclick = () => {
        accSubType = btn.dataset.value;

        document.querySelectorAll("#accSubTypeToggle button")
            .forEach(b => b.classList.remove("active"));

        btn.classList.add("active");
    };
});

function localISODate(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

document.getElementById("addTxn").onclick = async (event) => {
    const button = event.currentTarget;
    const type = txnType;

    const cat = document.getElementById("category").value.trim();
    const amt = Number(document.getElementById("amount").value);
    // local date, not UTC (late-night IST entries were landing on the previous day)
    const date = document.getElementById("date").value || localISODate();
    const subtype = type === "transfer" ? null : (txnSubTypeEl.value || null);

    let accountId = accountSelect.value;
    // single-account profiles: no need to pick it every time
    if (!accountId && type !== "transfer" && accounts.length === 1) accountId = accounts[0].id;
    let toAccountId = null;
    let assetId = null;
    let liabilityId = null;

    // VALIDATION FIRST
    if (!Number.isFinite(amt) || amt <= 0) {
        alert("Enter a valid amount (numbers only, no commas)");
        return;
    }

    if (!cat) {
        alert("Enter a description");
        return;
    }

    if (!accountId) {
        alert(type === "transfer" ? "Select the account money leaves" : "Select an account");
        return;
    }

    if (type === "transfer") {
        toAccountId = toAccountSelect.value || null;
        if (!toAccountId) {
            alert("Select the account money goes to");
            return;
        }
        if (toAccountId === accountId) {
            alert("Pick two different accounts for a transfer");
            return;
        }
    }

    if (type === "asset_sell") {
        assetId = assetSelect.value || null;
        if (!assetId) {
            alert("Select the asset being sold");
            return;
        }
    }

    if (type === "liability_payment") {
        liabilityId = liabilitySelect.value || null;
        if (!liabilityId) {
            alert("Select the loan or liability being paid");
            return;
        }
    }

    let tenure = 0;
    let emiAmount = 0;
    if (type === "liability_add") {
        const tenureRaw = document.getElementById("emiTenure").value.trim();
        const emiRaw = document.getElementById("emiAmount").value.trim();
        tenure = Number(tenureRaw);
        emiAmount = Number(emiRaw);

        if ((tenureRaw || emiRaw) && !(Number.isInteger(tenure) && tenure > 0 && emiAmount > 0)) {
            alert("For an EMI schedule enter both a whole-number tenure (months) and an EMI amount, or leave both empty.");
            return;
        }
    }

    await runExclusive(button, async () => {
        // ASSET BUY
        if (type === "asset_buy") {
            const assetRef = await addAsset(
                profileId,
                cat,
                amt,
                parseRate(document.getElementById("assetRate").value, 5),
                document.getElementById("assetDirection").value,
                date,
                null,
                document.getElementById("assetCompounding").value
            );
            assetId = assetRef.id;
        }

        // LIABILITY ADD
        if (type === "liability_add") {
            const rate = parseRate(document.getElementById("liabilityRate").value, 8);
            const liabilityMode = document.getElementById("liabilityCompounding")?.value || "simple";

            const liabilityRef = await addLiability(
                profileId,
                cat,
                amt,
                rate,
                date,
                null,
                liabilityMode
            );
            liabilityId = liabilityRef.id;

            // EMI schedule: first installment one month after the loan date
            if (tenure && emiAmount) {
                const firstDate = addMonths(date, 1).toISOString().slice(0, 10);
                await createEMI(profileId, {
                    name: cat,
                    amount: emiAmount,
                    principal: amt,
                    rate,
                    tenure,
                    firstDate,
                    nextDate: firstDate,
                    accountId,
                    liabilityId
                });
            }
        }

        // SAVE TRANSACTION
        await addTransaction(profileId, amt, type, cat, date, {
            accountId,
            toAccountId,
            assetId,
            liabilityId,
            subtype
        });

        await renderDashboard(user, profileId);
    });
};

// EMIs created before liabilityId was stored are linked by name.
function emisForLiability(liability) {
    return state.emis.filter(e =>
        e.liabilityId === liability.id || (!e.liabilityId && e.name === liability.name)
    );
}

async function handleDeleteTransaction(id) {
    const txn = state.transactions.find(t => t.id === id);
    if (!txn) return;

    // Buying an asset / taking a loan created a record. Deleting the
    // transaction must remove that record too, or net worth drifts.
    if (txn.type === "asset_buy" && txn.assetId) {
        const others = state.transactions.filter(t => t.assetId === txn.assetId && t.id !== id);
        if (others.length) {
            alert("This asset has later sales recorded. Delete those sale transactions first.");
            return;
        }
        if (!confirm("Delete this purchase? The asset it created will be removed too.")) return;

        await deleteTransaction(id, profileId);
        if (state.assets.some(a => a.id === txn.assetId)) await deleteAsset(profileId, txn.assetId);
        return;
    }

    if (txn.type === "liability_add" && txn.liabilityId) {
        const others = state.transactions.filter(t => t.liabilityId === txn.liabilityId && t.id !== id);
        if (others.length) {
            alert("This loan has repayments recorded. Delete those repayment transactions first.");
            return;
        }
        if (!confirm("Delete this loan? The liability and its EMI schedule will be removed too.")) return;

        await deleteTransaction(id, profileId);
        const liability = state.liabilities.find(l => l.id === txn.liabilityId);
        if (liability) {
            await Promise.all(emisForLiability(liability).map(e => deleteEMI(e.id, profileId)));
            await deleteLiability(profileId, liability.id);
        }
        return;
    }

    if (!confirm("Delete this transaction?")) return;
    await deleteTransaction(id, profileId);
}

document.body.onclick = async (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // DELETE ACCOUNT
    if (target.classList.contains("delete-account")) {
        const id = target.dataset.id;
        const hasTransactions = state.transactions.some(t => t.accountId === id || t.toAccountId === id);
        const hasEmis = state.emis.some(em => em.accountId === id);

        if (state.accounts.length <= 1) {
            alert("At least one account required");
            return;
        }

        if (hasTransactions || hasEmis) {
            alert("This account has transactions or EMI schedules. Keep it so your balances stay accurate.");
            return;
        }

        if (!confirm("Delete this account?")) return;

        await runExclusive(null, async () => {
            await deleteAccount(id, profileId);
            await renderDashboard(user, profileId);
        });
        return;
    }

    // DELETE EMI
    if (target.classList.contains("delete-emi")) {
        const id = target.dataset.id;

        if (!confirm("Delete this EMI schedule? Installments already paid will no longer be counted.")) return;

        await runExclusive(null, async () => {
            await deleteEMI(id, profileId);
            await renderDashboard(user, profileId);
        });
        return;
    }

    // BACK
    if (target.id === "backBtn") {
        state = EMPTY_STATE();
        localStorage.removeItem("selectedProfile");
        await renderApp(user);
        return;
    }

    // LOGOUT
    if (target.id === "logout") {
        await logoutUser();
        return;
    }

    // GUIDE: jump to a section
    const jump = target.closest("[data-guide-jump]");
    if (jump) {
        document.getElementById(jump.dataset.guideJump)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }

    // GUIDE / anywhere: switch dashboard tab
    const goView = target.closest("[data-go-view]");
    if (goView) {
        localStorage.setItem("dashboardView", goView.dataset.goView);
        await renderDashboard(user, profileId);
        window.scrollTo({ top: 0 });
        return;
    }

    // PANEL OPEN (optionally with an activity type preselected)
    const panelTrigger = target.closest("#togglePanel, [data-open-panel]");
    if (panelTrigger) {
        if (panelTrigger.dataset.openPanel) {
            selectPanel(panelTrigger.dataset.openPanel);
        }
        if (panelTrigger.dataset.txnType) {
            document.querySelector(`#txnTypeToggle button[data-value="${panelTrigger.dataset.txnType}"]`)?.click();
        }
        openPanel();
        return;
    }

    // PANEL CLOSE
    if (target.closest("#overlay") || target.closest("#closePanel")) {
        closePanel();
        return;
    }

    if (target.classList.contains("view-tab")) {
        localStorage.setItem("dashboardView", target.dataset.view);
        await renderDashboard(user, profileId);
        return;
    }

    // DELETE TXN
    if (target.classList.contains("delete")) {
        await runExclusive(null, async () => {
            await handleDeleteTransaction(target.dataset.id);
            await renderDashboard(user, profileId);
        });
        return;
    }

    // DELETE ASSET
    if (target.classList.contains("delete-asset")) {
        const id = target.dataset.id;

        if (state.transactions.some(t => t.assetId === id)) {
            alert("This asset has linked transactions. Delete its purchase transaction instead; that removes the asset too.");
            return;
        }

        if (!confirm("Delete this asset?")) return;
        await runExclusive(null, async () => {
            await deleteAsset(profileId, id);
            await renderDashboard(user, profileId);
        });
        return;
    }

    // DELETE LIABILITY
    if (target.classList.contains("delete-liability")) {
        const id = target.dataset.id;
        const liability = state.liabilities.find(l => l.id === id);

        if (state.transactions.some(t => t.liabilityId === id)) {
            alert("This liability has linked transactions. Delete its loan transaction instead; that removes the liability too.");
            return;
        }

        if (!confirm("Delete this liability and its EMI schedule?")) return;
        await runExclusive(null, async () => {
            if (liability) await Promise.all(emisForLiability(liability).map(em => deleteEMI(em.id, profileId)));
            await deleteLiability(profileId, id);
            await renderDashboard(user, profileId);
        });
    }
};

}
// ==========================
// AUTH
// ==========================

observeAuth(async (user) => {
    if (user) {
        await renderApp(user);
    } else {
        document.body.onclick = null;
        document.body.innerHTML = `
        <div class="container">

            <div class="hero">
                <h1 class="hero-title">Arbor</h1>
                <p class="hero-sub">Quant Financial Operating System</p>
                <p class="hero-mini">Built by Vivaan Agarwal</p>
            </div>

            <div class="card auth-card">

                <input id="email" placeholder="Email" />
                <input id="password" type="password" placeholder="Password" />
                <div id="authMessage" class="auth-message" role="status"></div>

                <button id="login" class="primary">Login</button>
                <button id="signup" class="secondary">Create Account</button>
                <button id="reset" class="link">Forgot Password?</button>

            </div>

        </div>
        `;
        

        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const authMessage = document.getElementById("authMessage");
        const loginBtn = document.getElementById("login");
        const signupBtn = document.getElementById("signup");
        const resetBtn = document.getElementById("reset");

        function setAuthMessage(message, type = "error") {
            authMessage.textContent = message;
            authMessage.className = `auth-message ${type}`;
        }

        function setAuthBusy(isBusy) {
            loginBtn.disabled = isBusy;
            signupBtn.disabled = isBusy;
            resetBtn.disabled = isBusy;
        }

        async function runAuthAction(action, loadingMessage) {
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email) {
                setAuthMessage("Enter your email address.");
                emailInput.focus();
                return;
            }

            if (action !== "reset" && !password) {
                setAuthMessage("Enter your password.");
                passwordInput.focus();
                return;
            }

            setAuthBusy(true);
            setAuthMessage(loadingMessage, "info");

            try {
                if (action === "signup") {
                    await signUp(email, password);
                    // observeAuth renders the app once the session is active
                    setAuthMessage("Account created. Loading your workspace...", "success");
                    return;
                }

                if (action === "login") {
                    await login(email, password);
                    setAuthMessage("Logged in. Loading your workspace...", "success");
                    return;
                }

                await resetPassword(email);
                setAuthMessage("Password reset email sent.", "success");
            } catch (error) {
                console.error("Auth action failed:", error);
                setAuthMessage(getAuthErrorMessage(error));
            } finally {
                setAuthBusy(false);
            }
        }

        signupBtn.onclick = async () => {
            await runAuthAction("signup", "Creating account...");
        };

        loginBtn.onclick = async () => {
            await runAuthAction("login", "Logging in...");
        };

        resetBtn.onclick = async () => {
            await runAuthAction("reset", "Sending reset email...");
       };

        [emailInput, passwordInput].forEach(input => {
            input.addEventListener("keydown", async (event) => {
                if (event.key === "Enter") {
                    await runAuthAction("login", "Logging in...");
                }
            });
        });
    }
});
