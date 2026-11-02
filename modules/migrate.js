import { recomputeBalances } from "./transactions.js";

// One-off repair: rebuilds the stored running balance on every
// transaction of a profile, per account, from the account opening balances.
export async function migrateBalances(profileId) {
    await recomputeBalances(profileId);
    console.log("✅ Migration complete");
}
