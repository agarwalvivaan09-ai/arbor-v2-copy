import { computeFinancials, addMonths } from "../modules/engine.js";
import assert from "node:assert/strict";
const today = "2026-11-02T12:00:00Z";
const near = (a,b,eps=1)=>assert.ok(Math.abs(a-b)<=eps, `${a} != ${b}`);
const acc = [{id:"A",openingBalance:10000},{id:"B",openingBalance:0}];

// 1. income/expense/transfer; future txn ignored
let m = computeFinancials({accounts:acc, transactions:[
 {type:"income",subtype:"salary",amount:50000,accountId:"A",date:"2026-10-01"},
 {type:"expense",amount:20000,category:"Rent",accountId:"A",date:"2026-10-05"},
 {type:"expense",amount:1000,category:"rent ",accountId:"A",date:"2026-10-06"},
 {type:"expense",amount:15000,category:"Food",accountId:"A",date:"2026-10-07"},
 {type:"transfer",amount:5000,accountId:"A",toAccountId:"B",date:"2026-10-08"},
 {type:"income",amount:99999,accountId:"A",date:"2027-01-01"},
]},{today});
assert.equal(m.balances.A, 10000+50000-36000-5000);
assert.equal(m.balances.B, 5000);
assert.equal(m.totalCash, 24000);
assert.equal(m.income, 50000); assert.equal(m.expense, 36000);
assert.equal(m.topCategory, "Rent");
near(m.emergencyCoverage, 24000/36000, 0.001);
console.log("1 ok");

// 2. asset buy is net-worth neutral; 0% rate stays 0%
m = computeFinancials({accounts:acc, assets:[{id:"X",value:10000,rate:0,type:"appreciating",compounding:"simple",startDate:"2025-11-02"}],
  transactions:[{type:"asset_buy",amount:10000,accountId:"A",assetId:"X",date:"2025-11-02"}]},{today});
assert.equal(m.totalAssets,10000); assert.equal(m.netWorth,10000);
// partial sale
m = computeFinancials({accounts:acc, assets:[{id:"X",value:10000,rate:10,type:"appreciating",compounding:"compound",startDate:"2024-11-02"}],
  transactions:[{type:"asset_buy",amount:10000,accountId:"A",assetId:"X",date:"2024-11-02"},
                {type:"asset_sell",amount:11000,accountId:"A",assetId:"X",date:"2025-11-02"}]},{today});
// full sale at market after 1y => remaining ~0
near(m.totalAssets, 0, 30);
console.log("2 ok", m.totalAssets.toFixed(2));

// 3. loan neutral at start, future loan ignored
m = computeFinancials({accounts:acc, liabilities:[{id:"L",value:100000,rate:0,type:"simple",startDate:"2026-11-01"},{id:"F",value:5e5,rate:8,startDate:"2027-01-01"}],
  transactions:[{type:"liability_add",amount:100000,accountId:"A",liabilityId:"L",date:"2026-11-01"},
                {type:"liability_add",amount:5e5,accountId:"A",liabilityId:"F",date:"2027-01-01"}]},{today});
assert.equal(m.totalLiabilities,100000); assert.equal(m.netWorth,10000);
console.log("3 ok");

// 4. EMI: 0% loan 12000, 12 x 1000, first due 1 month after 2026-01-15 → due Feb..Oct 15 = 9 paid
m = computeFinancials({accounts:acc, liabilities:[{id:"L",name:"Car",value:12000,rate:0,type:"simple",startDate:"2026-01-15"}],
 emis:[{id:"E",name:"Car",amount:1000,tenure:12,firstDate:"2026-02-15",accountId:"A",liabilityId:"L"}],
 transactions:[{type:"liability_add",amount:12000,accountId:"A",liabilityId:"L",date:"2026-01-15"}]},{today});
assert.equal(m.emiStatus.E.paidCount,9);
assert.equal(m.totalLiabilities,3000);
assert.equal(m.balances.A,10000+12000-9000);
assert.equal(m.netWorth,10000); // EMIs on 0% loan don't change net worth
assert.equal(m.emiStatus.E.nextDue.toISOString().slice(0,10),"2026-11-15");
// legacy EMI (no liabilityId, nextDate = loan date) links by name
let m2 = computeFinancials({accounts:acc, liabilities:[{id:"L",name:"Car",value:12000,rate:0,type:"simple",startDate:"2026-01-15"}],
 emis:[{id:"E",name:"Car",amount:1000,tenure:12,nextDate:"2026-01-15",accountId:"A"}],
 transactions:[{type:"liability_add",amount:12000,accountId:"A",liabilityId:"L",date:"2026-01-15"}]},{today});
assert.equal(m2.emiStatus.E.paidCount,10); assert.equal(m2.netWorth,10000);
// stops when loan cleared even if tenure larger
m2 = computeFinancials({accounts:acc, liabilities:[{id:"L",name:"Car",value:3000,rate:0,startDate:"2026-01-15"}],
 emis:[{id:"E",name:"Car",amount:1000,tenure:24,firstDate:"2026-02-15",accountId:"A",liabilityId:"L"}]},{today});
assert.equal(m2.emiStatus.E.paidCount,3); assert.ok(m2.emiStatus.E.completed); assert.equal(m2.totalLiabilities,0);
console.log("4 ok");

// 5. Real amortized loan: 1,00,000 @12% compound, EMI for 12 months ≈ 8,885 → near 0 after 12
const P=100000, r=0.12;
m = computeFinancials({accounts:acc, liabilities:[{id:"L",name:"PL",value:P,rate:12,type:"compound",startDate:"2025-10-01"}],
 emis:[{id:"E",name:"PL",amount:8885,tenure:12,firstDate:"2025-11-01",accountId:"A",liabilityId:"L"}]},{today});
console.log("5 remaining after 12 EMIs:", m.totalLiabilities.toFixed(0), "paid", m.emiStatus.E.paidCount, m.emiStatus.E.completed);
assert.ok(m.totalLiabilities < 1500);

// addMonths clamp
assert.equal(addMonths("2026-01-31",1).toISOString().slice(0,10),"2026-02-28");
// tax progressive
console.log("all ok");

// A loan or asset purchase in a month with no income/spending must not dilute the HFRI averages
{
  const { computeFinancials } = await import("../modules/engine.js");
  const tx = [
    { type: "liability_add", amount: 500000, date: "2026-06-20", accountId: "A", liabilityId: "L" },
    { type: "asset_buy", amount: 100000, date: "2026-06-25", accountId: "A", assetId: "X" },
    ...["2026-07", "2026-08", "2026-09"].flatMap(m => [
      { type: "income", amount: 100000, date: m + "-01", accountId: "A" },
      { type: "expense", amount: 40000, date: m + "-05", accountId: "A", subtype: "fixed" }
    ])
  ];
  const m = computeFinancials({ accounts: [{ id: "A", openingBalance: 0 }], transactions: tx,
    liabilities: [{ id: "L", name: "Loan", value: 500000, rate: 0, startDate: "2026-06-20" }],
    assets: [{ id: "X", value: 100000, rate: 0, startDate: "2026-06-25" }] }, { today: "2026-10-02T00:00:00Z" });
  if (m.hfri.baseline.months !== 3 || m.hfri.baseline.income !== 100000) throw new Error("window diluted: " + JSON.stringify(m.hfri.baseline));
  console.log("window ok");
}
