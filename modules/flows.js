export function classifyTransaction(t) {
    switch (t?.type) {
        case "income": return "income";
        case "expense": return "expense";
        case "liability_payment": return "expense";
        case "asset_buy": return "investment";
        case "asset_sell": return "liquidation";
        case "liability_add": return "borrowing";
        case "transfer": return "transfer";
        default: return "other";
    }
}
