// Progressive slab tax (simple Indian-style slabs, editable later).
// Each rate applies only to the income that falls inside its slab.
const SLABS = [
    { upTo: 250000, rate: 0 },
    { upTo: 500000, rate: 0.05 },
    { upTo: 1000000, rate: 0.2 },
    { upTo: Infinity, rate: 0.3 }
];

export function computeTax(income) {
    const taxable = Math.max(0, Number(income) || 0);
    let tax = 0;
    let lower = 0;

    for (const { upTo, rate } of SLABS) {
        if (taxable <= lower) break;
        tax += (Math.min(taxable, upTo) - lower) * rate;
        lower = upTo;
    }

    return tax;
}
