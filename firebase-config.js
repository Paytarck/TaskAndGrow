// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAiLZk2200Ud_MHDFUTBQAZHNdYjeypTy4",
    authDomain: "taskandgrow.firebaseapp.com",
    projectId: "taskandgrow",
    storageBucket: "taskandgrow.firebasestorage.app",
    messagingSenderId: "771996590937",
    appId: "1:771996590937:web:8599264fde06ff60e92248",
    measurementId: "G-134MDQXQW4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export everything in one line. Do NOT add "export { auth }" again below.
export { auth, db, doc, setDoc, getDoc, onSnapshot };