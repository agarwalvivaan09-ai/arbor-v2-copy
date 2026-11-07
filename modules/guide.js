// ==========================================================
// GUIDES — one clean layout, two tailored manuals.
//   personalGuide(type)  → Personal and Family workspaces
//   businessGuide()      → Business workspaces (double-entry books)
// Buttons keep the app's existing hooks:
//   data-open-panel / data-txn-type / data-template  open the right form
//   data-go-view                                     switch tab
//   data-guide-jump                                  scroll to a section
// ==========================================================
import { HFRI_SITE } from "./site.js";

// ---------- layout helpers ----------
const steps = items => `<ol class="g-steps">${items.map(i => `<li>${i}</li>`).join("")}</ol>`;
const tip = text => `<p class="g-tip"><strong>Tip</strong>${text}</p>`;
const defs = rows => `<dl class="g-defs">${rows.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join("")}</dl>`;
const more = (summary, body) => `<details class="g-more"><summary>${summary}</summary><div>${body}</div></details>`;
const actions = (...btns) => `<div class="g-actions">${btns.join("")}</div>`;
const openForm = (label, panel, txnType = "") =>
    `<button class="g-btn" data-open-panel="${panel}"${txnType ? ` data-txn-type="${txnType}"` : ""}>${label}</button>`;
const openTemplate = (label, panel, template = "") =>
    `<button class="g-btn" data-open-panel="${panel}"${template ? ` data-template="${template}"` : ""}>${label}</button>`;
const goTo = (label, view) => `<button class="g-btn ghost" data-go-view="${view}">${label}</button>`;
const link = (label, href) => `<a class="g-btn ghost" href="${href}" target="_blank" rel="noopener">${label} ↗</a>`;

function layout({ kicker, title, intro, quick, groups }) {
    let n = 0;
    const numbered = groups.map(g => ({ ...g, sections: g.sections.map(s => ({ ...s, n: ++n })) }));
    const toc = numbered.map(g => `
        <p class="g-toc-group">${g.label}</p>
        <ol>${g.sections.map(s => `<li><button data-guide-jump="${s.id}"><span>${String(s.n).padStart(2, "0")}</span>${s.short || s.title}</button></li>`).join("")}</ol>`).join("");
    const body = numbered.map(g => `
        <h2 class="g-group">${g.label}</h2>
        ${g.sections.map(s => `
        <section class="g-sec" id="${s.id}">
            <h3><span>${String(s.n).padStart(2, "0")}</span>${s.title}</h3>
            ${s.body}
        </section>`).join("")}`).join("");
    return `
<div class="g-wrap">
    <header class="g-head">
        <p class="g-kicker">${kicker}</p>
        <h1>${title}</h1>
        <p class="g-intro">${intro}</p>
        <ol class="g-quick">${quick.map(q => `<li>${q}</li>`).join("")}</ol>
    </header>
    <div class="g-layout">
        <nav class="g-toc" aria-label="Guide contents">${toc}</nav>
        <div class="g-body">${body}</div>
    </div>
</div>`;
}

