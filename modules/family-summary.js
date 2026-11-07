// ==========================================================
// FAMILY SUMMARY — pure calculations, no Firestore (tested in tests/family.test.mjs)
//
// Inputs
//   personal: [{ profile, metrics, emis }]  metrics = computeFinancials(...) for that profile
//   business: [{ profile, books }]     books   = computeBooks(...)      (amounts in paise)
//   items:    family items { kind: "asset"|"liability"|"due", name, value, liquid?, dueDate? }
//
// How the family numbers are built
//   Cash available  = personal account balances + business cash & bank + liquid family assets
//   Other assets    = personal investments/property + business non-cash assets + other family assets
//   Liabilities     = personal loans + business liabilities + family liabilities
//   Net worth       = cash + other assets − liabilities
//   Family HFRI     = ONE household score: the personal profiles' month-by-month income,
//                     spending, tax and debt service are added together, with family loans
//                     added to debt and liquid family assets to savings, then scored with the
//                     research model. Business money is excluded: it belongs to the business,
//                     and the owner's pay already reaches the household as personal income.
// ==========================================================
import { combineHouseholdHFRI, toDate, addMonths } from "./engine.js";

const rupees = paise => (Number(paise) || 0) / 100;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function summarizeFamily({ personal = [], business = [], items = [], today = new Date(), dueWindowDays = 30 } = {}) {
    const now = toDate(today) || new Date();
    const horizon = new Date(now.getTime() + dueWindowDays * 86400000);

    const famAssets = items.filter(i => i.kind === "asset");
    const famLiabs = items.filter(i => i.kind === "liability");
    const famDues = items.filter(i => i.kind === "due");
    const famLiquid = famAssets.filter(i => i.liquid).reduce((s, i) => s + num(i.value), 0);
    const famOtherAssets = famAssets.filter(i => !i.liquid).reduce((s, i) => s + num(i.value), 0);
    const famLiabTotal = famLiabs.reduce((s, i) => s + num(i.value), 0);

    // ---- per profile ----
    const rows = [];
    for (const { profile, metrics: m } of personal) {
        rows.push({
            id: profile.id, name: profile.name, type: profile.type || "personal", ownerId: profile.userId,
            cash: m.totalCash, assets: m.totalAssets, liabilities: m.totalLiabilities, netWorth: m.netWorth,
            hfri: m.hfri?.available ? m.hfri.total : null, hfriBand: m.hfri?.available ? m.hfri.band : null,
            hfriReason: m.hfri?.available ? "" : (m.hfri?.reason || "Not enough data yet")
        });
    }
    for (const { profile, books } of business) {
        const f = books.figures;
        const liab = rupees(f.longTermTotal + f.currentLiabTotal);
        const cash = rupees(f.cash);
        rows.push({
            id: profile.id, name: profile.name, type: "business", ownerId: profile.userId,
            cash, assets: rupees(f.totalAssets) - cash, liabilities: liab, netWorth: rupees(f.equity),
            netProfit: rupees(f.netProfit), receivables: rupees(f.receivables), payables: rupees(f.payables),
            hfri: null, hfriBand: null, hfriReason: "Businesses aren't scored by HFRI"
        });
    }

    const sum = key => rows.reduce((s, r) => s + num(r[key]), 0);
    const totals = {
        cash: sum("cash") + famLiquid,
        assets: sum("assets") + famOtherAssets,
        liabilities: sum("liabilities") + famLiabTotal,
        receivables: sum("receivables"),
        payables: sum("payables"),
        familyAssets: famLiquid + famOtherAssets,
        familyLiabilities: famLiabTotal
    };
    totals.netWorth = totals.cash + totals.assets - totals.liabilities;

    // ---- cash split, for the overview bar ----
    const cashBy = {
        personal: rows.filter(r => r.type !== "business").reduce((s, r) => s + num(r.cash), 0),
        business: rows.filter(r => r.type === "business").reduce((s, r) => s + num(r.cash), 0),
        family: famLiquid
    };

    // ---- payments due (overdue + next N days) ----
    const dues = [];
    for (const { profile, metrics: m, emis = [] } of personal) {
        for (const [emiId, st] of Object.entries(m.emiStatus || {})) {
            if (st.completed || !st.nextDue) continue;
            const due = toDate(st.nextDue);
            if (!due || due > horizon) continue;
            const emi = emis.find(e => e.id === emiId);
            dues.push({ date: due, name: emi?.name || "Loan EMI", amount: num(emi?.amount), source: profile.name, kind: "EMI" });
        }
    }
    for (const it of famDues) {
        const due = toDate(it.dueDate);
        if (!due) continue;
        if (due <= horizon) dues.push({ date: due, name: it.name, amount: num(it.value), source: "Family", kind: it.repeat === "monthly" ? "Monthly" : "Due" });
        // a monthly due also shows its next occurrence once this one has passed
        if (it.repeat === "monthly" && due < now) {
            let next = due; let guard = 0;
            while (next < now && guard++ < 600) next = addMonths(next, 1);
            if (next <= horizon && next.getTime() !== due.getTime()) dues.push({ date: next, name: it.name, amount: num(it.value), source: "Family", kind: "Monthly" });
        }
    }
    dues.sort((a, b) => a.date - b.date);
    dues.forEach(d => { d.overdue = d.date < now; });

    // ---- family HFRI ----
    const parts = personal.map(({ metrics: m }) => ({
        household: m.household, recordedMonths: m.recordedMonths, debt: m.totalLiabilities, liquid: m.totalCash
    }));
    const hfri = parts.length
        ? combineHouseholdHFRI(parts, { today: now, extraDebt: famLiabTotal, extraLiquid: famLiquid })
        : { available: false, reason: "Link at least one personal profile to see the family's HFRI." };

    return { rows, totals, cashBy, dues, hfri, counts: { personal: personal.length, business: business.length, items: items.length } };
}
