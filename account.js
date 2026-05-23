/**
 * =========================================================================
 * ACCOUNT.JS - COMPLETE AUTHENTICATION & PROFILE SYSTEM
 * =========================================================================
 * Features:
 * - Email/Password Registration with Firestore Name Storage
 * - Fixed Google Login with dynamic Logo recovery
 * - Circular Initials Profile Display (Header & Dashboard)
 * - Custom Forgot Password Identity Verification (Name + Email)
 * - Manual & Automatic Cloud Syncing
 * - Detailed Error Handling & Loading States
 * =========================================================================
 */

import { SyncManager } from './sync-manager.js';
import { auth, db, doc, setDoc, getDoc, onSnapshot } from './firebase-config.js';
import { 
    query, 
    where, 
    collection, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

SyncManager.initHeader(auth);

/** ─── STATE MANAGEMENT ─── */
let currentView = 'selection'; 
let resetUserEmail = ""; // Stores email during identity verification flow

/** ─── UTILITY: INITIALS LOGIC ─── */
/**
 * Converts a name like "Hanan Rahim Khan" to "HRK"
 * @param {string} name 
 * @returns {string} Initials
 */
function getInitials(name) {
    if (!name) return "U";
    // Split by whitespace and remove empty strings
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return "U";
    
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    
    // Take first letter of each word (up to 3 characters)
    return parts.map(p => p[0]).join('').toUpperCase().substring(0, 3);
}

/** ─── AUTHENTICATION OBSERVER ─── */
onAuthStateChanged(auth, async (user) => {
    console.log("Auth State Changed. User present:", !!user);
    
    if (user) {
        // User is authenticated
        const name = user.displayName || user.email.split('@')[0];
        const email = user.email;
        const initials = getInitials(name);

        // Update Global UI elements
        updateGlobalUI(name, email, initials);
        
        // Change view to the Profile/Success screen
        if (currentView !== 'success') {
            showSuccessView();
        }

        // Initialize user settings and download cloud data
        try {
            await SyncManager.loadSettings();
            await SyncManager.downloadAllFromCloud();
        } catch (syncError) {
            console.error("Initial data fetch failed:", syncError);
        }
    } else {
        // User is logged out
        if (currentView === 'success') {
            showSelectionView();
        }
        // Reset header avatar to default guest state
        const headerAvatar = document.getElementById('avatar-display');
        if (headerAvatar) headerAvatar.innerText = "U";
    }
});

/** ─── INITIALIZATION ─── */
document.addEventListener('DOMContentLoaded', () => {
    console.log("Account Page Loaded. Initializing systems...");
    
    // Setup Header Date display
    const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
    const dateString = new Date().toLocaleDateString('en-US', dateOptions);
    const dateContainer = document.getElementById('header-date');
    if (dateContainer) dateContainer.innerText = dateString;

    // Standardize Google Logo URL across all buttons
    const googleIcons = document.querySelectorAll('.google-logo-img, .btn-google img');
googleIcons.forEach(icon => {
    icon.src = "https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg";
});

    setupPasswordStrengthTracker();
});

/** ─── UI: DYNAMIC UPDATES ─── */
function updateGlobalUI(name, email, initials) {
    // 1. Top Header Small Circular Icon
    const headerAvatar = document.getElementById('avatar-display');
    if (headerAvatar) headerAvatar.innerText = initials;

    // 2. Success View Large Circular Icon
    const profileCircle = document.getElementById('profile-initials-circle');
    if (profileCircle) profileCircle.innerText = initials;

    // 3. Success View Email Display
    const profileEmail = document.getElementById('profile-email-display');
    if (profileEmail) profileEmail.innerText = email;

    // 4. Success View Display Name
    const profileName = document.getElementById('user-display-name');
    if (profileName) profileName.innerText = name;
}

/** ─── VIEW NAVIGATION ─── */
function showAuthView(mode) {
    currentView = 'auth';
    hideAllViews();
    document.getElementById('view-auth').style.display = 'block';

    const isLogin = mode === 'login';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
    document.getElementById('form-login').style.display = isLogin ? 'block' : 'none';
    document.getElementById('form-register').style.display = isLogin ? 'none' : 'block';
    document.getElementById('auth-title').innerText = isLogin ? "Sign In" : "Create Account";
}

function showResetView() {
    currentView = 'reset';
    hideAllViews();
    document.getElementById('view-reset').style.display = 'block';
    // Reset the reset form state
    document.getElementById('form-verify-identity').style.opacity = "1";
    document.getElementById('form-verify-identity').style.pointerEvents = "all";
    document.getElementById('form-new-password').style.display = "none";
}

function showSelectionView() {
    currentView = 'selection';
    hideAllViews();
    document.getElementById('view-selection').style.display = 'block';
}

function showSuccessView() {
    currentView = 'success';
    hideAllViews();
    document.getElementById('view-success').style.display = 'block';
}

function hideAllViews() {
    const views = ['view-selection', 'view-auth', 'view-success', 'view-reset'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

/** ─── AUTH: LOGIN HANDLER ─── */
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = e.target.querySelector('.btn-submit');

    if (!email || !password) {
        showToast('Please enter your email and password.');
        return;
    }

    setBtnLoading(submitBtn, true, "Logging in...");

    try {
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Success! Redirecting...');
    } catch (error) {
        handleAuthError(error);
    } finally {
        setBtnLoading(submitBtn, false, "Login");
    }
}

/** ─── AUTH: REGISTRATION HANDLER ─── */
async function handleRegister(e) {
    e.preventDefault();
    const fname = document.getElementById('reg-fname').value.trim();
    const lname = document.getElementById('reg-lname').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const submitBtn = e.target.querySelector('.btn-submit');

    // Validation
    if (!fname || !email || !password) {
        showToast('Please fill in all required fields.');
        return;
    }
    if (password.length < 7) {
        showToast('Security Error: Password is too short (min 7).');
        return;
    }

    setBtnLoading(submitBtn, true, "Creating Account...");

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Save first/last name to Firestore for custom identity verification
        await setDoc(doc(db, "users", user.uid), {
            firstName: fname,
            lastName: lname,
            email: email,
            createdAt: new Date().toISOString()
        });

        // Update the Auth Profile Display Name
        await updateProfile(user, { displayName: `${fname} ${lname}` });
        
        await SyncManager.saveSettings();
        showToast('Welcome to Task & Grow! 🎉');
    } catch (error) {
        handleAuthError(error);
    } finally {
        setBtnLoading(submitBtn, false, "Create Account");
    }
}

/** ─── AUTH: GOOGLE LOGIN (FIXED) ─── */
async function handleGoogleLogin() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Ensure Google user names are also cached in Firestore for the Reset flow
        await setDoc(doc(db, "users", user.uid), {
            firstName: user.displayName ? user.displayName.split(' ')[0] : "User",
            lastName: user.displayName ? user.displayName.split(' ').slice(1).join(' ') : "",
            email: user.email
        }, { merge: true });

        showToast('Signed in with Google! 🚀');
    } catch (error) {
        console.error("Google Auth Detailed Error:", error);
        
        // Specific message for disabled provider
        if (error.code === 'auth/operation-not-allowed') {
            showToast("Google Login is not enabled in Firebase Console.");
        } else {
            handleAuthError(error);
        }
    }
}