// ==========================================================
// PERSONAL & FAMILY
// ==========================================================
export function personalGuide(type = "personal") {
    const family = type === "family";
    const who = family ? "your family" : "you";

    return layout({
        kicker: family ? "Family guide" : "Personal guide",
        title: family ? "Run your household’s money in one place." : "Set up once, then five minutes a month.",
        intro: family
            ? "Track the accounts your family shares and each member’s own accounts, see what the household spends, and check how well it could handle a shock."
            : "Record your accounts and money once, keep them current, and Arbor shows your net worth, savings and how well you could handle a financial shock.",
        quick: [
            family ? "Add every family account with today’s balance" : "Add your accounts with today’s balances",
            "Record each real money event once",
            "Check your Overview at the end of each month"
        ],
        groups: [
            {
                label: "Get started",
                sections: [
                    {
                        id: "guide-accounts", short: "Add your accounts", title: "Add every place money is kept",
                        body: `
<p>An account is a real place that holds money: a bank account, cash in a wallet, Paytm or another e-wallet. It is not a category like Rent or Food.</p>
${steps([
    "Press <strong>+ Add entry</strong> (top right), then the <strong>Account</strong> tab.",
    "Type the name as you know it, e.g. <em>HDFC Savings</em>.",
    "In <strong>Current Balance</strong>, type what it holds <strong>today</strong>. Arbor counts forward from this.",
    "Pick Cash, Bank or Wallet (for Bank, also Savings or Current), then press <strong>Create account</strong>.",
    "Repeat for every account, then check the balances on the <strong>Accounts</strong> tab."
])}
${family ? tip("Add each member’s account separately and include their name, e.g. <em>SBI – Riya</em>. Shared accounts can simply be called <em>Joint</em> or <em>Household</em>.") : ""}
${tip("The starter <em>Main Account</em> holds ₹0. If you don’t need it, delete it with × before recording anything in it.")}
${actions(openForm("Add an account", "account"), goTo("Open Accounts", "accounts"))}`
                    },
                    {
                        id: "guide-daily", short: "Income & spending", title: "Record income and spending",
                        body: `
<p>Record each real event once, on the day it happened.</p>
${steps([
    "Press <strong>+ Add entry</strong> and choose <strong>Income</strong> or <strong>Expense</strong>.",
    "Pick a <strong>subtype</strong>. Expenses are <em>fixed</em> (rent, school fees), <em>variable</em> (groceries, fuel, utilities), <em>discretionary</em> (eating out, shopping, travel) or <em>tax</em>.",
    "Type the amount (numbers only) and a short description. Use the same word every time, e.g. always <em>Rent</em>.",
    "Pick the account and the date (empty means today), then press <strong>Save entry</strong>."
])}
${tip(family
    ? "Name who it was for in the description, e.g. <em>School fees – Riya</em>, so the household’s spending is easy to read later."
    : "Fixed and variable expenses count as essential spending in your HFRI score. Discretionary spending doesn’t.")}
${actions(openForm("Add income", "activity", "income"), openForm("Add an expense", "activity", "expense"))}`
                    },
                    {
                        id: "guide-transfer", short: "Transfers", title: "Move money between your own accounts",
                        body: `
${steps([
    "Press <strong>+ Add entry</strong> and choose <strong>Transfer</strong>.",
    "Enter the amount and a description such as <em>ATM withdrawal</em>.",
    "Pick the <strong>From</strong> and <strong>To</strong> accounts, then save."
])}
${tip("A transfer is never income or spending. Recording an ATM withdrawal as an expense would count the money twice.")}
${actions(openForm("Add a transfer", "activity", "transfer"))}`
                    },
                    {
                        id: "guide-assets", short: "Investments", title: "Investments and other assets",
                        body: `
<p><strong>Buying</strong> a fund, shares, gold, property or a vehicle:</p>
${steps([
    "Press <strong>+ Add entry</strong> and choose <strong>Buy Asset</strong>.",
    "Enter the price paid and the asset’s name (the description becomes its name).",
    "Pick the account you paid from and the date. Optionally set a yearly return % (empty means 5%) and whether it appreciates or depreciates.",
    "Save. Cash goes down and assets go up by the same amount."
])}
<p><strong>Selling</strong>: choose <strong>Sell Asset</strong>, pick the asset, enter what you received and the receiving account.</p>
${actions(openForm("Buy an asset", "activity", "asset_buy"), openForm("Sell an asset", "activity", "asset_sell"))}`
                    },
                    {
                        id: "guide-loans", short: "Loans & EMIs", title: "Loans and EMIs",
                        body: `
${steps([
    "Press <strong>+ Add entry</strong> and choose <strong>New Loan</strong>.",
    "Enter the amount borrowed, a name (e.g. <em>Car Loan SBI</em>), the account it arrived in and the date.",
    "Enter the yearly interest % (empty means 8%).",
    "If you repay monthly, fill in <strong>Tenure</strong> and <strong>EMI Amount</strong>. Arbor then pays each EMI automatically on its due date, starting one month after the loan.",
    "Save. Cash and loans both go up, so net worth doesn’t change."
])}
<p>For an extra or one-off payment, use <strong>Repay Loan</strong>.</p>
${tip("Never record a scheduled EMI with Repay Loan. Arbor already counts it, so it would be paid twice.")}
${actions(openForm("Add a loan", "activity", "liability_add"), openForm("Repay a loan", "activity", "liability_payment"))}`
                    },
                    {
                        id: "guide-tax", short: "Tax", title: "Tax: you record it, Arbor never calculates it",
                        body: `
<p>When ${who} actually pay tax (advance tax, property tax, TDS you paid separately), add it as an <strong>Expense</strong> with the subtype <strong>tax</strong>.</p>
${tip("If salary arrives after TDS is deducted, record only the amount received as income. No separate tax entry is needed.")}
${actions(openForm("Record a tax payment", "activity", "expense"))}`
                    }
                ]
            },
            {
                label: "Understand your numbers",
                sections: [
                    {
                        id: "guide-metrics", short: "Your dashboard", title: "Read your dashboard",
                        body: `
<p>The <strong>Overview</strong> shows everything as of today. Entries dated in the future are marked <em>scheduled</em> and count from their date.</p>
${defs([
    ["Net worth", "Cash + the value of assets − what is still owed on loans."],
    ["Savings rate", "The share of income kept after spending."],
    ["Emergency cover", "How many months of spending your cash would cover."],
    ["HFRI", "Your 0–100 financial resilience score (next section)."]
])}
${more("All dashboard numbers explained", defs([
    ["Income", "Every income entry up to today. Loans and asset sales are not income."],
    ["Expense", "Expenses (including tax) + loan repayments + EMIs that have fallen due."],
    ["Total cash", "All account balances: opening balance plus every entry up to today."],
    ["3-month average expense", "Average spending over the latest three months with spending."],
    ["Monthly flow", "Income − spending in the latest month with activity."],
    ["Top spend", "The description with the most money spent."],
    ["Loan payments", "Average monthly EMIs and repayments. Lower relative to income is safer."]
]))}
${actions(goTo("Open Overview", "overview"))}`
                    },
                    {
                        id: "guide-hfri", short: "HFRI score", title: `HFRI: how well ${family ? "your household" : "you"} could handle a shock`,
                        body: `
<p>The Household Financial Resilience Index scores from 0 to 100 how well ${family ? "the household" : "you"} could absorb a job loss, a medical bill or an income cut while still paying for essentials. It combines four equally weighted parts:</p>
${defs([
    ["Savings strength", "Do you spend less than you earn?"],
    ["Debt sustainability", "How heavy are loans and EMIs compared with income?"],
    ["Emergency coverage", "How many months of essential spending could cash cover?"],
    ["Expense stability", "How predictable is spending month to month?"]
])}
<p>A score appears once there is income and at least two months of activity. Roughly: below 60 is very low, 65–70 is the transition zone where extra savings help most, and 75+ is very high.</p>
${more("How Arbor calculates it", defs([
    ["Disposable income", "Income minus tax entries, averaged over your last 12 months."],
    ["Spending", "Expenses except tax. Loan payments and EMIs count as debt instead."],
    ["Debt", "40% debt-to-income + 60% repayments-to-income."],
    ["Liquid savings", "Total cash in all accounts. Investments are not counted."],
    ["Essential spending", "Fixed and variable expenses (all spending if none are tagged)."],
    ["Bands", "Provisional, from a 1,000-household simulation in the research paper."]
]))}
${actions(goTo("Open Resilience", "resilience"), link("HFRI calculator", HFRI_SITE.calculator), link("Research paper", HFRI_SITE.paper))}`
                    },
                    {
                        id: "guide-stress", short: "Stress test", title: "Stress test: what if something goes wrong?",
                        body: `
<p>Starts from ${family ? "the household’s" : "your"} real monthly averages and today’s cash, then applies a shock.</p>
${steps([
    "Open <strong>Stress test</strong> and pick a scenario (job loss, pay cut, medical emergency, market crash…) or enter your own.",
    "See whether cash stays positive, when it would run out, and net worth afterwards.",
    "Compare HFRI today, during and after the shock."
])}
${actions(goTo("Open Stress test", "stress"))}`
                    },
                    {
                        id: "guide-forecast", short: "Forecast", title: "Forecast: the range of possible futures",
                        body: `
<p>Plays out 2,000 possible futures month by month and shows where net worth is likely to end up: the most likely value, a bad case and a good case. Assumptions start from your own entries and can be changed.</p>
${actions(goTo("Open Forecast", "forecast"))}`
                    }
                ]
            },
            {
                label: "Help",
                sections: [
                    {
                        id: "guide-routine", short: "Monthly routine", title: "Your monthly routine",
                        body: steps([
                            "Add any income, spending and transfers you missed.",
                            "Compare each balance on <strong>Accounts</strong> with the bank or wallet app.",
                            "Look at savings, emergency cover and HFRI on <strong>Overview</strong>, and compare with last month."
                        ])
                    },
                    {
                        id: "guide-mistakes", short: "Fixing mistakes", title: "Fixing mistakes",
                        body: `
<p>Entries can’t be edited. Delete the entry with × on the <strong>Activity</strong> tab, then add it again correctly.</p>
${more("Special cases", defs([
    ["Buy Asset", "Deleting it also deletes the asset. Delete any sale of it first."],
    ["New Loan", "Deleting it also deletes the loan and its EMIs. Delete repayments first."],
    ["Accounts", "Only accounts with no entries can be deleted."]
]))}
${actions(goTo("Open Activity", "activity"))}`
                    },
                    {
                        id: "guide-trouble", short: "A number looks wrong", title: "When a number looks wrong",
                        body: steps([
                            "<strong>Opening balance</strong>: was it the balance on the day you started?",
                            "<strong>Date</strong>: a future date (or wrong year) is ignored until then.",
                            "<strong>Account</strong>: was the entry recorded against the right one?",
                            "<strong>Type</strong>: a transfer saved as an expense, or a loan as income?",
                            "<strong>Duplicates</strong>: the same event twice, or an EMI also entered as Repay Loan?"
                        ])
                    }
                ]
            }
        ]
    });
}

