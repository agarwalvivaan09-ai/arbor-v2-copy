// Textbook check: a trading business's first year, then a second year.
import assert from "node:assert/strict";
import { computeBooks, validateEntry, accountLedger, DEFAULT_CHART, financialYear } from "../modules/accounting.js";

const accounts = DEFAULT_CHART.map(a => ({ ...a, id: a.code }));
const A = Object.fromEntries(accounts.map(a => [a.name, a.id]));
const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
let n = 0;
const J = (date, ...pairs) => ({ id: "e" + (++n), date, lines: pairs.map(([acc, dr, cr]) => ({ accountId: A[acc], debit: dr || 0, credit: cr || 0 })) });

const entries = [
  J("2025-04-01", ["Bank Account", 500000], ["Opening Stock", 50000], ["Capital", 0, 550000]),           // opening
  J("2025-04-05", ["Furniture & Fixtures", 60000], ["Bank Account", 0, 60000]),
  J("2025-04-10", ["Purchases", 300000], ["Creditors (Accounts Payable)", 0, 300000]),
  J("2025-05-02", ["Purchase Returns", 0, 10000], ["Creditors (Accounts Payable)", 10000]),
  J("2025-06-01", ["Debtors (Accounts Receivable)", 400000], ["Sales", 0, 400000]),
  J("2025-06-15", ["Sales Returns", 20000], ["Debtors (Accounts Receivable)", 0, 20000]),
  J("2025-07-01", ["Bank Account", 250000], ["Debtors (Accounts Receivable)", 0, 250000]),
  J("2025-07-10", ["Creditors (Accounts Payable)", 200000], ["Bank Account", 0, 200000]),
  J("2025-08-01", ["Wages", 15000], ["Carriage Inwards", 5000], ["Cash in Hand", 0, 20000]),           // compound entry
  J("2025-08-02", ["Cash in Hand", 50000], ["Bank Account", 0, 50000]),                                   // contra
  J("2025-09-01", ["Salaries", 36000], ["Rent", 24000], ["Bank Account", 0, 60000]),
  J("2025-10-01", ["Bank Account", 100000], ["Bank Loan", 0, 100000]),
  J("2026-01-01", ["Interest on Loan", 3000], ["Bank Account", 0, 3000]),
  J("2026-02-01", ["Bank Account", 2000], ["Commission Received", 0, 2000]),
  J("2026-03-01", ["Drawings", 12000], ["Cash in Hand", 0, 12000]),
  J("2026-03-31", ["Depreciation", 6000], ["Furniture & Fixtures", 0, 6000]),
  J("2026-03-31", ["Rent", 2000], ["Outstanding Expenses", 0, 2000]),                                    // accrual
];
entries.forEach(e => assert.deepEqual(validateEntry(e, byId), [], JSON.stringify(e)));
const stockCounts = [{ date: "2026-03-31", value: 80000 }];
const FY1 = { from: "2025-04-01", to: "2026-03-31" };
const b = computeBooks({ accounts, entries, stockCounts }, FY1);
const P = x => x / 100;

// Trading: Opening 50000 + Net purchases 290000 + Wages 15000 + Carriage 5000 = 360000
// Sales 380000 + Closing 80000 = 460000 → Gross profit 100000
assert.equal(P(b.figures.netSales), 380000);
assert.equal(P(b.figures.cogs), 280000);
assert.equal(P(b.figures.grossProfit), 100000);
assert.equal(P(b.trading.total), 460000);
// P&L: GP 100000 + Commission 2000 − (Salaries 36000 + Rent 26000 + Interest 3000 + Depreciation 6000) = 31000
assert.equal(P(b.figures.netProfit), 31000);
assert.equal(P(b.pl.total), 102000);
// Balance sheet
const bs = b.balanceSheet;
assert.equal(P(bs.capital.closing), 550000 + 31000 - 12000);
assert.ok(bs.balanced, `BS not balanced ${P(bs.liabTotal)} vs ${P(bs.assetTotal)}`);
// Assets: Furniture 54000 + Bank 189000 + Cash 18000 + Debtors 130000 + Stock 80000 = 471000
//   Bank: 500000-60000+250000-200000-50000-60000+100000-3000+2000 = 479000 ... recompute below
console.log("BS totals", P(bs.liabTotal), P(bs.assetTotal));
assert.equal(P(bs.liabTotal), 569000 + 100000 + 90000 + 2000);
assert.ok(b.trialBalance.balanced, "TB must balance");
// Cash flow ties to cash balances
const cf = b.cashFlow;
assert.equal(cf.opening + cf.netChange, cf.closing);
assert.equal(P(cf.investing), -60000);
assert.equal(P(cf.financing), 500000 + 100000 - 12000);
// Ratios
assert.ok(Math.abs(b.ratios.grossMargin - 100000/380000) < 1e-12);

