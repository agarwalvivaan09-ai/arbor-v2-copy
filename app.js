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
import { CREATOR, HFRI_SITE, ARBOR, LOGO_SVG } from "./modules/site.js";
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
    window.location.href = "index.html";
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
        <p>Follow the steps in order the first time. Each step tells you exactly which button to press, what to type, and what will change on your dashboard. Buttons marked → open the right form for you, already set to the right entry type.</p>
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
        <div class="guide-table-row"><span>Sidebar</span><strong>Workspace · Switch</strong><p>Shows the workspace you're in. Press Switch to go back to your workspaces and open or create another.</p></div>
        <div class="guide-table-row"><span>Sidebar</span><strong>Overview</strong><p>Net worth, HFRI, all metrics, the cash-flow chart, where your money goes, and recent activity.</p></div>
        <div class="guide-table-row"><span>Sidebar</span><strong>Activity</strong><p>The full ledger, newest first. Filter by type, search, and delete entries with ×.</p></div>
        <div class="guide-table-row"><span>Sidebar</span><strong>Accounts</strong><p>Your balance sheet: cash accounts, assets, liabilities and EMI schedules.</p></div>
        <div class="guide-table-row"><span>Sidebar</span><strong>Resilience</strong><p>Your HFRI score, its four dimensions, the inputs used, and the score bands.</p></div>
        <div class="guide-table-row"><span>Sidebar</span><strong>Guide</strong><p>This manual. Use the buttons at the top to jump to any step.</p></div>
        <div class="guide-table-row"><span>Top right</span><strong>+ Add entry</strong><p>Opens the Add data panel. Everything you record goes through it. Close it with × or by clicking outside.</p></div>
        <div class="guide-table-row"><span>Top right</span><strong>Log out</strong><p>Signs you out and returns to the Arbor home page. Your data stays saved.</p></div>
    </div>
`)}

${section("guide-setup", "Step 1", "Create and open a profile", `
    <p>A profile is a separate workspace. Money in one profile never mixes with another, so use one for Personal, one for Business, and so on.</p>
    ${steps([
        "Press <strong>Switch</strong> next to the workspace name in the sidebar to reach your workspaces. (New users land there right after signing up.)",
        "Under <strong>New workspace</strong>, type a name such as <em>Personal</em>.",
        "Choose <strong>Personal</strong>, <strong>Business</strong> or <strong>Family</strong>, then press <strong>Create workspace</strong>.",
        "Click the workspace card to open it. Arbor creates a starter account called <strong>Main Account</strong> with a ₹0 balance."
    ])}
`)}

${section("guide-accounts", "Step 2", "Add every place your money is kept", `
    <p>An account is a real place that holds money: a bank account, the cash in your wallet, Paytm or another wallet. It is <strong>not</strong> a category like Rent or Food.</p>
    ${steps([
        "Press <strong>+ Add entry</strong> (top right), then the <strong>Account</strong> tab.",
        "Type the account name exactly as you know it, e.g. <em>HDFC Savings</em>.",
        "In <strong>Current Balance</strong>, type what the account holds <strong>today</strong>. Arbor counts forward from this number.",
        "Pick <strong>Cash</strong>, <strong>Bank</strong> or <strong>Wallet</strong>. For Bank, also pick Savings or Current.",
        "Press <strong>Create account</strong>. Repeat for every account you use.",
        "Open the <strong>Accounts</strong> tab and check each balance matches reality."
    ])}
    ${note("The starter Main Account has a ₹0 balance. If you don't need it, delete it with × before recording anything in it. An account with entries can't be deleted, so its history stays correct.")}
    <div class="guide-actions">${tryIt("Add an account", "account")}${goTo("Open Accounts tab", "accounts")}</div>
`)}

${section("guide-daily", "Step 3", "Record income and spending", `
    <p>Record each real event once, on the day it happened. All entries use the same form:</p>
    ${steps([
        "Press <strong>+ Add entry</strong> (top right). The <strong>Activity</strong> tab opens.",
        "Under <strong>What happened?</strong>, choose Income or Expense.",
        "Choose the <strong>Subtype</strong>. For Income: salary, business, interest, dividend or other. For Expense: <em>fixed</em> (rent, EMIs you track as bills, school fees), <em>variable</em> (groceries, fuel, utilities), <em>discretionary</em> (eating out, shopping, travel) or <em>tax</em>.",
        "Type the <strong>Amount</strong> in rupees, numbers only, no commas.",
        "Type a short <strong>Description</strong>. Use the same word every time (always \"Rent\", never \"House rent\").",
        "Pick the <strong>account</strong> the money went into or came out of.",
        "Pick the <strong>date</strong>. If you leave it empty, Arbor uses today.",
        "Press <strong>Save entry</strong>. The dashboard updates immediately."
    ])}
    ${note("Subtypes matter: salary feeds MRR, and fixed and variable expenses count as <strong>essential spending</strong> in your HFRI score. Discretionary spending does not.")}
    <div class="guide-actions">${tryIt("Add income", "activity", "income")}${tryIt("Add an expense", "activity", "expense")}</div>
`)}

${section("guide-transfer", "Step 4", "Move money between your own accounts", `
    ${steps([
        "Press <strong>+ Add entry</strong> and choose <strong>Transfer</strong>.",
        "Type the amount and a description such as <em>ATM withdrawal</em>.",
        "Pick the <strong>From account</strong> (money leaves) and the <strong>To account</strong> (money arrives).",
        "Press <strong>Save entry</strong>."
    ])}
    ${note("A transfer is never income or an expense. Don't record an ATM withdrawal as an expense, or your spending will be counted twice: once at the ATM and again when you spend the cash.")}
    <div class="guide-actions">${tryIt("Add a transfer", "activity", "transfer")}</div>