// ==========================================================
// BUSINESS
// ==========================================================
export function businessGuide() {
    return layout({
        kicker: "Business guide",
        title: "Proper books, without needing to be an accountant.",
        intro: "Every transaction becomes a balanced journal entry. From it Arbor builds the ledgers, trial balance and final accounts: Trading, Profit &amp; Loss, Balance Sheet and Cash Flow.",
        quick: ["Bring in opening balances", "Record every transaction", "Value closing stock at period end"],
        groups: [
            {
                label: "Get started",
                sections: [
                    {
                        id: "bg-setup", short: "Set up your books", title: "Set up your books",
                        body: `
${steps([
    "Open <strong>Chart of accounts</strong>. A standard Indian set is ready; add each bank account, major customer and supplier.",
    "Choose the <strong>Period</strong> at the top (financial year, April–March).",
    "Press <strong>+ Record transaction</strong> → <em>Opening balance</em> for each account’s balance on the day you start. The other side goes to Capital automatically."
])}
${tip("Brand-new business? Skip opening balances and use <em>Owner adds capital</em> for the money you put in.")}
${actions(openTemplate("Enter an opening balance", "quick", "opening"), goTo("Open Chart of accounts", "accounts"))}`
                    },
                    {
                        id: "bg-daily", short: "Everyday entries", title: "Record everyday transactions",
                        body: `
<p>Press <strong>+ Record transaction</strong> and choose what happened in <em>Quick entry</em>. Arbor picks the debit and credit and shows the entry before you post it.</p>
${defs([
    ["Sales", "Sale (paid now), sale on credit, customer pays, sales return."],
    ["Purchases", "Purchase (paid now), on credit, pay a supplier, purchase return. Only for goods you resell or use in production."],
    ["Expenses", "Pay an expense, or expense due but not yet paid."],
    ["Owner &amp; finance", "Capital, drawings, loan received, loan principal repaid."],
    ["Fixed assets", "Buy an asset, charge depreciation."],
    ["Cash ↔ bank", "Deposits and withdrawals. Neither income nor expense."]
])}
${actions(openTemplate("Record a sale", "quick", "cash_sale"), openTemplate("Pay an expense", "quick", "expense"))}`
                    },
                    {
                        id: "bg-journal", short: "Journal entries", title: "Compound entries: Journal entry",
                        body: `
${steps([
    "Press <strong>+ Record transaction</strong> → <strong>Journal entry</strong>.",
    "On each line pick an account and enter a debit <em>or</em> a credit. Add lines as needed.",
    "Post once total debits equal total credits, with a narration (“Being …”)."
])}
${tip("An EMI of ₹12,000 with ₹2,000 interest: debit Bank Loan ₹10,000 and Interest on Loan ₹2,000, credit Bank ₹12,000.")}
${actions(openTemplate("Open journal entry", "journal"))}`
                    },
                    {
                        id: "bg-close", short: "Period end", title: "At the end of each period",
                        body: `
${steps([
    "Value closing stock (at cost, or market value if lower) in <em>Chart of accounts → Stock valuation</em>.",
    "Charge depreciation on fixed assets.",
    "Record expenses due but unpaid, e.g. March salary paid in April.",
    "Check the <strong>Trial balance</strong> agrees, then open <strong>Final accounts</strong> to print or save."
])}
${tip("No closing entries needed. Arbor carries profit to Capital and this period’s closing stock into the next period.")}
${actions(goTo("Open Final accounts", "statements"))}`
                    }
                ]
            },
            {
                label: "Understand your books",
                sections: [
                    {
                        id: "bg-how", short: "How the books work", title: "How the books work",
                        body: `
${defs([
    ["Journal", "Every transaction in date order, with its debits and credits."],
    ["Ledger", "One page per account with its running balance."],
    ["Trial balance", "Every balance in one list. Debits must equal credits."],
    ["Final accounts", "Gross profit, net profit, financial position and cash flow."]
])}
${more("Debit and credit, in one table", defs([
    ["Assets and expenses", "Increase with a debit, decrease with a credit."],
    ["Liabilities, capital and income", "Increase with a credit, decrease with a debit."],
    ["Drawings", "A debit that reduces capital. Not a business expense."]
]))}`
                    },
                    {
                        id: "bg-reports", short: "Reports", title: "Reading the reports",
                        body: `
${defs([
    ["Trading A/c", "Net sales − cost of goods sold = gross profit."],
    ["Profit &amp; Loss A/c", "Gross profit + other income − indirect expenses = net profit."],
    ["Balance Sheet", "Capital and liabilities equal assets."],
    ["Cash Flow", "Cash from operating, investing and financing activities."],
    ["Current &amp; quick ratio", "Above 1 means short-term assets cover short-term bills."],
    ["Debtor / creditor days", "How fast customers pay you, and you pay suppliers."]
])}
${actions(goTo("Open Final accounts", "statements"))}`
                    },
                    {
                        id: "bg-analysis", short: "Stress test & forecast", title: "Stress test and cash forecast",
                        body: `
<p><strong>Stress test</strong> shows break-even revenue, your margin of safety, and how long cash lasts if sales fall, costs rise or customers pay late.</p>
<p><strong>Cash forecast</strong> simulates 2,000 futures of your bank balance from your own sales history and gives the chance that cash runs out.</p>
${actions(goTo("Open Stress test", "stress"), goTo("Open Cash forecast", "forecast"))}`
                    }
                ]
            },
            {
                label: "Help",
                sections: [
                    {
                        id: "bg-fix", short: "Fixing mistakes", title: "Fixing mistakes",
                        body: `
<p>On <strong>Journal</strong>, press × on the entry. Both sides are removed together, so the books stay balanced. Then post the corrected entry. Accounts with entries can’t be deleted, so no history is lost.</p>
${actions(goTo("Open Journal", "journal"))}`
                    },
                    {
                        id: "bg-rules", short: "Golden rules", title: "The golden rules",
                        body: defs([
                            ["Personal accounts", "Debit the receiver, credit the giver."],
                            ["Real accounts", "Debit what comes in, credit what goes out."],
                            ["Nominal accounts", "Debit expenses and losses, credit incomes and gains."]
                        ])
                    }
                ]
            }
        ]
    });
}