// ----- Year 2: carries balances, retained profit and stock forward -----
entries.push(
  J("2026-05-01", ["Cash in Hand", 150000], ["Sales", 0, 150000]),
  J("2026-05-10", ["Purchases", 90000], ["Bank Account", 0, 90000]),
  J("2026-06-01", ["Salaries", 20000], ["Bank Account", 0, 20000])
);
const FY2 = { from: "2026-04-01", to: "2027-03-31" };
// no closing count yet in FY2 → closing stock = last count (80000)
const b2 = computeBooks({ accounts, entries, stockCounts }, FY2);
assert.equal(P(b2.figures.openingStock), 80000);
assert.equal(b2.figures.hasClosingCount, false);
assert.equal(P(b2.balanceSheet.capital.retainedBF), 31000);
assert.equal(P(b2.figures.netProfit), 150000 - 90000 - 20000);
assert.ok(b2.balanceSheet.balanced, "FY2 BS balanced");
assert.ok(b2.trialBalance.balanced, "FY2 TB balanced");
stockCounts.push({ date: "2027-03-31", value: 60000 });
const b3 = computeBooks({ accounts, entries, stockCounts }, FY2);
assert.equal(P(b3.figures.netProfit), 150000 - 90000 - 20000 - 20000); // stock fell 20000
assert.ok(b3.balanceSheet.balanced && b3.trialBalance.balanced);

// Validation
assert.ok(validateEntry({ date: "2026-01-01", lines: [{ accountId: A["Cash in Hand"], debit: 100 }, { accountId: A["Sales"], credit: 90 }] }, byId).length);
assert.ok(validateEntry({ date: "2026-01-01", lines: [{ accountId: A["Cash in Hand"], debit: 100 }] }, byId).length);
assert.ok(validateEntry({ date: "2026-01-01", lines: [{ accountId: A["Cash in Hand"], debit: 0.1 }, { accountId: A["Sales"], credit: 0.05 }, { accountId: A["Sales"], credit: 0.05 }] }, byId).length === 0, "paise rounding");

// Ledger: bank closing equals BS
const lg = accountLedger(A["Bank Account"], { accounts, entries }, FY1);
const bankBS = bs.currentAssets.find(r => r.name === "Bank Account").amount;
assert.equal(lg.closing, bankBS);
const lg2 = accountLedger(A["Bank Account"], { accounts, entries }, FY2);
assert.equal(lg2.opening, bankBS);
const sal = accountLedger(A["Salaries"], { accounts, entries }, FY2);
assert.equal(sal.opening, 0, "nominal accounts restart each year");

// Random fuzz: random balanced entries always produce balanced statements
function rnd(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const r = rnd(7);
for (let trial = 0; trial < 300; trial++) {
  const es = [];
  for (let i = 0; i < 40; i++) {
    const k = 2 + Math.floor(r()*3); const lines=[]; let tot=0;
    for (let j=0;j<k-1;j++){ const amt=Math.round(r()*100000)/100; tot+=Math.round(amt*100); lines.push({accountId: accounts[Math.floor(r()*accounts.length)].id, debit: amt, credit: 0}); }
    lines.push({accountId: accounts[Math.floor(r()*accounts.length)].id, debit:0, credit: tot/100});
    const day = new Date(Date.UTC(2024, 0, 1 + Math.floor(r()*1100))).toISOString().slice(0,10);
    es.push({ id: "f"+i, date: day, lines });
  }
  const counts = [{date:"2024-12-31", value: Math.round(r()*50000)}, {date:"2025-09-30", value: Math.round(r()*50000)}];
  for (const per of [{from:"2024-04-01",to:"2025-03-31"},{from:"2025-04-01",to:"2026-03-31"},{from:"2025-01-15",to:"2026-11-30"}]) {
    const x = computeBooks({ accounts, entries: es, stockCounts: counts }, per);
    assert.ok(x.balanceSheet.balanced, `fuzz BS ${trial} ${JSON.stringify(per)} ${x.balanceSheet.liabTotal} ${x.balanceSheet.assetTotal}`);
    assert.ok(x.trialBalance.balanced, `fuzz TB ${trial}`);
    assert.equal(x.cashFlow.opening + x.cashFlow.netChange, x.cashFlow.closing);
  }
}
assert.equal(financialYear(new Date("2026-02-10")).label, "FY 2025-26");
assert.equal(financialYear(new Date("2026-04-01")).from, "2026-04-01");
console.log("accounting: all ok");
