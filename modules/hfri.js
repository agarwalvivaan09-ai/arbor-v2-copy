// ==========================================================
// HOUSEHOLD FINANCIAL RESILIENCE INDEX (HFRI)
// Vivaan Agarwal — formulas, constants and bands are taken
// directly from the paper and the official HFRI calculator.
//
//   HFRI = 0.25 S + 0.25 D + 0.25 E + 0.25 X
//   D    = 0.40 D_DTI + 0.60 D_DSTI
// ==========================================================

import { HFRI_SITE } from "./site.js";

export const HFRI_LINKS = {
    calculator: HFRI_SITE.calculator,
    paper: HFRI_SITE.research,
    source: HFRI_SITE.source
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Savings Strength: SR = (Y - C) / Y
export const scoreSavings = sr =>
    sr <= -0.10 ? 0 : 100 * (1 - Math.exp(-5.89681 * (sr + 0.10)));

// Debt Sustainability, stock: DTI = outstanding debt / annual income
export const scoreDTI = dti =>
    100 * Math.exp(-0.0573534 * Math.pow(Math.max(dti, 0), 2.13509));

// Debt Sustainability, flow: DSTI = annual debt service / annual income
export const scoreDSTI = dsti =>
    clamp(-521.45598 * dsti * dsti + 9.08245 * dsti + 100.00523, 0, 100);

// Emergency Coverage: EC = liquid savings / monthly essential spending
export const scoreEC = ec =>
    ec === Infinity ? 100 : 100 * (1 - Math.exp(-0.37028 * Math.pow(Math.max(ec, 0), 0.901391)));

// Expense Stability: CV = std dev / mean of monthly spending
export const scoreCV = cv =>
    100 * Math.exp(-3.13957 * Math.pow(Math.max(cv, 0), 1.30837));

// Provisional bands from the paper's Phase II shock simulation.
export const HFRI_BANDS = [
    { max: 60, key: "very-low", label: "Very low", text: "Very low simulated shock-absorption capacity." },
    { max: 65, key: "low", label: "Low", text: "Low simulated shock-absorption capacity." },
    { max: 70, key: "transition", label: "Transition zone", text: "Simulated shock survival rises steeply here. Small gains in liquidity matter most." },
    { max: 75, key: "high", label: "High", text: "High simulated shock-absorption capacity." },
    { max: Infinity, key: "very-high", label: "Very high", text: "Very high simulated shock-absorption capacity." }
];

export const hfriBand = score => HFRI_BANDS.find(b => score < b.max);

// All inputs annual except essentialMonthly; cv is a ratio.
// { income Y, spending C, debt Db, debtService DS, liquid L, essentialMonthly, cv }
export function computeHFRI(inp) {
    const Y = inp.income;
    const sr = (Y - inp.spending) / Y;
    const dti = inp.debt / Y;
    const dsti = inp.debtService / Y;
    const ec = inp.essentialMonthly > 0
        ? inp.liquid / inp.essentialMonthly
        : (inp.liquid > 0 ? Infinity : 0);
    const cv = inp.cv;

    const S = scoreSavings(sr);
    const dtiScore = scoreDTI(dti);
    const dstiScore = scoreDSTI(dsti);
    const D = 0.40 * dtiScore + 0.60 * dstiScore;
    const E = scoreEC(ec);
    const X = scoreCV(cv);

    const total = 0.25 * S + 0.25 * D + 0.25 * E + 0.25 * X;

    return {
        total,
        band: hfriBand(total),
        indicators: { sr, dti, dsti, ec, cv },
        scores: { S, D, E, X, dtiScore, dstiScore }
    };
}