// ==========================================================
// FAMILY (the combined view across people and profiles)
// ==========================================================
export function familyGuide() {
    return layout({
        kicker: "Family guide",
        title: "Everyone’s money, one picture.",
        intro: "A family brings together personal and business profiles from up to four people, plus things the family owns together, and scores the household with one HFRI.",
        quick: ["Link your profiles", "Add what the family owns and owes", "Invite up to 3 people"],
        groups: [
            {
                label: "Get started",
                sections: [
                    {
                        id: "fg-link", short: "Link profiles", title: "Link your profiles",
                        body: `
${steps([
    "Open <strong>Profiles</strong>.",
    "Under <strong>Your profiles</strong>, press <strong>Add to family</strong> next to each personal or business profile you want counted.",
    "Everyone in the family links their own profiles the same way."
])}
${tip("Linking shares a profile’s numbers with the family, read-only. Only its owner can change it, and a profile can be in one family at a time.")}
${actions(goTo("Open Profiles", "profiles"))}`
                    },
                    {
                        id: "fg-items", short: "Family assets", title: "Add what the family owns and owes",
                        body: `
<p>Some things belong to the whole family rather than one profile: the family home, a joint FD, a home loan, school fees. Add them in <strong>Family assets</strong>.</p>
${defs([
    ["Owned together", "Its current value. Tick “counts as cash” for savings you could use quickly."],
    ["Owed together", "The amount still owed. Counts as debt in the family HFRI."],
    ["Payments due", "An amount and a due date, optionally every month. Shown under Payments due."]
])}
${actions(goTo("Open Family assets", "items"))}`
                    },
                    {
                        id: "fg-invite", short: "Invite family", title: "Invite family members",
                        body: `
${steps([
    "The family head opens <strong>Members</strong> and enters the person’s email.",
    "They sign in to Arbor with that email. The invite appears on their workspace screen.",
    "They press <strong>Accept</strong>. Their email must be verified first, so nobody can join using someone else’s address.",
    "Once in, they link their own profiles."
])}
${tip("A family has the head plus up to 3 invited people.")}
${actions(goTo("Open Members", "members"))}`
                    }
                ]
            },
            {
                label: "Understand the numbers",
                sections: [
                    {
                        id: "fg-totals", short: "Family totals", title: "Family totals",
                        body: defs([
                            ["Cash available", "Personal accounts + business cash and bank + family savings that count as cash."],
                            ["Assets", "Investments and property from personal profiles, business assets other than cash, and family-owned items."],
                            ["Liabilities", "Personal loans, business liabilities and family loans."],
                            ["Net worth", "Cash + assets − liabilities."],
                            ["Payments due", "EMIs from personal profiles and family dues, overdue or due in the next 30 days."]
                        ])
                    },
                    {
                        id: "fg-hfri", short: "Family HFRI", title: "The family HFRI",
                        body: `
<p>One score for the whole household. Arbor adds up the personal profiles’ month-by-month income, spending, tax and loan payments, adds family loans to debt and family cash savings to liquid savings, then scores the total with the same research model.</p>
${tip("It isn’t an average of everyone’s scores. A family where one person saves a lot can cover another person’s gaps, and the family score shows that.")}
${more("Why businesses aren’t included", "<p>Business cash belongs to the business, and what owners take home already reaches the household as personal income. Counting both would count the same money twice. Business figures still appear in the family totals.</p>")}
${actions(goTo("Open Overview", "overview"), link("HFRI calculator", HFRI_SITE.calculator))}`
                    }
                ]
            },
            {
                label: "Help",
                sections: [
                    {
                        id: "fg-roles", short: "Who can do what", title: "Who can do what",
                        body: defs([
                            ["Family head", "Invites and removes people, removes any profile or item, renames or deletes the family."],
                            ["Members", "Link and remove their own profiles, add family items, chat, and leave the family."],
                            ["Everyone", "Sees the family totals, every linked profile’s summary and the family HFRI."]
                        ])
                    },
                    {
                        id: "fg-leave", short: "Leaving", title: "Leaving or removing someone",
                        body: `<p>When someone leaves or is removed, their profiles are unlinked first, so the family can no longer see them. Nothing is deleted from anyone’s workspaces.</p>`
                    }
                ]
            }
        ]
    });
}