`)}

${section("guide-assets", "Step 5", "Investments and other assets", `
    <p><strong>Buying</strong>: mutual funds, shares, gold, property, a vehicle.</p>
    ${steps([
        "Press <strong>+ Add entry</strong> and choose <strong>Buy Asset</strong>.",
        "Type the price paid as the Amount and the asset name as the Description (e.g. <em>Nifty 50 Index Fund</em>). The description becomes the asset's name.",
        "Pick the account you paid from, and the purchase date.",
        "Optional: type an expected yearly <strong>Return %</strong> (empty = 5%, 0 is allowed). Choose <strong>Appreciating</strong> for things that grow, <strong>Depreciating</strong> for things like vehicles and electronics. Choose Simple or Compound growth.",
        "Press <strong>Save entry</strong>. Cash goes down and Assets go up by the same amount."
    ])}
    <p><strong>Selling</strong>: choose <strong>Sell Asset</strong>, pick the asset from the drop-down, type the amount you received, and pick the receiving account. A partial sale reduces the asset's value by the amount sold.</p>
    ${note("An asset's value is an estimate from the return % you entered. To bring it in line with the market, sell it in Arbor at today's value, then buy it again at that value.")}
    <div class="guide-actions">${tryIt("Buy an asset", "activity", "asset_buy")}${tryIt("Sell an asset", "activity", "asset_sell")}</div>
`)}

${section("guide-loans", "Step 6", "Loans and EMIs", `
    <p><strong>Taking a loan</strong>: home loan, car loan, personal loan, money borrowed from family.</p>
    ${steps([
        "Press <strong>+ Add entry</strong> and choose <strong>New Loan</strong>.",
        "Type the amount borrowed and a name for the loan (e.g. <em>Car Loan SBI</em>).",
        "Pick the account the money arrived in, and the loan date.",
        "Type the yearly <strong>Interest %</strong> (empty = 8%, 0 is allowed) and choose Simple or Compound.",
        "If you repay in fixed monthly installments, fill in <strong>Tenure (Months)</strong> and <strong>EMI Amount</strong>. Arbor then creates an EMI schedule. Leave both empty for a loan without EMIs.",
        "Press <strong>Save entry</strong>. Cash and Liabilities both go up, so Net Worth doesn't change."
    ])}
    <p><strong>How EMIs work</strong>: the first EMI is due one month after the loan date. Every EMI whose date has arrived is taken from the chosen account and from the loan automatically. Arbor stops when the tenure ends or the loan is fully paid. The Accounts tab shows how many have been paid and the next due date.</p>
    <p><strong>Extra or one-off payments</strong>: choose <strong>Repay Loan</strong>, pick the loan, type the amount, pick the account, then press Save entry.</p>
    ${note("Never record a scheduled EMI with Repay Loan. Arbor already counts it, and it would be paid twice.")}
    <div class="guide-actions">${tryIt("Add a loan", "activity", "liability_add")}${tryIt("Repay a loan", "activity", "liability_payment")}</div>
