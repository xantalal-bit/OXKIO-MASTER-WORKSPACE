import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  browserLocalPersistence,
  initializeAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyDFySiO23mqJilJPUfE-dLv9Zbs9gcY_kg",
  authDomain: "oxkio-9af40.firebaseapp.com",
  projectId: "oxkio-9af40",
  storageBucket: "oxkio-9af40.firebasestorage.app",
  messagingSenderId: "975887789346",
  appId: "1:975887789346:web:fa581107285b989d90897b"
});
const firebaseAuth = initializeAuth(firebaseApp, {
  persistence: browserLocalPersistence
});
let resolveAuthReady;
window.oxkioAuthReady = new Promise((resolve) => { resolveAuthReady = resolve; });

onAuthStateChanged(firebaseAuth, (user) => {
  if (!user) {
    window.location.replace("/");
    return;
  }
  resolveAuthReady(user);
});

window.oxkioAuthenticatedFetch = async function(url, options = {}, retry = true) {
  const user = await window.oxkioAuthReady;
  const token = await user.getIdToken(!retry);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry) {
    return window.oxkioAuthenticatedFetch(url, options, false);
  }
  if (response.status === 401) window.location.replace("/");
  return response;
};