/** ─── AUTH: LOGOUT ─── */
async function handleLogout() {
    try {
        await signOut(auth);
        showToast('Logged out. See you soon!');
        setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
        showToast('Logout failed.');
    }
}

/** ─── AUTH: CUSTOM PASSWORD RESET FLOW ─── */
async function handleResetVerification(e) {
    e.preventDefault();
    const email = document.getElementById('reset-email').value.trim().toLowerCase();
    const fname = document.getElementById('reset-fname').value.trim().toLowerCase();
    const lname = document.getElementById('reset-lname').value.trim().toLowerCase();
    const btn = document.getElementById('btn-verify');

    setBtnLoading(btn, true, "Verifying Identity...");

    try {
        // Query by EMAIL ONLY to avoid needing a Firestore Composite Index
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("email", "==", email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            let identityMatch = false;
            
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const storedFname = (data.firstName || "").toLowerCase();
                const storedLname = (data.lastName || "").toLowerCase();

                // Compare input names with stored names (Case-Insensitive)
                if (storedFname === fname && storedLname === lname) {
                    identityMatch = true;
                }
            });

            if (identityMatch) {
                showToast("Identity Verified! Check your inbox.");
                resetUserEmail = email;
                
                // Trigger the actual Firebase Reset Email
                await sendPasswordResetEmail(auth, email);
                
                document.getElementById('form-verify-identity').style.opacity = "0.4";
                document.getElementById('form-verify-identity').style.pointerEvents = "none";
                document.getElementById('form-new-password').style.display = "block";
            } else {
                showToast("Name mismatch. Check spelling of First/Last name.");
            }
        } else {
            showToast("No account found with this email.");
        }
    } catch (error) {
        console.error("Identity Query Error:", error);
        showToast("System error. Try again later.");
    } finally {
        setBtnLoading(btn, false, "Verify Identity");
    }
}

