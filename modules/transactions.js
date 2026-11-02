import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    doc,
    deleteDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "../firebase/db.js";

function createdAtValue(createdAt) {
    if (!createdAt) return 0;
    if (typeof createdAt === "number") return createdAt;
    if (typeof createdAt.seconds === "number") return createdAt.seconds * 1000;
    return 0;
}

function sortOldestFirst(transactions) {
    return transactions.sort((a, b) => {
        const d = new Date(a.date) - new Date(b.date);
        if (d) return d;
        return createdAtValue(a.createdAt) - createdAtValue(b.createdAt);
    });
}

// Applies one transaction to the per-account running balances and
// stores the resulting balance of the account it was booked against.
function applyTransactionToBalances(t, balances) {
    const acc = t.accountId;
    const amount = Number(t.amount) || 0;
    if (!acc) return;

    if (balances[acc] === undefined) balances[acc] = 0;

    if (t.type === "income") balances[acc] += amount;
    else if (t.type === "expense") balances[acc] -= amount;
    else if (t.type === "asset_buy") balances[acc] -= amount;
    else if (t.type === "asset_sell") balances[acc] += amount;
    else if (t.type === "liability_add") balances[acc] += amount;
    else if (t.type === "liability_payment") balances[acc] -= amount;
    else if (t.type === "transfer" && t.toAccountId && t.toAccountId !== acc) {
        if (balances[t.toAccountId] === undefined) balances[t.toAccountId] = 0;
        balances[acc] -= amount;
        balances[t.toAccountId] += amount;
    }

    t.balance = balances[acc];
}

async function getOpeningBalances(profileId) {
    const snapshot = await getDocs(collection(db, "profiles", profileId, "accounts"));
    const balances = {};

    snapshot.forEach(accountDoc => {
        balances[accountDoc.id] = Number(accountDoc.data().openingBalance) || 0;
    });

    return balances;
}

// Recomputes the stored running `balance` on every transaction of a profile.
// Only writes documents whose balance actually changed.
export async function recomputeBalances(profileId) {
    const transactions = sortOldestFirst(await getTransactions(profileId));
    const runningBalances = await getOpeningBalances(profileId);

    const updates = [];
    for (const t of transactions) {
        const previous = t.balance;
        applyTransactionToBalances(t, runningBalances);
        if (previous !== t.balance) {
            updates.push(updateDoc(
                doc(db, "profiles", profileId, "transactions", t.id),
                { balance: t.balance ?? null }
            ));
        }
    }

    await Promise.all(updates);
}

// DELETE TRANSACTION
export async function deleteTransaction(transactionId, profileId) {
    await deleteDoc(doc(db, "profiles", profileId, "transactions", transactionId));
    await recomputeBalances(profileId);
}

// ADD TRANSACTION
// linked = { accountId, toAccountId, assetId, liabilityId, subtype }
export async function addTransaction(profileId, amount, type, category, date, linked = {}) {
    await addDoc(collection(db, "profiles", profileId, "transactions"), {
        profileId,
        amount: Number(amount),
        type,
        category,
        date,
        accountId: linked.accountId || null,
        toAccountId: linked.toAccountId || null,
        assetId: linked.assetId || null,
        liabilityId: linked.liabilityId || null,
        subtype: linked.subtype || null,
        createdAt: serverTimestamp()
    });

    await recomputeBalances(profileId);
}

// GET TRANSACTIONS
export async function getTransactions(profileId) {
    const q = query(
        collection(db, "profiles", profileId, "transactions"),
        where("profileId", "==", profileId)
    );

    const snapshot = await getDocs(q);

    return snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
    }));
}
