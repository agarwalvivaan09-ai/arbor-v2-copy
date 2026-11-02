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
    const guideSections = [
        {
            title: "1. What Arbor Tracks",
            body: [
                "Arbor separates your financial life into accounts, activity, assets, liabilities, and EMI schedules. Accounts are the places where cash sits. Activity is everything that changes those balances. Assets and liabilities explain what you own and what you owe, so the dashboard can calculate net worth instead of only showing cash.",
                "A profile is a separate workspace. Use different profiles when the money should not mix, such as Personal, Business, Family, Studio, or Startup."
            ]
        },
        {
            title: "2. Accounts Are Real Cash Locations",
            body: [
                "Create an account for each real place where money is held: a bank account, cash wallet, UPI wallet, credit operating account, or business current account. The opening balance should be the balance on the day you start tracking.",
                "Do not create accounts for categories like rent, food, marketing, payroll, or school fees. Those are transaction descriptions/categories, not cash locations."
            ]
        },
        {
            title: "3. Income",
            body: [
                "Use Income when money enters an account and does not create a new debt. Salary, business revenue, interest, dividends, refunds, and gifts can all be income depending on your use case.",
                "Income increases the selected account balance and contributes to Income, Savings, Monthly Flow, MRR when subtype is salary, and overall cash health."
            ]
        },
        {
            title: "4. Expenses",
            body: [
                "Use Expense when money leaves an account for spending. Examples include rent, groceries, subscriptions, fuel, payroll, vendors, travel, or discretionary purchases.",
                "Expenses reduce the selected account balance. They also feed Expense, Savings, Emergency Coverage, Top Spend, 3M Avg Expense, Avg Transaction Size, and Monthly Flow."
            ]
        },
        {
            title: "5. Buying Assets",
            body: [
                "Use Buy Asset when you convert cash into something you own: investments, equipment, gold, property, vehicles, inventory, or a valuable item. Arbor records the asset and deducts the purchase amount from the selected account.",
                "This keeps net worth balanced. Cash goes down, assets go up, and net worth changes later through appreciation, depreciation, sale value, or interest assumptions."
            ]
        },
        {
            title: "6. Selling Assets",
            body: [
                "Use Sell Asset when money comes back from an asset. Select the asset being sold and the account receiving the money.",
                "The sale increases cash and reduces the tracked asset value by the sale amount. Use clear descriptions so partial exits and full exits remain easy to audit later."
            ]
        },
        {
            title: "7. New Loans",
            body: [
                "Use New Loan when borrowed money enters an account. Arbor increases cash, creates a liability, and can optionally create an EMI schedule.",
                "Do not record borrowed money as normal income. A loan improves cash today but creates an obligation, so it must appear as a liability for net worth to stay correct."
            ]
        },
        {
            title: "8. Loan Payments And EMIs",
            body: [
                "Use Repay Loan when you manually pay a liability. Select the loan, enter the payment amount, and Arbor reduces cash while reducing the outstanding liability.",
                "If you enter a tenure and EMI amount when creating a loan, Arbor creates an EMI schedule. The first EMI falls one month after the loan date, and every month that has arrived is deducted from the selected account and from the loan's outstanding balance automatically. Do not also record those EMIs with Repay Loan, or they will be counted twice. The schedule stops when the tenure ends or the loan is fully repaid."
            ]
        },
        {
            title: "9. Dates Matter",
            body: [
                "The transaction date controls the ledger order, monthly cash flow, recent average expenses, and activity history. Use the real date of the event whenever possible.",
                "Everything is calculated as of today. A transaction, asset, or loan dated in the future is listed but does not change balances or metrics until its date arrives."
            ]
        },
        {
            title: "10. Interest And Growth",
            body: [
                "For assets, the return percentage estimates appreciation or depreciation from the start date. Appreciating assets increase over time; depreciating assets reduce over time.",
                "For liabilities, the interest percentage estimates how the outstanding loan grows. Simple interest grows linearly. Compound interest grows on the accumulated amount. Each repayment stops earning interest from the day it is paid, so the loan reduces the way a real reducing-balance loan does.",
                "A rate of 0% is allowed. Leaving the field empty uses the default (5% for assets, 8% for loans)."
            ]
        },
        {
            title: "11. Transfers Between Accounts",
            body: [
                "Use Transfer when you move your own money from one account to another, such as withdrawing cash from the bank or topping up a wallet. Pick the account money leaves and the account it goes to.",
                "A transfer is not income or an expense. It only moves cash, so Total Cash and Net Worth stay the same."
            ]
        },
        {
            title: "12. Clean Entry Habits",
            body: [
                "Use consistent names. For example, always use Rent instead of sometimes Rent, House Rent, and Flat Payment. Consistency makes Top Spend and expense averages easier to trust.",
                "Add one real-world event at a time. If salary arrives in the bank, add one income. If rent leaves that bank, add one expense. If you invest from that bank, add one buy asset."
            ]
        },
        {
            title: "13. Recommended First Setup",
            body: [
                "Start by creating accounts with current balances. Add this month&apos;s income. Add recurring expenses. Add active assets. Add outstanding loans. Then add any EMI schedules that should continue from now.",
                "After setup, check Total Cash against your real account balances. Then check Assets, Liabilities, and Net Worth. If those match reality, the dashboard is ready for daily use."
            ]
        }
    ];

    const metrics = [
        ["Income", "All income transactions added to accounts. Loans are not counted as income."],
        ["Expense", "Expense transactions plus loan repayments and every EMI installment that has fallen due."],
        ["Total Cash", "All account opening balances plus cash movements from activity up to today."],
        ["Net Worth", "Total Cash plus current asset value minus outstanding liabilities."],
        ["Savings", "Percentage of income left after expenses. Formula: (income - expenses) / income."],
        ["Emergency", "How many months of spending current cash can cover. Formula: total cash / 3M avg expense."],
        ["Status", "A quick savings-rate label: Strong, Stable, or Vulnerable."],
        ["Top Spend", "The expense category with the highest total spending."],
        ["3M Avg Expense", "Average monthly spend across the latest three months that have expenses."],
        ["Avg Transaction Size", "Average outgoing transaction size, including expenses and loan payments."],
        ["Monthly Flow", "Income minus expenses (including EMIs) in the latest month with activity."],
        ["MRR", "Average monthly salary income across months where salary was recorded."]
    ];

    const workflowRows = [
        ["Salary received", "Income", "Select the account that received salary. Use salary subtype."],
        ["Paid rent", "Expense", "Select the account used for payment. Description can be Rent."],
        ["Bought mutual fund", "Buy Asset", "Select the paying account. Add return assumptions if useful."],
        ["Sold investment", "Sell Asset", "Select the asset and receiving account."],
        ["Took a loan", "New Loan", "Select account receiving money. Enter interest and EMI if applicable."],
        ["Paid loan installment", "Repay Loan", "Select the liability so outstanding debt reduces. Skip this for EMIs Arbor already schedules."],
        ["Moved money between accounts", "Transfer", "Pick the from and to accounts. Not income, not expense."]
    ];

    return `
<div class="guide-hero">
    <div>
        <div class="profile-kicker">Operating Manual</div>
        <h2>How to keep Arbor accurate from day one.</h2>
        <p>Read this once before entering real data. The rule is simple: accounts show where cash lives, activity explains what changed, assets show what you own, and liabilities show what you owe.</p>
    </div>
    <div class="guide-checklist">
        <span>Start with accounts</span>
        <span>Record real events</span>
        <span>Review metrics monthly</span>
    </div>
</div>

<div class="guide-grid">
    ${guideSections.map(section => `
    <div class="guide-panel">
        <h2>${section.title}</h2>
        ${section.body.map(paragraph => `<p>${paragraph}</p>`).join("")}
    </div>
    `).join("")}

    <div class="guide-panel guide-wide">
        <h2>Metric Glossary</h2>
        <div class="guide-metric-list">
            ${metrics.map(([label, description]) => `
            <div>
                <strong>${label}</strong>
                <span>${description}</span>
            </div>
            `).join("")}
        </div>
    </div>

    <div class="guide-panel guide-wide">
        <h2>Which Button Should I Use?</h2>
        <div class="guide-table">
            ${workflowRows.map(([event, action, note]) => `
            <div class="guide-table-row">
                <span>${event}</span>
                <strong>${action}</strong>
                <p>${note}</p>
            </div>
            `).join("")}
        </div>
    </div>

    <div class="guide-panel guide-wide">
        <h2>Common Mistakes To Avoid</h2>
        <p>Do not mix profiles if the finances should stay separate. Do not use accounts as categories. Do not add loans as income. Do not repay a loan as a normal expense if you want the liability to reduce. Do not delete accounts with history, because old transactions need that account to keep balances explainable.</p>
        <p>When numbers look wrong, check these in order: account opening balances, transaction dates, selected accounts, linked asset or liability, duplicate entries, and old EMI schedules that are still active.</p>
    </div>
</div>
`;
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
    lastMonthFlow
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
        <h1>First-Time Guide</h1>
        <p>A complete manual for setting up clean data, choosing the right entry type, and trusting every metric.</p>
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
    expense: ["fixed", "variable", "discretionary"],
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

    // PANEL OPEN
    const panelTrigger = target.closest("#togglePanel") || target.closest("#openAddPanel");
    if (panelTrigger) {
        if (panelTrigger.dataset.openPanel) {
            selectPanel(panelTrigger.dataset.openPanel);
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
