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

- Accounts with opening balances; income, expenses (incl. manually recorded tax), transfers
- Assets with simple/compound appreciation or depreciation, partial sales
- Loans with EMI schedules (reducing-balance interest, auto-paid when due)
- 13 metrics, all calculated as of today: net worth, cash, savings rate, emergency cover, HFRI, …
- HFRI score with its four dimensions (savings, debt, emergency coverage, expense stability), using the published model
- Built-in step-by-step guide

## Code map

```
index.html, landing.css, landing.js   public site
app.html, app.js, style.css           platform UI
modules/engine.js                     all financial calculations (pure, testable)
modules/hfri.js                       HFRI scoring model (matches the official calculator)
modules/site.js                       links and credits used everywhere — edit here
modules/*.js, profiles/, firebase/    Firestore data access and auth
```

Run locally with any static server (e.g. VS Code Live Server) and open `index.html`.

## Credits

Arbor and the HFRI are created by **Vivaan Agarwal**, La Martiniere for Boys, Kolkata.
[LinkedIn](https://www.linkedin.com/in/vivaan-agarwal-65663b39a/) · [GitHub](https://github.com/agarwalvivaan09-ai)

Arbor is an educational tool and does not provide financial advice. HFRI bands are provisional.
