// ==========================================================
// FAMILY — Firestore data access.
//   families/{fid}                 name, head (ownerId), memberIds, members{uid:{name,email}}
//   families/{fid}/items/{id}      family-owned assets, liabilities and due payments
//   families/{fid}/messages/{id}   family chat
//   invites/{fid}_{email}          pending / accepted / declined invites
//   profiles/{pid}.familyId        a linked personal or business profile
// Security is enforced by firestore.rules; these helpers just make the calls.
// ==========================================================
import {
    collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot, writeBatch, arrayUnion, arrayRemove,
    deleteField, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase/db.js";

export const MAX_INVITED = 3;   // the head plus up to 3 invited people

const nameOf = user => (user.displayName || user.email || "Member").trim();
const lower = s => String(s || "").trim().toLowerCase();
const inviteId = (fid, email) => `${fid}_${lower(email)}`;
const list = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// ---------- families ----------
export async function createFamily(user, name) {
    return addDoc(collection(db, "families"), {
        name: name.trim(),
        ownerId: user.uid,
        memberIds: [user.uid],
        members: { [user.uid]: { name: nameOf(user), email: lower(user.email), joinedAt: new Date() } },
        createdAt: serverTimestamp()
    });
}

export async function getMyFamilies(uid) {
    return list(await getDocs(query(collection(db, "families"), where("memberIds", "array-contains", uid))));
}

export async function getFamily(fid) {
    const snap = await getDoc(doc(db, "families", fid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function renameFamily(fid, name) {
    await updateDoc(doc(db, "families", fid), { name: name.trim() });
}

// ---------- linked profiles ----------
export async function getFamilyProfiles(fid) {
    return list(await getDocs(query(collection(db, "profiles"), where("familyId", "==", fid))));
}

export async function linkProfile(profileId, family) {
    await updateDoc(doc(db, "profiles", profileId), { familyId: family.id, familyName: family.name });
}

export async function unlinkProfile(profileId) {
    await updateDoc(doc(db, "profiles", profileId), { familyId: null, familyName: null });
}

async function unlinkProfilesOf(fid, uid) {
    const own = list(await getDocs(query(collection(db, "profiles"), where("familyId", "==", fid), where("userId", "==", uid))));
    await Promise.all(own.map(p => unlinkProfile(p.id)));
}

// ---------- members ----------
// Head only. Their profiles leave the family first, then the person.
export async function removeMember(fid, memberUid) {
    await unlinkProfilesOf(fid, memberUid);
    await updateDoc(doc(db, "families", fid), { memberIds: arrayRemove(memberUid), [`members.${memberUid}`]: deleteField() });
}

export async function leaveFamily(fid, uid) {
    await unlinkProfilesOf(fid, uid);
    await updateDoc(doc(db, "families", fid), { memberIds: arrayRemove(uid), [`members.${uid}`]: deleteField() });
}

// Head only: unlinks every profile, clears items, chat and invites, then deletes.
export async function deleteFamily(fid) {
    const [profiles, items, messages, invites] = await Promise.all([
        getFamilyProfiles(fid),
        getDocs(collection(db, "families", fid, "items")),
        getDocs(collection(db, "families", fid, "messages")),
        getDocs(query(collection(db, "invites"), where("familyId", "==", fid)))
    ]);
    await Promise.all(profiles.map(p => unlinkProfile(p.id)));
    await Promise.all([...items.docs, ...messages.docs, ...invites.docs].map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "families", fid));
}

// ---------- invites ----------
export async function getFamilyInvites(fid) {
    return list(await getDocs(query(collection(db, "invites"), where("familyId", "==", fid))));
}

export async function inviteMember(family, email, user) {
    await setDoc(doc(db, "invites", inviteId(family.id, email)), {
        familyId: family.id,
        familyName: family.name,
        email: lower(email),
        status: "pending",
        invitedBy: user.uid,
        invitedByName: nameOf(user),
        createdAt: serverTimestamp()
    });
}

export async function cancelInvite(fid, email) {
    await deleteDoc(doc(db, "invites", inviteId(fid, email)));
}

export async function getMyInvites(email) {
    if (!email) return [];
    return list(await getDocs(query(collection(db, "invites"), where("email", "==", lower(email)), where("status", "==", "pending"))));
}

// Joining and marking the invite accepted happen together, so neither can half-succeed.
export async function acceptInvite(invite, user) {
    const batch = writeBatch(db);
    batch.update(doc(db, "families", invite.familyId), {
        memberIds: arrayUnion(user.uid),
        [`members.${user.uid}`]: { name: nameOf(user), email: lower(user.email), joinedAt: new Date() }
    });
    batch.update(doc(db, "invites", invite.id), { status: "accepted", respondedAt: new Date() });
    await batch.commit();
}

export async function declineInvite(invite) {
    await updateDoc(doc(db, "invites", invite.id), { status: "declined", respondedAt: new Date() });
}

// ---------- family items (house, family loan, school fees due…) ----------
export async function getItems(fid) {
    return list(await getDocs(collection(db, "families", fid, "items")));
}

export async function addItem(fid, user, item) {
    return addDoc(collection(db, "families", fid, "items"), {
        ...item,
        addedBy: user.uid,
        addedByName: nameOf(user),
        createdAt: serverTimestamp()
    });
}

export async function deleteItem(fid, itemId) {
    await deleteDoc(doc(db, "families", fid, "items", itemId));
}

// ---------- chat ----------
export function subscribeMessages(fid, onChange, onError) {
    const q = query(collection(db, "families", fid, "messages"), orderBy("createdAt", "asc"), limit(300));
    return onSnapshot(q, snap => onChange(list(snap)), onError);
}

export async function sendMessage(fid, user, text) {
    await addDoc(collection(db, "families", fid, "messages"), {
        text: text.trim().slice(0, 1000),
        senderId: user.uid,
        senderName: nameOf(user),
        createdAt: serverTimestamp()
    });
}

export async function deleteMessage(fid, messageId) {
    await deleteDoc(doc(db, "families", fid, "messages", messageId));
}
