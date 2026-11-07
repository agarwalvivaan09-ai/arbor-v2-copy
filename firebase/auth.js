import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  useDeviceLanguage
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { app } from "./db.js";

const auth = getAuth(app);
useDeviceLanguage(auth);

// "Keep me signed in": local persistence survives browser restarts.
export async function setRemember(remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

// EMAIL + PASSWORD
export async function signUp(email, password, name = "") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  // best effort: a failed verification email must not block sign-up
  sendEmailVerification(cred.user).catch(() => {});
  return cred;
}

export async function login(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

export async function resetPassword(email) {
  return await sendPasswordResetEmail(auth, email);
}

// GOOGLE — popup only.
// Must be called straight from the click handler (no awaits before it), or
// Safari treats the popup as unrequested and blocks it.
// No redirect fallback: Arbor is served from github.io while Firebase's auth
// domain is firebaseapp.com, and current Safari/Chrome/Firefox block the
// cross-site storage a redirect relies on, so a redirect would silently
// return the user signed out. A blocked popup is reported instead.
function withProvider(provider) {
  return signInWithPopup(auth, provider);
}

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return withProvider(provider);
}


// Completes a redirect sign-in after the page reloads (no-op otherwise).
export function completeRedirect() {
  return getRedirectResult(auth).catch(error => { throw error; });
}


export async function logout() {
  return await signOut(auth);
}

export function observeAuth(callback) {
  onAuthStateChanged(auth, callback);
}

// Email verification — needed to accept a family invite.
export async function resendVerification() {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

// Re-reads the signed-in user (and refreshes the token) after they verify
// their email in another tab, so the new status takes effect immediately.
export async function refreshUser() {
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}
