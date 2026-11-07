import { computeFinancials } from "../modules/engine.js";
import { computeBooks, toPaise } from "../modules/accounting.js";
import { summarizeFamily } from "../modules/family-summary.js";
import assert from "node:assert/strict";

const today = "2026-11-02T12:00:00Z";
const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const months = [6, 7, 8, 9, 10].map(m => `2026-${String(m).padStart(2, "0")}`);
const personalState = (opening, income, spending, extra = {}) => ({
    accounts: [{ id: "A", openingBalance: opening }],
    transactions: months.flatMap(m => [
        { type: "income", subtype: "salary", amount: income, accountId: "A", date: `${m}-01` },
        { type: "expense", subtype: "fixed", amount: spending, accountId: "A", date: `${m}-05` }
    ]),
    ...extra
});

// Two personal profiles: me and my sister
const meState = personalState(100000, 80000, 40000);
const sisState = personalState(20000, 30000, 26000);
const me = computeFinancials(meState, { today });
const sis = computeFinancials(sisState, { today });

// One business with simple books: capital 5L into bank, a 2L machine, a 1L bank loan
const accounts = [
    { id: "bank", name: "Bank", group: "current_asset", kind: "bank" },
    { id: "cap", name: "Capital", group: "capital" },
    { id: "mach", name: "Machinery", group: "fixed_asset" },
    { id: "loan", name: "Bank loan", group: "long_term_liability" }
];
const line = (accountId, debit, credit) => ({ accountId, debit, credit });
const entries = [
    { id: "e1", date: "2026-04-10", lines: [line("bank", 500000, 0), line("cap", 0, 500000)] },
    { id: "e2", date: "2026-05-01", lines: [line("mach", 200000, 0), line("bank", 0, 200000)] },
    { id: "e3", date: "2026-06-01", lines: [line("bank", 100000, 0), line("loan", 0, 100000)] }
].map(e => ({ ...e, lines: e.lines.map(l => ({ ...l, debit: l.debit, credit: l.credit })) }));
const books = computeBooks({ accounts, entries, stockCounts: [] }, { from: "2026-04-01", to: "2026-11-02" });

const items = [
    { kind: "asset", name: "Family home", value: 9000000 },
    { kind: "asset", name: "Family FD", value: 300000, liquid: true },
    { kind: "liability", name: "Home loan", value: 2500000 },
    { kind: "due", name: "School fees", value: 45000, dueDate: "2026-11-15" },
    { kind: "due", name: "Insurance", value: 12000, dueDate: "2027-03-01" } // outside 30 days
];

const s = summarizeFamily({
    personal: [{ profile: { id: "p1", name: "Me", userId: "u1" }, metrics: me, emis: [] },
               { profile: { id: "p2", name: "Sis", userId: "u2" }, metrics: sis, emis: [] }],
    business: [{ profile: { id: "b1", name: "Shop", userId: "u1" }, books }],
    items, today
});

// business figures (books use paise internally)
const bizCash = books.figures.cash / 100;
assert.equal(bizCash, 400000, "business cash = 5L - 2L + 1L");
near(books.figures.equity / 100, 500000);

// cash = personal + business + liquid family assets
near(s.totals.cash, me.totalCash + sis.totalCash + 400000 + 300000);
// other assets = personal non-cash + business non-cash (machine) + family home
near(s.totals.assets, me.totalAssets + sis.totalAssets + 200000 + 9000000);
// liabilities = personal + business loan + family home loan
near(s.totals.liabilities, me.totalLiabilities + sis.totalLiabilities + 100000 + 2500000);
near(s.totals.netWorth, s.totals.cash + s.totals.assets - s.totals.liabilities);
near(s.totals.netWorth, me.netWorth + sis.netWorth + 500000 + 9000000 + 300000 - 2500000);
console.log("1 totals ok");

// dues: only within 30 days
assert.equal(s.dues.length, 1);
assert.equal(s.dues[0].name, "School fees");
console.log("2 dues ok");

// family HFRI = one household score, with the family home loan as debt and the FD as liquid savings
assert.equal(s.hfri.available, true);
const combinedState = {
    accounts: [{ id: "A", openingBalance: 100000 }, { id: "B", openingBalance: 20000 }, { id: "FD", openingBalance: 300000 }],
    transactions: [...meState.transactions, ...sisState.transactions.map(t => ({ ...t, accountId: "B" }))],
    liabilities: [{ id: "L", name: "Home loan", amount: 2500000, rate: 0, startDate: "2026-01-01" }],
    transactions2: []
};
const asOne = computeFinancials(combinedState, { today });
near(s.hfri.inputs.debt, 2500000);
near(s.hfri.inputs.liquid, me.totalCash + sis.totalCash + 300000);
near(s.hfri.inputs.income, asOne.hfri.inputs.income);
near(s.hfri.inputs.spending, asOne.hfri.inputs.spending);
assert.ok(s.hfri.total > 0 && s.hfri.total <= 100);
console.log("3 family HFRI ok:", s.hfri.total.toFixed(2), "(me", me.hfri.total.toFixed(2), "| sis", sis.hfri.total.toFixed(2) + ")");

// businesses never feed HFRI; a family with only a business has no score
const onlyBiz = summarizeFamily({ business: [{ profile: { id: "b1", name: "Shop" }, books }], today });
assert.equal(onlyBiz.hfri.available, false);
console.log("4 business-only family ok");

// monthly due rolls forward to its next date
const monthly = summarizeFamily({ items: [{ kind: "due", name: "Rent", value: 20000, dueDate: "2026-09-10", repeat: "monthly" }], today });
assert.ok(monthly.dues.some(d => d.date.toISOString().startsWith("2026-11-10")), "next monthly due is 10 Nov");
console.log("5 monthly dues ok");

console.log("family: all ok");
