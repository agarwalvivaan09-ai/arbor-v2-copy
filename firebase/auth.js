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
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  RecaptchaVerifier,
  signInWithPhoneNumber,
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

// GOOGLE / APPLE — popup first; fall back to a full-page redirect when
// popups are blocked (common on mobile Safari).
async function withProvider(provider) {
  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
      return await signInWithRedirect(auth, provider);
    }
    throw error;
  }
}

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return withProvider(provider);
}

export function signInWithApple() {
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return withProvider(provider);
}

// Completes a redirect sign-in after the page reloads (no-op otherwise).
export function completeRedirect() {
  return getRedirectResult(auth).catch(error => { throw error; });
}

// PHONE (SMS one-time code). The invisible reCAPTCHA protects against abuse.
let verifier = null;
export async function sendPhoneCode(phoneNumber, buttonId) {
  if (!verifier) verifier = new RecaptchaVerifier(auth, buttonId, { size: "invisible" });
  try {
    return await signInWithPhoneNumber(auth, phoneNumber, verifier);
  } catch (error) {
    verifier.clear();
    verifier = null;
    throw error;
  }
}

export function resetPhoneVerifier() {
  if (verifier) { try { verifier.clear(); } catch { /* already cleared */ } }
  verifier = null;
}

export async function logout() {
  return await signOut(auth);
}

export function observeAuth(callback) {
  onAuthStateChanged(auth, callback);
}
