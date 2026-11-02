import assert from "node:assert/strict";
import { personalStressTest, personalMonteCarlo, businessStressTest, businessMonteCarlo, rng, percentile, logVolatility } from "../modules/simulate.js";
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);

// RNG: deterministic + roughly standard normal
const R1 = rng(1), R2 = rng(1); for (let i = 0; i < 5; i++) assert.equal(R1.normal(), R2.normal());
const R = rng(3); let s = 0, s2 = 0; const N = 200000; for (let i = 0; i < N; i++) { const z = R.normal(); s += z; s2 += z * z; }
near(s / N, 0, 0.01); near(s2 / N, 1, 0.01);

// ---- personal stress ----
const base = { income: 100000, spending: 60000, debtService: 10000, liquid: 150000, debt: 500000, assets: 400000, essential: 45000, cv: 0.2 };
let r = personalStressTest(base, { incomeDrop: 1, spendingRise: 0, months: 6, oneOff: 0, assetDrop: 0 });
assert.equal(r.stressedNet, -70000);
assert.equal(r.endCash, 150000 - 6 * 70000);
assert.equal(r.runOutMonth, 3);                         // 150k−70k−70k = 10k (m2), −60k at m3
near(r.runwayMonths, 150000 / 70000);
assert.equal(r.shortfall, 270000);
assert.equal(r.cashUsed, 420000); assert.equal(r.covered, false);
assert.equal(r.hfriDuring, null);                        // no income → HFRI undefined
r = personalStressTest(base, { incomeDrop: 0.25, spendingRise: 0, months: 3, oneOff: 0, assetDrop: 0.3 });
assert.equal(r.shockCost, 75000); assert.ok(r.covered);
assert.equal(r.runOutMonth, null);
// no interest given → the whole ₹10,000/month reduces the loan
assert.equal(r.netWorthAfter, (150000 + 3 * 5000) + 400000 * 0.7 - (500000 - 30000));
const ri = personalStressTest({ ...base, interest: 4000 }, { incomeDrop: 0, spendingRise: 0, months: 6, oneOff: 0, assetDrop: 0 });
assert.equal(ri.principalRepaid, 6 * 6000);
assert.equal(ri.netWorthAfter - ri.netWorthBefore, 6 * (30000 + 6000)); // cash surplus + principal repaid
assert.ok(r.hfriDuring.total < r.hfriBefore.total);

// ---- personal Monte Carlo: deterministic limits ----
// no noise, no income: a 10% asset compounds to exactly 1.1^years
let mc = personalMonteCarlo({ cash: 0, assets: [{ value: 100000, rate: 0.10 }], loans: [], income: 0, spending: 0, marketVol: 0, years: 5, sims: 100 });
near(mc.median, 100000 * 1.1 ** 5, 1e-9);
// a standard EMI amortises a loan to zero over its tenure
const P = 1000000, rA = 0.09, n = 120, i = rA / 12, emi = P * i * (1 + i) ** n / ((1 + i) ** n - 1);
mc = personalMonteCarlo({ cash: 2000000, assets: [], loans: [{ balance: P, rate: rA, payment: emi }], income: 0, spending: 0, years: 10, sims: 100 });
near(mc.median, 2000000 - emi * n, 1e-6);   // loan gone, cash paid all EMIs
// savings accumulate exactly with zero noise
mc = personalMonteCarlo({ cash: 0, assets: [], loans: [], income: 50000, spending: 30000, years: 3, sims: 100 });
near(mc.median, 20000 * 36); assert.equal(mc.pCashShortfall, 0); assert.equal(mc.pGrow, 1);
// certain job loss every year → shortfalls happen
mc = personalMonteCarlo({ cash: 10000, assets: [], loans: [], income: 50000, spending: 40000, jobLossProb: 0.9, jobLossMonths: 6, years: 5, sims: 500 });
assert.ok(mc.pCashShortfall > 0.5);
// noisy market: median below mean (lognormal), percentiles ordered, mean ≈ expected
mc = personalMonteCarlo({ cash: 0, assets: [{ value: 100000, rate: 0.12 }], loans: [], income: 0, spending: 0, marketVol: 0.2, years: 10, sims: 20000, seed: 9 });
const mean = mc.finals.reduce((a, b) => a + b, 0) / mc.finals.length;
near(mean, 100000 * 1.12 ** 10, 0.03);
assert.ok(mc.median < mean && mc.p5 < mc.median && mc.median < mc.p95);
mc.bands.forEach(b => assert.ok(b.p5 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p95));

// ---- business stress ----
const bb = { revenue: 500000, variableCosts: 300000, fixedCosts: 120000, cash: 400000 };
let bs = businessStressTest(bb, { revenueDrop: 0, costRise: 0, months: 1 });
assert.equal(bs.profit, 80000); near(bs.breakEvenRevenue, 300000); near(bs.marginOfSafety, 0.4);
bs = businessStressTest(bb, { revenueDrop: 0.5, costRise: 0, months: 6 });
assert.equal(bs.profit, 250000 - 150000 - 120000);   // −20000
near(bs.runwayMonths, 20); assert.equal(bs.runOutMonth, null);
bs = businessStressTest(bb, { revenueDrop: 0, costRise: 0, months: 3, collectionDelayDays: 45 });
near(bs.delayCash, 500000 * 12 / 365 * 45);

// ---- business Monte Carlo ----
let bm = businessMonteCarlo({ cash: 100000, revenue: 500000, revenueVol: 0, variableRatio: 0.6, fixedCosts: 120000, months: 12, sims: 100 });
near(bm.median, 100000 + 12 * 80000); assert.equal(bm.pCashOut, 0);
bm = businessMonteCarlo({ cash: 50000, revenue: 300000, revenueVol: 0.3, variableRatio: 0.6, fixedCosts: 150000, months: 12, sims: 3000 });
assert.ok(bm.pCashOut > 0.9, "loss-making business runs out"); // expected monthly loss ₹30,000
bm.bands.forEach(b => assert.ok(b.p5 <= b.p50 && b.p50 <= b.p95));
near(logVolatility([100, 110, 121, 133.1]), 0, 1e-9);
console.log("simulate: all ok");
