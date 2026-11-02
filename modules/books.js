// Firestore storage for business books.
// profiles/{id}/ledgerAccounts, /journal, /stockCounts
import {
    collection, addDoc, getDocs, doc, deleteDoc, updateDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase/db.js";
import { DEFAULT_CHART, validateEntry, cleanLines } from "./accounting.js";

const col = (pid, name) => collection(db, "profiles", pid, name);
const read = async (pid, name) => (await getDocs(col(pid, name))).docs.map(d => ({ id: d.id, ...d.data() }));

export async function loadBooks(profileId) {
    const [accounts, entries, stockCounts] = await Promise.all([
        read(profileId, "ledgerAccounts"),
        read(profileId, "journal"),
        read(profileId, "stockCounts")
    ]);
    accounts.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")) || a.name.localeCompare(b.name));
    return { accounts, entries, stockCounts };
}

// Creates the standard chart of accounts once per business profile.
export async function seedChartOfAccounts(profileId) {
    const batch = writeBatch(db);
    for (const a of DEFAULT_CHART) {
        batch.set(doc(col(profileId, "ledgerAccounts")), { ...a, kind: a.kind || null, system: true, createdAt: serverTimestamp() });
    }
    await batch.commit();
}

export async function createLedgerAccount(profileId, { name, group, kind = null, code = "" }) {
    const ref = await addDoc(col(profileId, "ledgerAccounts"), { name, group, kind, code, system: false, createdAt: serverTimestamp() });
    return ref.id;
}

export async function deleteLedgerAccount(profileId, accountId) {
    await deleteDoc(doc(db, "profiles", profileId, "ledgerAccounts", accountId));
}

// Refuses unbalanced or invalid entries — the books can never go out of balance.
export async function postJournal(profileId, entry, accountsById) {
    const errors = validateEntry(entry, accountsById);
    if (errors.length) throw new Error(errors[0]);
    await addDoc(col(profileId, "journal"), {
        date: entry.date,
        narration: entry.narration || "",
        reference: entry.reference || "",
        template: entry.template || "manual",
        lines: cleanLines(entry.lines),
        createdAt: serverTimestamp()
    });
}

export async function deleteJournal(profileId, entryId) {
    await deleteDoc(doc(db, "profiles", profileId, "journal", entryId));
}

export async function addStockCount(profileId, date, value) {
    await addDoc(col(profileId, "stockCounts"), { date, value: Number(value), createdAt: serverTimestamp() });
}

export async function deleteStockCount(profileId, id) {
    await deleteDoc(doc(db, "profiles", profileId, "stockCounts", id));
}

export async function updateProfileSettings(profileId, data) {
    await updateDoc(doc(db, "profiles", profileId), data);
}
