# Arbor — the financial operating system

**Designed and built by [Vivaan Agarwal](https://agarwalvivaan09-ai.github.io/vivaan-agarwal-website-3.0/)**

Arbor brings accounts, activity, assets, loans and EMIs into one workspace, and measures how well your finances could withstand a shock using the **Household Financial Resilience Index (HFRI)**, an independent research framework by Vivaan Agarwal.

- Website: https://agarwalvivaan09-ai.github.io/vivaan-agarwal-website-3.0/
- HFRI research: https://agarwalvivaan09-ai.github.io/vivaan-agarwal-website-3.0/research-hfri.html
- HFRI calculator: https://agarwalvivaan09-ai.github.io/HFRI/

## Pages

| File | What it is |
|---|---|
| `index.html` | Public landing page (product, features, HFRI with a live mini-calculator, how it works, creator). **Log in** / **Get started** lead to the app. |
| `app.html` | The platform: login / sign-up → workspaces → dashboard (Overview, Activity, Accounts, Resilience, Guide). |

## Features

**Personal & Family workspaces**
- Accounts, income, expenses (incl. manually recorded tax), transfers
- Assets with growth or depreciation; loans with EMI schedules (reducing balance)
- Net worth, savings rate, emergency cover and the **HFRI** resilience score
- **Stress test**: job loss, pay cut, medical bill, inflation, market crash, or your own shock
- **Forecast**: Monte Carlo simulation of net worth (2,000 futures, seeded and reproducible)

**Business workspaces**: proper double-entry accounting
- Chart of accounts (standard Indian set, extendable), opening balances
- Quick entries for sales, purchases, returns, receipts, payments, expenses, accruals, capital, drawings, loans, fixed assets, depreciation and contra entries; multi-line journal entries
- Journal → Ledger → Trial balance → **Trading A/c, Profit & Loss A/c, Balance Sheet, Cash Flow Statement** (financial year April–March, printable)
- Periodic inventory with closing-stock valuation; profit and stock carried forward between years
- Ratios (margins, current/quick ratio, ROE, debtor/creditor days), break-even stress test, Monte Carlo cash forecast

**Sign-in**: Google or email and password, via Firebase Authentication.

## Tests

```
npm test
```
Covers the personal engine, HFRI (cross-checked against the official calculator when its repo sits next to this one), the accounting engine (a textbook year plus 900 randomised sets of books that must balance), and the simulations (checked against closed-form answers).

## Firebase setup for sign-in methods

In the Firebase console → Authentication → Sign-in method, **Google** and **Email/Password** are enabled. Add `agarwalvivaan09-ai.github.io` under Authentication → Settings → Authorized domains (already done). Apple and phone (SMS) sign-in were removed because they need a paid Apple Developer account and the Blaze billing plan.

## Code map

```
index.html, landing.css, landing.js   public site
app.html, app.js, style.css           platform UI
modules/engine.js                     personal financial calculations (pure, testable)
modules/accounting.js                 double-entry engine: ledgers, trial balance, final accounts
modules/simulate.js                   stress tests and Monte Carlo (seeded RNG)
business.js                           business workspace UI
modules/personal-scenarios.js         personal stress test + forecast UI
modules/hfri.js                       HFRI scoring model (matches the official calculator)
modules/site.js                       links and credits used everywhere — edit here
modules/*.js, profiles/, firebase/    Firestore data access and auth
```

Run locally with any static server (e.g. VS Code Live Server) and open `index.html`.

## Credits

Arbor and the HFRI are created by **Vivaan Agarwal**, La Martiniere for Boys, Kolkata.
[LinkedIn](https://www.linkedin.com/in/vivaan-agarwal-65663b39a/) · [GitHub](https://github.com/agarwalvivaan09-ai)

Arbor is an educational tool and does not provide financial advice. HFRI bands are provisional.