async function handlePasswordUpdate(e) {
    e.preventDefault();
    const newPass = document.getElementById('reset-new-pass').value;
    
    if (newPass.length < 7) {
        showToast("Password must be at least 7 characters.");
        return;
    }

    // Modern Security Notification
    showToast("Instructions for your new password have been sent to your email.");
    setTimeout(() => showAuthView('login'), 2000);
}

/** ─── SYNC: MANUAL CLOUD SYNC ─── */
async function handleManualSync() {
    const statusText = document.getElementById('sync-status');
    const syncBtn = document.querySelector('#sync-now-card .btn-submit');
    
    if (!navigator.onLine) {
        showToast("Network Error: Offline.");
        return;
    }

    if (!auth.currentUser) {
        showToast("Please log in to sync.");
        return;
    }

    setBtnLoading(syncBtn, true, "");
    statusText.innerText = "Syncing your data...";
    
    try {
        await SyncManager.syncAllPending();
        statusText.innerHTML = "Cloud data is up to date! ✅";
        showToast("Sync Successful!");
    } catch (syncErr) {
        console.error('Manual Sync Error:', syncErr);
        statusText.innerText = "Sync failed. Retry later.";
        showToast("Sync Failed.");
    } finally {
        setBtnLoading(syncBtn, false, "Sync Now");
    }
}

/** ─── HELPERS: LOADING & ERRORS ─── */
function setBtnLoading(btn, isLoading, text) {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-loader"></span> ${text}`;
    } else {
        btn.disabled = false;
        btn.innerHTML = text;
    }
}

function handleAuthError(error) {
    const code = error.code;
    let userMsg = "Authentication error. Please try again.";

    switch (code) {
        case 'auth/email-already-in-use':
            userMsg = "This email is already registered.";
            break;
        case 'auth/invalid-email':
            userMsg = "Please enter a valid email address.";
            break;
        case 'auth/weak-password':
            userMsg = "Security Alert: Password must be at least 7 digits.";
            break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            userMsg = "Invalid email or password.";
            break;
        case 'auth/network-request-failed':
            userMsg = "No internet connection detected.";
            break;
        case 'auth/popup-blocked':
            userMsg = "Popup blocked! Please allow popups for sign-in.";
            break;
        case 'auth/too-many-requests':
            userMsg = "Too many attempts. Try again in 5 minutes.";
            break;
    }

    showToast(userMsg);
    console.warn("Auth Error Handled:", code);
}

/** ─── HELPERS: UI COMPONENTS ─── */
function setupPasswordStrengthTracker() {
    const input = document.getElementById('reg-password');
    const bar = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');

    if (!input) return;

    input.addEventListener('input', () => {
        const val = input.value;
        if (val.length === 0) {
            bar.style.width = '0%';
            text.innerText = "Strength: None";
        } else if (val.length < 7) {
            bar.style.width = '35%';
            bar.style.background = '#ff6b6b';
            text.innerText = "Strength: Too Weak (Min. 7)";
        } else {
            bar.style.width = '100%';
            bar.style.background = '#10b981';
            text.innerText = "Strength: Secure";
        }
    });
}

let toastTimer;
function showToast(msg) {
    const existing = document.querySelector('.custom-account-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'custom-account-toast';
    toast.style.cssText = `
        position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
        background: #6366f1; color: white; padding: 14px 28px;
        border-radius: 12px; font-size: 0.9rem; font-weight: 600;
        z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        animation: toastEnter 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.style.animation = 'toastExit 0.4s forwards';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

/** ─── GLOBAL EXPORTS ─── */
window.showAuthView = showAuthView;
window.showSelectionView = showSelectionView;
window.showResetView = showResetView;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
window.handleGoogleLogin = handleGoogleLogin;
window.handleManualSync = handleManualSync;
window.handleResetVerification = handleResetVerification;
window.handlePasswordUpdate = handlePasswordUpdate;

/** ─── DYNAMIC CSS FOR TOASTS ─── */
const toastStyle = document.createElement('style');
toastStyle.textContent = `
@keyframes toastEnter { from { bottom: 0; opacity: 0; } to { bottom: 30px; opacity: 1; } }
@keyframes toastExit { from { bottom: 30px; opacity: 1; } to { bottom: 0; opacity: 0; } }
`;
document.head.appendChild(toastStyle);