`)}

${section("guide-tax", "Step 7", "Tax: you record it, Arbor never calculates it", `
    <p>Arbor doesn't estimate tax, because every person's situation is different. When you actually pay tax (TDS on salary, advance tax, property tax, GST you bear), record it yourself:</p>
    ${steps([
        "Press <strong>+ Add entry</strong> and choose <strong>Expense</strong>.",
        "In the subtype drop-down choose <strong>tax</strong>.",
        "Type the amount paid and a description such as <em>Advance tax Q2</em> or <em>TDS – March</em>.",
        "Pick the account it was paid from and the date, then press <strong>Save entry</strong>."
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
        "Add the corrected entry with <strong>+ Add entry</strong>."
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
<section class="card hfri-panel">
    <div class="card-head"><h2>Financial Resilience (HFRI)</h2></div>
    <div class="empty"><strong>Not enough data yet</strong><p>${escapeHTML(hfri?.reason || "Add income and expenses to calculate HFRI.")}</p>
    <button class="btn btn-ghost btn-sm" data-go-view="guide" data-guide-target="guide-hfri">How HFRI works</button></div>
</section>`;
    }

    const { scores, indicators, inputs, band, total, months } = hfri;
    const pct = v => `${(v * 100).toFixed(1)}%`;
    const ec = indicators.ec === Infinity ? "∞" : `${indicators.ec.toFixed(1)} months`;
    const dims = [
        ["Savings Strength", "S", scores.S, `Savings rate ${pct(indicators.sr)}`],
        ["Debt Sustainability", "D", scores.D, `Debt ${pct(indicators.dti)} of income · repayments ${pct(indicators.dsti)}`],
        ["Emergency Coverage", "E", scores.E, `${ec} of essential spending`],
        ["Expense Stability", "X", scores.X, `Spending variation (CV) ${indicators.cv.toFixed(2)}`]
    ];

    return `
<section class="card hfri-panel">
    <div class="hfri-head">
        <div class="ring lg" data-band="${band.key}" style="--v:${total.toFixed(1)}"><strong>${total.toFixed(1)}</strong></div>
        <div>
            <div class="card-label">Household Financial Resilience Index</div>
            <div class="hfri-band band-${band.key}">${escapeHTML(band.label)}</div>
            <p>${escapeHTML(band.text)} Based on your last ${months} month${months === 1 ? "" : "s"} of activity.</p>
        </div>
    </div>
    <div class="hfri-dims">
        ${dims.map(([label, key, score, detail]) => `
        <div class="hfri-dim">
            <div class="hfri-dim-top"><span><em>${key}</em>${label}</span><strong>${score.toFixed(0)}</strong></div>
            <div class="progress"><i style="width:${Math.max(0, Math.min(100, score)).toFixed(1)}%"></i></div>
            <small>${detail}</small>
        </div>`).join("")}
    </div>
    <div class="hfri-inputs">
        <div><span>Disposable income</span><strong>${formatMoney(inputs.income)}/yr</strong></div>
        <div><span>Spending</span><strong>${formatMoney(inputs.spending)}/yr</strong></div>
        <div><span>Debt</span><strong>${formatMoney(inputs.debt)}</strong></div>
        <div><span>Repayments</span><strong>${formatMoney(inputs.debtService)}/yr</strong></div>
        <div><span>Liquid cash</span><strong>${formatMoney(inputs.liquid)}</strong></div>
        <div><span>Essential spend</span><strong>${formatMoney(inputs.essentialMonthly)}/mo</strong></div>
    </div>
    <div class="btn-row">
        <a class="btn btn-primary btn-sm" href="${HFRI_LINKS.calculator}" target="_blank" rel="noopener">Try what-ifs in the HFRI Calculator ↗</a>
        <button class="btn btn-ghost btn-sm" data-go-view="guide" data-guide-target="guide-hfri">How it's calculated</button>
    </div>
</section>`;
}

// ==========================
// PROFILE SCREEN
// ==========================

async function renderProfiles(user) {
    const profiles = await getProfiles(user.uid);

    let selectedType = "personal";

    // drop the dashboard's click handler so it can't act on this screen
    document.body.onclick = null;

    const typeHint = {
        personal: "Your own income, spending, savings and loans.",
        business: "A business or freelance practice, kept separate from personal money.",
        family: "Shared household finances for the whole family."
    };

    document.body.innerHTML = `
    <div class="ws-shell">
        <header class="ws-top">
            <a class="sb-brand dark" href="index.html">${LOGO_SVG}<span><strong>Arbor</strong><small>by Vivaan Agarwal</small></span></a>
            <div class="top-actions">
                <div class="user-chip"><span>${escapeHTML((user.email || "?")[0].toUpperCase())}</span><em>${escapeHTML(user.email)}</em></div>
                <button id="logout" class="btn btn-ghost">Log out</button>
            </div>
        </header>

        <main class="ws-main">
            <div class="ws-intro">
                <div class="eyebrow-sm">Workspaces</div>
                <h1>${profiles.length ? "Choose a workspace" : "Create your first workspace"}</h1>
                <p>Each workspace has its own accounts, ledger, metrics and HFRI score. Keep personal, business and family money apart.</p>
            </div>

            <div class="ws-grid">
                ${profiles.map(p => `
                <button class="ws-card profile-card" data-id="${p.id}">
                    <span class="ws-avatar">${escapeHTML((p.name || "P")[0].toUpperCase())}</span>
                    <span class="ws-name">${escapeHTML(p.name)}</span>
                    <span class="ws-type">${escapeHTML(p.type || "personal")}</span>
                    <span class="ws-open">Open workspace →</span>
                </button>`).join("")}

                <div class="ws-card ws-new">
                    <div class="ws-new-head"><span class="ws-avatar plus">+</span><strong>New workspace</strong></div>
                    <input id="profileName" placeholder="Name, e.g. Personal" aria-label="Workspace name" />
                    <div class="segmented select profile-type-toggle">
                        <button id="personalBtn" class="active">Personal</button>
                        <button id="businessBtn">Business</button>
                        <button id="familyBtn">Family</button>
                    </div>
                    <p class="field-help" id="typeHint">${typeHint.personal}</p>
                    <div id="profileMessage" class="auth-message" role="status"></div>
                    <button id="createProfile" class="btn btn-primary btn-block">Create workspace</button>
                </div>
            </div>
        </main>

        <footer class="app-footer center">
            <span>Arbor ${ARBOR.version} · Designed and built by <a href="${CREATOR.website}" target="_blank" rel="noopener">Vivaan Agarwal</a> · <a href="${HFRI_SITE.calculator}" target="_blank" rel="noopener">HFRI Calculator</a></span>
        </footer>
    </div>
    `;

    // profile type toggle
    ["personal","business","family"].forEach(type => {
        document.getElementById(type+"Btn").onclick = () => {
            selectedType = type;
            document.querySelectorAll(".select button").forEach(b => b.classList.remove("active"));
            document.getElementById(type+"Btn").classList.add("active");
            document.getElementById("typeHint").textContent = typeHint[type];
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
const VIEWS = ["overview", "activity", "accounts", "resilience", "guide"];
let activeView = localStorage.getItem("dashboardView") || "overview";
if (!VIEWS.includes(activeView)) activeView = "overview";

const profiles = await getProfiles(user.uid);
const profile = profiles.find(p => p.id === profileId) || { name: "Workspace", type: "personal" };

const accountNameById = Object.fromEntries(accounts.map(a => [a.id, a.name]));
const todayDate = new Date();

function transactionAccountLabel(t) {
    const from = accountNameById[t.accountId] || "No account";
    if (t.type !== "transfer") return escapeHTML(from);
    return `${escapeHTML(from)} → ${escapeHTML(accountNameById[t.toAccountId] || "No account")}`;
}

function amountClass(type) {
    if (type === "transfer") return "neutral";
    return ["income", "asset_sell", "liability_add"].includes(type) ? "pos" : "neg";
}

function signedAmount(t) {
    const cls = amountClass(t.type);
    const sign = cls === "pos" ? "+" : cls === "neg" ? "−" : "";
    return `${sign}${formatMoney(t.amount)}`;
}

const TYPE_GROUP = {
    income: "income", expense: "expense", transfer: "transfer",
    asset_buy: "invest", asset_sell: "invest",
    liability_add: "loan", liability_payment: "loan"
};

function typeBadge(type) {
    return `<span class="badge badge-${TYPE_GROUP[type] || "other"}">${readableType(type)}</span>`;
}

function shortDate(value) {
    const d = toDate(value);
    return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function ledgerRow(t) {
    const scheduled = toDate(t.date) > todayDate;
    const search = `${t.category || ""} ${t.subtype || ""} ${readableType(t.type)} ${accountNameById[t.accountId] || ""} ${accountNameById[t.toAccountId] || ""}`.toLowerCase();
    return `
    <tr data-group="${TYPE_GROUP[t.type] || "other"}" data-search="${escapeHTML(search)}">
        <td class="nowrap muted">${shortDate(t.date)}${scheduled ? `<span class="badge badge-scheduled">Scheduled</span>` : ""}</td>
        <td><div class="cell-title">${escapeHTML(t.category || "Untitled")}</div>${t.subtype ? `<div class="cell-sub">${escapeHTML(t.subtype)}</div>` : ""}</td>
        <td>${typeBadge(t.type)}</td>
        <td class="muted">${transactionAccountLabel(t)}</td>
        <td class="num ${amountClass(t.type)}">${signedAmount(t)}</td>
        <td class="actions"><button class="row-delete delete" data-id="${t.id}" title="Delete entry" aria-label="Delete entry">×</button></td>
    </tr>`;
}

const ledgerTable = rows => rows.length ? `
    <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${rows.map(ledgerRow).join("")}</tbody>
    </table></div>`
    : emptyState("No entries yet", "Record income, spending, transfers, investments or loans to start your ledger.", `<button class="btn btn-primary btn-sm" data-open-panel="activity">Add your first entry</button>`);

function emptyState(title, text, action = "") {
    return `<div class="empty"><strong>${title}</strong><p>${text}</p>${action}</div>`;
}

const accountCards = accounts.map(a => {
    const balance = accountBalances[a.id] || 0;
    const count = allTransactions.filter(t => t.accountId === a.id || t.toAccountId === a.id).length;
    const sub = a.type === "bank" && a.subtype ? `${readableType(a.type)} · ${a.subtype}` : readableType(a.type);
    return `
    <div class="acct-card">
        <div class="acct-top">
            <span class="acct-icon">${escapeHTML((a.name || "?")[0].toUpperCase())}</span>
            <button class="row-delete delete-account" data-id="${a.id}" title="Delete account" aria-label="Delete account">×</button>
        </div>
        <div class="acct-name">${escapeHTML(a.name)}</div>
        <div class="acct-sub">${escapeHTML(sub)}${a.rate ? ` · ${escapeHTML(a.rate)}%` : ""}</div>
        <div class="acct-balance ${balance < 0 ? "neg" : ""}">${formatMoney(balance)}</div>
        <div class="acct-meta">Opening ${formatMoney(a.openingBalance || 0)} · ${count} ${count === 1 ? "entry" : "entries"}</div>
    </div>`;
}).join("");

const accountList = accounts.map(a => {
    const balance = accountBalances[a.id] || 0;
    return `<div class="mini-row"><span class="acct-icon sm">${escapeHTML((a.name || "?")[0].toUpperCase())}</span><div><div class="cell-title">${escapeHTML(a.name)}</div><div class="cell-sub">${escapeHTML(readableType(a.type))}</div></div><strong class="${balance < 0 ? "neg" : ""}">${formatMoney(balance)}</strong></div>`;
}).join("");

const assetTable = assets.length ? `
    <div class="table-wrap"><table class="table">
        <thead><tr><th>Asset</th><th>Growth</th><th>Since</th><th class="num">Current value</th><th></th></tr></thead>
        <tbody>${assets.map(a => `
        <tr>
            <td><div class="cell-title">${escapeHTML(a.name)}</div><div class="cell-sub">${escapeHTML(readableType(a.type))}</div></td>
            <td class="muted">${escapeHTML(a.rate ?? 5)}% ${escapeHTML(a.compounding || "simple")}</td>
            <td class="muted nowrap">${shortDate(a.startDate)}${toDate(a.startDate) > todayDate ? `<span class="badge badge-scheduled">Starts later</span>` : ""}</td>
            <td class="num">${formatMoney(getAssetCurrentValue(a))}</td>
            <td class="actions"><button class="row-delete delete-asset" data-id="${a.id}" title="Delete asset" aria-label="Delete asset">×</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`
    : emptyState("No assets yet", "Use Buy Asset when you purchase an investment or something of value.", `<button class="btn btn-ghost btn-sm" data-open-panel="activity" data-txn-type="asset_buy">Buy an asset</button>`);

const liabilityTable = liabilities.length ? `
    <div class="table-wrap"><table class="table">
        <thead><tr><th>Loan</th><th>Interest</th><th>Borrowed</th><th class="num">Outstanding</th><th></th></tr></thead>
        <tbody>${liabilities.map(l => `
        <tr>
            <td><div class="cell-title">${escapeHTML(l.name)}</div><div class="cell-sub">${shortDate(l.startDate)}</div></td>
            <td class="muted">${escapeHTML(l.rate ?? 8)}% ${escapeHTML(l.type || "simple")}</td>
            <td class="muted">${formatMoney(l.value)}</td>
            <td class="num neg">${formatMoney(getLiabilityOutstanding(l))}</td>
            <td class="actions"><button class="row-delete delete-liability" data-id="${l.id}" title="Delete liability" aria-label="Delete liability">×</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`
    : emptyState("No loans", "Use New Loan when money is borrowed. Add a tenure and EMI to schedule repayments.", `<button class="btn btn-ghost btn-sm" data-open-panel="activity" data-txn-type="liability_add">Add a loan</button>`);

function emiCells(e) {
    const info = metrics.emiStatus[e.id] || {};
    const paid = info.paidCount || 0;
    const total = info.tenure;
    const pct = total ? Math.min(100, (paid / total) * 100) : 0;
    const next = info.completed ? `<span class="badge badge-income">Completed</span>` : shortDate(info.nextDue || e.firstDate || e.nextDate);
    return `
        <td><div class="cell-title">${escapeHTML(e.name || "EMI")}</div><div class="cell-sub">${accountNameById[e.accountId] ? `from ${escapeHTML(accountNameById[e.accountId])}` : "account missing"}</div></td>
        <td class="num">${formatMoney(e.amount)}</td>
        <td><div class="progress"><i style="width:${pct.toFixed(0)}%"></i></div><div class="cell-sub">${paid}${total ? ` of ${total}` : ""} paid</div></td>
        <td class="nowrap">${next}</td>`;
}

const emiTable = state.emis.length ? `
    <div class="table-wrap"><table class="table">
        <thead><tr><th>Schedule</th><th class="num">EMI</th><th>Progress</th><th>Next due</th><th></th></tr></thead>
        <tbody>${state.emis.map(e => `<tr>${emiCells(e)}<td class="actions"><button class="row-delete delete-emi" data-id="${e.id}" title="Delete EMI" aria-label="Delete EMI">×</button></td></tr>`).join("")}</tbody>
    </table></div>`
    : emptyState("No EMI schedules", "Add a tenure and EMI amount when you create a loan, and Arbor pays it every month automatically.");

// ---------- charts ----------
function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

function cashFlowChart(series) {
    const max = Math.max(1, ...series.flatMap(s => [s.income, s.spending]));
    const W = 560, H = 200, padB = 26, padT = 10, colW = W / series.length, barW = Math.min(22, colW / 3.2);
    const y = v => padT + (H - padB - padT) * (1 - v / max);
    const grid = [0.25, 0.5, 0.75, 1].map(f => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/>`).join("");
    const bars = series.map((s, i) => {
        const cx = colW * i + colW / 2;
        return `
        <rect x="${cx - barW - 2}" y="${y(s.income)}" width="${barW}" height="${H - padB - y(s.income)}" rx="3" class="bar-in"><title>${monthLabel(s.month)} income ${formatMoney(s.income)}</title></rect>
        <rect x="${cx + 2}" y="${y(s.spending)}" width="${barW}" height="${H - padB - y(s.spending)}" rx="3" class="bar-out"><title>${monthLabel(s.month)} spending ${formatMoney(s.spending)}</title></rect>
        <text x="${cx}" y="${H - 6}" text-anchor="middle" class="axis">${monthLabel(s.month)}</text>`;
    }).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and spending for the last six months">${grid}${bars}</svg>`;
}

function categoryBars(list) {
    if (!list.length) return emptyState("No spending yet", "Your largest spending categories will appear here.");
    const max = list[0].total || 1;
    return `<div class="cat-list">${list.map(c => `
        <div class="cat-row">
            <div class="cat-head"><span>${escapeHTML(c.label)}</span><strong>${formatMoney(c.total)}</strong></div>
            <div class="progress"><i style="width:${((c.total / max) * 100).toFixed(1)}%"></i></div>
        </div>`).join("")}</div>`;
}

const totalAssets = metrics.totalAssets;
const totalLiabilities = metrics.totalLiabilities;
const compTotal = Math.max(1, Math.max(0, totalCash) + totalAssets + totalLiabilities);
const compPct = v => ((Math.max(0, v) / compTotal) * 100).toFixed(1);

const hour = new Date().getHours();
const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

const kpi = (label, value, hint, cls = "") => `
    <div class="kpi ${cls}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}</div>
        <div class="kpi-hint">${hint}</div>
    </div>`;

const hfriRing = hfri.available
    ? `<div class="ring" data-band="${hfri.band.key}" style="--v:${hfri.total.toFixed(1)}"><strong>${hfri.total.toFixed(1)}</strong></div>`
    : `<div class="ring" style="--v:0"><strong>—</strong></div>`;

const NAV = [
    ["overview", "Overview", "M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"],
    ["activity", "Activity", "M4 6h16M4 12h16M4 18h10"],
    ["accounts", "Accounts", "M3 10h18M5 10V20m4-10v10m6-10v10m4-10v10M2 20h20M12 3l9 5H3z"],
    ["resilience", "Resilience", "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"],
    ["guide", "Guide", "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16"]
];
const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const VIEW_META = {
    overview: [`${greeting}`, `${escapeHTML(profile.name)} · ${todayDate.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}`],
    activity: ["Activity", "Every entry in this workspace, newest first."],
    accounts: ["Accounts & balance sheet", "Where your cash lives, what you own and what you owe."],
    resilience: ["Financial resilience", "Your Household Financial Resilience Index (HFRI), by Vivaan Agarwal."],
    guide: ["Guide", "Step-by-step instructions for every screen and every entry."]
};

const views = {
overview: `
<div class="hero-grid">
    <section class="card networth">
        <div class="card-label">Net worth</div>
        <div class="networth-value ${netWorth < 0 ? "neg" : ""}">${formatMoney(netWorth)}</div>
        <div class="comp-bar" aria-hidden="true">
            <i class="c-cash" style="width:${compPct(totalCash)}%"></i><i class="c-assets" style="width:${compPct(totalAssets)}%"></i><i class="c-debt" style="width:${compPct(totalLiabilities)}%"></i>
        </div>
        <div class="comp-legend">
            <div><span class="dot c-cash"></span>Cash<strong>${formatMoney(totalCash)}</strong></div>
            <div><span class="dot c-assets"></span>Assets<strong>${formatMoney(totalAssets)}</strong></div>
            <div><span class="dot c-debt"></span>Liabilities<strong>${formatMoney(totalLiabilities)}</strong></div>
        </div>
    </section>
    <section class="card hfri-card">
        ${hfriRing}
        <div>
            <div class="card-label">HFRI · Financial resilience</div>
            <div class="hfri-card-band ${hfri.available ? `band-${hfri.band.key}` : ""}">${hfri.available ? escapeHTML(hfri.band.label) : "Not enough data"}</div>
            <p>${hfri.available ? escapeHTML(hfri.band.text) : escapeHTML(hfri.reason)}</p>
            <button class="btn btn-ghost btn-sm" data-go-view="resilience">View breakdown →</button>
        </div>
    </section>
</div>

<div class="kpi-grid">
    ${kpi("Income", formatMoney(income), "Money earned into your accounts")}
    ${kpi("Expense", formatMoney(expense), "Spending, repayments and EMIs")}
    ${kpi("Total cash", formatMoney(totalCash), "Across all accounts", totalCash < 0 ? "neg" : "")}
    ${kpi("Savings rate", `${(savingsRate * 100).toFixed(1)}%`, "Income kept after expenses", savingsRate < 0 ? "neg" : "")}
    ${kpi("Emergency cover", `${emergencyCoverage.toFixed(1)} mo`, "Months of spending cash covers")}
    ${kpi("Status", escapeHTML(status), "From your savings rate", `status-${status.toLowerCase()}`)}
    ${kpi("Monthly flow", formatMoney(lastMonthFlow), "Latest month: income − spending", lastMonthFlow < 0 ? "neg" : "pos")}
    ${kpi("3M avg expense", formatMoney(avgExpense), "Average recent monthly spend")}
    ${kpi("Top spend", escapeHTML(topCategory), "Largest spending category")}
    ${kpi("Avg transaction", formatMoney(avgTransaction), "Typical outgoing payment")}
    ${kpi("MRR", formatMoney(MRR), "Average monthly salary")}
</div>

<div class="grid-2-1">
    <section class="card">
        <div class="card-head"><h2>Cash flow</h2><div class="legend"><span><i class="bar-in"></i>Income</span><span><i class="bar-out"></i>Spending</span></div></div>
        ${cashFlowChart(metrics.monthlySeries)}
    </section>
    <section class="card">
        <div class="card-head"><h2>Where money goes</h2></div>
        ${categoryBars(metrics.categoryBreakdown)}
    </section>
</div>

<div class="grid-1-2">
    <section class="card">
        <div class="card-head"><h2>Accounts</h2><button class="link" data-go-view="accounts">View all</button></div>
        <div class="mini-list">${accountList}</div>
    </section>
    <section class="card">
        <div class="card-head"><h2>Recent activity</h2><button class="link" data-go-view="activity">View ledger</button></div>
        ${ledgerTable(transactions.slice(0, 6))}
    </section>
</div>`,

activity: `
<section class="card">
    <div class="toolbar">
        <div class="chips" role="tablist" aria-label="Filter entries">
            <button class="chip active" data-filter="all">All</button>
            <button class="chip" data-filter="income">Income</button>
            <button class="chip" data-filter="expense">Expenses</button>
            <button class="chip" data-filter="transfer">Transfers</button>
            <button class="chip" data-filter="invest">Investments</button>
            <button class="chip" data-filter="loan">Loans</button>
        </div>
        <input class="search" id="ledgerSearch" type="search" placeholder="Search descriptions, accounts…" aria-label="Search entries">
    </div>
    ${ledgerTable(transactions)}
    <div class="empty filtered-empty" hidden><strong>No matching entries</strong><p>Try another filter or search term.</p></div>
</section>`,

accounts: `
<div class="summary-strip">
    <div><span>Cash</span><strong>${formatMoney(totalCash)}</strong></div>
    <div><span>Assets</span><strong>${formatMoney(totalAssets)}</strong></div>
    <div><span>Liabilities</span><strong class="neg">${formatMoney(totalLiabilities)}</strong></div>
    <div><span>Net worth</span><strong>${formatMoney(netWorth)}</strong></div>
</div>
<section class="card">
    <div class="card-head"><h2>Cash accounts</h2><button class="btn btn-ghost btn-sm" data-open-panel="account">+ Add account</button></div>
    <div class="acct-grid">${accountCards}</div>
</section>
<div class="grid-2">
    <section class="card"><div class="card-head"><h2>Assets</h2></div>${assetTable}</section>
    <section class="card"><div class="card-head"><h2>Liabilities</h2></div>${liabilityTable}</section>
</div>
<section class="card"><div class="card-head"><h2>EMI schedules</h2></div>${emiTable}</section>`,

resilience: `
${renderHFRIPanel(hfri)}
<div class="grid-2">
    <section class="card prose-card">
        <div class="card-head"><h2>What HFRI measures</h2></div>
        <p>The Household Financial Resilience Index scores how well a household could absorb a financial shock while still meeting essential obligations. It combines four equally weighted dimensions, each scored 0–100 with calibrated functions from Vivaan Agarwal's research.</p>
        <div class="formula">HFRI = 0.25·S + 0.25·D + 0.25·E + 0.25·X</div>
        <ul class="dim-list">
            <li><strong>Savings Strength</strong> · savings rate (income − spending) ÷ income</li>
            <li><strong>Debt Sustainability</strong> · 40% debt-to-income + 60% repayments-to-income</li>
            <li><strong>Emergency Coverage</strong> · liquid cash ÷ monthly essential spending</li>
            <li><strong>Expense Stability</strong> · variation of monthly spending (CV)</li>
        </ul>
    </section>
    <section class="card prose-card">
        <div class="card-head"><h2>Score bands</h2></div>
        <div class="band-scale">
            <div class="band-very-low"><strong>&lt; 60</strong><span>Very low</span></div>
            <div class="band-low"><strong>60–65</strong><span>Low</span></div>
            <div class="band-transition"><strong>65–70</strong><span>Transition</span></div>
            <div class="band-high"><strong>70–75</strong><span>High</span></div>
            <div class="band-very-high"><strong>75+</strong><span>Very high</span></div>
        </div>
        <p class="small muted">Bands are provisional. They come from the paper's 1,000-household simulation, where shock survival rose sharply around 65–70.</p>
        <div class="btn-row">
            <a class="btn btn-primary btn-sm" href="${HFRI_SITE.calculator}" target="_blank" rel="noopener">HFRI calculator ↗</a>
            <a class="btn btn-ghost btn-sm" href="${HFRI_SITE.research}" target="_blank" rel="noopener">Read the research ↗</a>
            <button class="btn btn-ghost btn-sm" data-go-view="guide" data-guide-target="guide-hfri">How Arbor calculates it</button>
        </div>
    </section>
</div>`,

guide: renderGuideContent()
};

document.body.innerHTML = `
<div class="shell">
    <aside class="sidebar">
        <a class="sb-brand" href="index.html" title="Arbor home">${LOGO_SVG}<span><strong>Arbor</strong><small>by Vivaan Agarwal</small></span></a>

        <div class="sb-profile">
            <span class="sb-avatar">${escapeHTML((profile.name || "W")[0].toUpperCase())}</span>
            <div><strong>${escapeHTML(profile.name)}</strong><small>${escapeHTML(profile.type || "personal")} workspace</small></div>
            <button id="backBtn" class="sb-switch" title="Switch workspace">Switch</button>
        </div>

        <nav class="sb-nav" aria-label="Dashboard">
            ${NAV.map(([key, label, d]) => `<button class="view-tab ${activeView === key ? "active" : ""}" data-view="${key}">${icon(d)}<span>${label}</span></button>`).join("")}
        </nav>

        <div class="sb-foot">
            <a href="${HFRI_SITE.calculator}" target="_blank" rel="noopener">HFRI Calculator ↗</a>
            <a href="index.html">Arbor home</a>
            <div class="credit">
                <small>Designed &amp; built by</small>
                <a href="${CREATOR.website}" target="_blank" rel="noopener">Vivaan Agarwal ↗</a>
            </div>
        </div>
    </aside>

    <div class="main">
        <header class="topbar">
            <div class="page-title">
                <h1>${VIEW_META[activeView][0]}</h1>
                <p>${VIEW_META[activeView][1]}</p>
            </div>
            <div class="top-actions">
                <button id="togglePanel" class="btn btn-primary" data-open-panel="activity">+ Add entry</button>
                <div class="user-chip" title="${escapeHTML(user.email)}"><span>${escapeHTML((user.email || "?")[0].toUpperCase())}</span><em>${escapeHTML(user.email)}</em></div>
                <button id="logout" class="btn btn-ghost">Log out</button>
            </div>
        </header>

        <main class="content view-${activeView}">
            ${views[activeView]}
        </main>

        <footer class="app-footer">
            <span>Arbor ${ARBOR.version} · Designed and built by <a href="${CREATOR.website}" target="_blank" rel="noopener">Vivaan Agarwal</a></span>
            <span><a href="${HFRI_SITE.research}" target="_blank" rel="noopener">HFRI research</a> · <a href="${CREATOR.linkedin}" target="_blank" rel="noopener">LinkedIn</a> · <a href="${CREATOR.github}" target="_blank" rel="noopener">GitHub</a></span>
        </footer>
    </div>
</div>

<div class="overlay" id="overlay"></div>

<aside class="side drawer" aria-label="Add data">
    <div class="panel-head">
        <div>
            <h2>Add data</h2>
            <p>Record one real-world event at a time.</p>
        </div>
        <button id="closePanel" class="icon-btn" title="Close" aria-label="Close">×</button>
    </div>

    <div class="panel-tabs">
        <button class="panel-tab active" data-panel="activity">Activity</button>
        <button class="panel-tab" data-panel="account">Account</button>
    </div>

    <div class="panel-section active" data-panel-section="activity">
        <div class="field-label">What happened?</div>
        <div class="segmented type-grid" id="txnTypeToggle">
            <button data-value="income" class="active">Income</button>
            <button data-value="expense">Expense</button>
            <button data-value="transfer">Transfer</button>
            <button data-value="asset_buy">Buy asset</button>
            <button data-value="asset_sell">Sell asset</button>
            <button data-value="liability_add">New loan</button>
            <button data-value="liability_payment">Repay loan</button>
        </div>

        <label class="field">Subtype<select id="txnSubType"></select></label>
        <label class="field">Amount (₹)<input id="amount" inputmode="decimal" placeholder="0" /></label>
        <label class="field">Description<input id="category" placeholder="e.g. Rent, Salary, Nifty Fund" /></label>
        <label class="field">Account<select id="accountSelect"></select></label>
        <label class="field" data-show-for="transfer">To account<select id="toAccountSelect"></select></label>
        <label class="field" data-show-for="asset_sell">Asset<select id="assetSelect"></select></label>
        <label class="field" data-show-for="liability_payment">Loan<select id="liabilitySelect"></select></label>
        <label class="field">Date<input id="date" type="date" /></label>

        <div id="assetFields" class="sub-form hidden">
            <div class="field-label">Growth assumptions</div>
            <div class="field-row">
                <label class="field">Return % / yr<input id="assetRate" inputmode="decimal" placeholder="5" /></label>
                <label class="field">Direction<select id="assetDirection"><option value="appreciating">Appreciating</option><option value="depreciating">Depreciating</option></select></label>
            </div>
            <label class="field">Growth<select id="assetCompounding"><option value="simple">Simple</option><option value="compound">Compound</option></select></label>
        </div>

        <div id="liabilityFields" class="sub-form hidden">
            <div class="field-label">Loan details</div>
            <div class="field-row">
                <label class="field">Interest % / yr<input id="liabilityRate" inputmode="decimal" placeholder="8" /></label>
                <label class="field">Interest type<select id="liabilityCompounding"><option value="simple">Simple</option><option value="compound">Compound</option></select></label>
            </div>
            <div class="field-row">
                <label class="field">Tenure (months)<input id="emiTenure" inputmode="numeric" placeholder="Optional" /></label>
                <label class="field">EMI amount<input id="emiAmount" inputmode="decimal" placeholder="Optional" /></label>
            </div>
            <p class="field-help">Fill both to create an EMI schedule. The first EMI is due one month after the loan date.</p>
        </div>

        <button id="addTxn" class="btn btn-primary btn-block">Save entry</button>
    </div>

    <div class="panel-section" data-panel-section="account">
        <p class="field-help">Accounts are real places where money is kept: a bank account, cash, a wallet.</p>
        <label class="field">Account name<input id="accName" placeholder="e.g. HDFC Savings, Cash, Paytm" /></label>
        <label class="field">Current balance (₹)<input id="accOpeningBalance" inputmode="decimal" placeholder="0" /></label>
        <div class="field-label">Type</div>
        <div class="segmented" id="accTypeToggle">
            <button data-value="cash" class="active">Cash</button>
            <button data-value="bank">Bank</button>
            <button data-value="wallet">Wallet</button>
        </div>
        <div id="bankDetails" class="sub-form hidden">
            <div class="field-label">Bank account type</div>
            <div class="segmented" id="accSubTypeToggle">
                <button data-value="savings" class="active">Savings</button>
                <button data-value="current">Current</button>
            </div>
            <label class="field">Interest % (optional)<input id="accRate" inputmode="decimal" placeholder="0" /></label>
        </div>
        <button id="addAccount" class="btn btn-primary btn-block">Create account</button>
    </div>
</aside>
`;

// ---------- ledger filter + search (no re-render needed) ----------
const ledgerSearch = document.getElementById("ledgerSearch");
let ledgerFilter = "all";
function applyLedgerFilter() {
    const q = (ledgerSearch?.value || "").trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".view-activity tbody tr").forEach(row => {
        const ok = (ledgerFilter === "all" || row.dataset.group === ledgerFilter) && (!q || row.dataset.search.includes(q));
        row.hidden = !ok;
        if (ok) shown++;
    });
    const empty = document.querySelector(".filtered-empty");
    if (empty) empty.hidden = shown > 0 || !document.querySelector(".view-activity tbody tr");
}
ledgerSearch?.addEventListener("input", applyLedgerFilter);
document.querySelectorAll(".chip[data-filter]").forEach(chip => {
    chip.onclick = () => {
        ledgerFilter = chip.dataset.filter;
        document.querySelectorAll(".chip[data-filter]").forEach(c => c.classList.toggle("active", c === chip));
        applyLedgerFilter();
    };
});

// jump to a guide section requested from another view
const pendingGuide = sessionStorage.getItem("guideTarget");
if (activeView === "guide" && pendingGuide) {
    sessionStorage.removeItem("guideTarget");
    requestAnimationFrame(() => document.getElementById(pendingGuide)?.scrollIntoView({ block: "start" }));
}

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

    document.querySelectorAll("[data-show-for]").forEach(field => {
        field.hidden = field.dataset.showFor !== type;
    });

    txnSubTypeEl.innerHTML = (subtypeMap[type] || [])
        .map(s => `<option value="${s}">${s}</option>`)
        .join("");
    txnSubTypeEl.closest("label").hidden = type === "transfer";
    accountSelect.closest("label").firstChild.textContent = type === "transfer" ? "From account" : "Account";

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
        if (goView.dataset.guideTarget) sessionStorage.setItem("guideTarget", goView.dataset.guideTarget);
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

    const viewTab = target.closest(".view-tab");
    if (viewTab) {
        localStorage.setItem("dashboardView", viewTab.dataset.view);
        await renderDashboard(user, profileId);
        window.scrollTo({ top: 0 });
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
        let authMode = new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";

        document.body.innerHTML = `
        <div class="auth-shell">
            <section class="auth-brand">
                <a class="sb-brand" href="index.html">${LOGO_SVG}<span><strong>Arbor</strong><small>by Vivaan Agarwal</small></span></a>
                <div class="auth-pitch">
                    <h1>Understand your financial position, <em>not just your transactions.</em></h1>
                    <ul>
                        <li>Accounts, ledger, assets, loans and EMIs in one workspace</li>
                        <li>Net worth and 13 live metrics, calculated as of today</li>
                        <li>Resilience scored with the HFRI research model</li>
                    </ul>
                </div>
                <div class="auth-credit">
                    <span>Designed &amp; built by</span>
                    <a href="${CREATOR.website}" target="_blank" rel="noopener">Vivaan Agarwal ↗</a>
                </div>
            </section>

            <section class="auth-panel">
                <a class="auth-back" href="index.html">← Back to Arbor home</a>
                <div class="auth-card">
                    <div class="auth-tabs" role="tablist">
                        <button class="auth-tab" data-mode="login" role="tab">Log in</button>
                        <button class="auth-tab" data-mode="signup" role="tab">Create account</button>
                    </div>
                    <h2 id="authTitle"></h2>
                    <p id="authSub" class="muted"></p>

                    <label class="field">Email<input id="email" type="email" autocomplete="email" placeholder="you@example.com" /></label>
                    <label class="field">Password<input id="password" type="password" autocomplete="current-password" placeholder="At least 6 characters" /></label>
                    <div id="authMessage" class="auth-message" role="status"></div>

                    <button id="login" class="btn btn-primary btn-block">Log in</button>
                    <button id="signup" class="btn btn-primary btn-block">Create account</button>
                    <button id="reset" class="btn-link">Forgot your password?</button>
                </div>
                <p class="auth-foot">Arbor is an educational tool and does not provide financial advice. HFRI by <a href="${HFRI_SITE.research}" target="_blank" rel="noopener">Vivaan Agarwal</a>.</p>
            </section>
        </div>
        `;

        function setAuthMode(mode) {
            authMode = mode;
            document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.mode === mode));
            document.getElementById("login").hidden = mode !== "login";
            document.getElementById("reset").hidden = mode !== "login";
            document.getElementById("signup").hidden = mode !== "signup";
            document.getElementById("authTitle").textContent = mode === "login" ? "Welcome back" : "Create your workspace";
            document.getElementById("authSub").textContent = mode === "login"
                ? "Log in to open your Arbor dashboard."
                : "Free to use. No bank login needed.";
            document.getElementById("password").autocomplete = mode === "login" ? "current-password" : "new-password";
            document.getElementById("authMessage").textContent = "";
            document.getElementById("authMessage").className = "auth-message";
        }

        document.querySelectorAll(".auth-tab").forEach(t => { t.onclick = () => setAuthMode(t.dataset.mode); });
        setAuthMode(authMode);

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
                    if (authMode === "signup") await runAuthAction("signup", "Creating account...");
                    else await runAuthAction("login", "Logging in...");
                }
            });
        });
    }
});
