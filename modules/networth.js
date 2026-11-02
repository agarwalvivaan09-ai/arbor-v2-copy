import { db } from "../firebase/db.js";
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";



export async function deleteAsset(profileId, assetId) {
    await deleteDoc(doc(db, "profiles", profileId, "assets", assetId));
}

export async function deleteLiability(profileId, liabilityId) {
    await deleteDoc(doc(db, "profiles", profileId, "liabilities", liabilityId));
}
export async function addAsset(
    profileId,
    name,
    value,
    rate,
    type,
    startDate = null,
    endDate = null,
    compounding = "simple"
) {
    return await addDoc(collection(db, "profiles", profileId, "assets"), {
        profileId,
        name,
        value: Number(value),
        rate: rate === null || rate === undefined || rate === "" ? null : Number(rate),
        type,
        startDate,
        endDate,
        compounding,
        createdAt: new Date()
    });
}

export async function addLiability(
    profileId,
    name,
    value,
    rate,
    startDate = null,
    endDate = null,
    type = "simple"
) {
    return await addDoc(collection(db, "profiles", profileId, "liabilities"), {
        profileId,
        name,
        value: Number(value),
        rate: rate === null || rate === undefined || rate === "" ? null : Number(rate),
        startDate,
        endDate,
        type,
        createdAt: new Date()
    });
}

export async function getAssets(profileId) {
    const q = query(collection(db, "profiles", profileId, "assets"), where("profileId", "==", profileId));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({
    id: doc.id,        // 🔥 REQUIRED
    ...doc.data()
}));
}

export async function getLiabilities(profileId) {
    const q = query(collection(db, "profiles", profileId, "liabilities"), where("profileId", "==", profileId));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({
    id: doc.id,        // 🔥 REQUIRED
    ...doc.data()
}));
}
