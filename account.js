import { SyncManager } from './sync-manager.js';
import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ── State ──
let currentView = 'selection'; // 'selection', 'auth', 'success'
let pendingConfirmCallback = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    // Dynamic Date Logic
    const options = { weekday: 'long', month: 'short', day: 'numeric' };
    const today = new Date().toLocaleDateString('en-US', options);
    document.getElementById('header-date').innerText = today;

    setupPasswordStrength();
});

// ── View Navigation ──
function showAuthView(mode) {
    currentView = 'auth';
    document.getElementById('view-selection').style.display = 'none';
    document.getElementById('view-success').style.display = 'none';
    document.getElementById('view-auth').style.display = 'block';

    const modeIsLogin = mode === 'login';
    document.getElementById('tab-login').classList.toggle('active', modeIsLogin);
    document.getElementById('tab-register').classList.toggle('active', !modeIsLogin);
    document.getElementById('form-login').style.display = modeIsLogin ? 'block' : 'none';
    document.getElementById('form-register').style.display = modeIsLogin ? 'none' : 'block';
    document.getElementById('auth-title').innerText = modeIsLogin ? "Sign In" : "Create Account";
}

function showSelectionView() {
    currentView = 'selection';
    document.getElementById('view-selection').style.display = 'block';
    document.getElementById('view-auth').style.display = 'none';
    document.getElementById('view-success').style.display = 'none';
}

function showSuccessView(name, email) {
    currentView = 'success';
    document.getElementById('view-auth').style.display = 'none';
    document.getElementById('view-success').style.display = 'block';
    document.getElementById('user-display-name').innerText = name;
    document.getElementById('user-display-email').innerText = email;
    document.getElementById('avatar-display').innerText = name.charAt(0).toUpperCase();
}

// ── Password Strength ──
function setupPasswordStrength() {
    const regPass = document.getElementById('reg-password');
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');

    if (!regPass) return;

    regPass.addEventListener('input', () => {
        const val = regPass.value;
        if (val.length === 0) {
            fill.style.width = '0%';
            text.innerText = "Strength: None";
        } else if (val.length < 7) {
            fill.style.width = '35%';
            fill.style.background = '#ff6b6b';
            text.innerText = "Strength: Weak (Min. 7)";
        } else {
            fill.style.width = '100%';
            fill.style.background = '#10b981';
            text.innerText = "Strength: Strong";
        }
    });
}

// ── Login Handler ──
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showToast('Please fill in all fields');
        return;
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const firstName = user.displayName || email.split('@')[0];
        
        // Download data from cloud on successful login
        await SyncManager.loadSettings();
        await SyncManager.downloadAllFromCloud();
        
        showSuccessView(firstName, email);
        showToast('Login successful! 🎉');
    } catch (error) {
        handleAuthError(error);
    }
}

// ── Register Handler ──
async function handleRegister(e) {
    e.preventDefault();
    const fname = document.getElementById('reg-fname').value.trim();
    const lname = document.getElementById('reg-lname').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    // Validation
    if (!fname || !email || !password) {
        showToast('Please fill in all required fields');
        return;
    }

    if (password.length < 7) {
        showToast('Password must be at least 7 characters');
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Initialize cloud settings for new user
        await SyncManager.saveSettings();
        
        showSuccessView(fname, email);
        showToast('Account created successfully! 🎉');
    } catch (error) {
        handleAuthError(error);
    }
}

// ── Auth Error Handler ──
function handleAuthError(error) {
    const errorCode = error.code;
    const errorMessage = error.message;
    
    let userMessage = 'An error occurred';
    
    if (errorCode === 'auth/email-already-in-use') {
        userMessage = 'Email already in use';
    } else if (errorCode === 'auth/invalid-email') {
        userMessage = 'Invalid email address';
    } else if (errorCode === 'auth/weak-password') {
        userMessage = 'Password is too weak';
    } else if (errorCode === 'auth/user-not-found') {
        userMessage = 'User not found';
    } else if (errorCode === 'auth/wrong-password') {
        userMessage = 'Incorrect password';
    } else if (errorCode === 'auth/network-request-failed') {
        userMessage = 'Network error - check your connection';
    }
    
    showToast(userMessage);
    console.error('Auth error:', errorCode, errorMessage);
}

// ── Manual Sync Handler ──
async function handleManualSync() {
    const statusText = document.getElementById('sync-status');
    const btn = document.querySelector('#sync-now-card .btn-submit');
    
    if (!navigator.onLine) {
        showToast("You are currently offline. Please connect to the internet to sync.");
        return;
    }

    if (!auth.currentUser) {
        showToast("Please log in first to sync data");
        return;
    }

    btn.innerText = "Syncing...";
    statusText.innerText = "Syncing...";
    
    try {
        await SyncManager.syncAllPending();
        btn.innerText = "Sync Now";
        statusText.innerText = "All data is up to date in the cloud! ✅";
        showToast("Sync completed successfully!");
    } catch (e) {
        console.error('Sync error:', e);
        btn.innerText = "Sync Now";
        statusText.innerText = "Sync failed. Try again later.";
        showToast("Sync failed. Please try again.");
    }
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(99, 102, 241, 0.9);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 600;
        z-index: 1000;
        animation: slideUp 0.3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// Make functions globally accessible
window.showAuthView = showAuthView;
window.showSelectionView = showSelectionView;
window.showSuccessView = showSuccessView;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleManualSync = handleManualSync;

// Add styles for animations
const style = document.createElement('style');
style.textContent = `
@keyframes slideUp {
    from { transform: translateX(-50%) translateY(20px); opacity: 0; }
    to { transform: translateX(-50%) translateY(0); opacity: 1; }
}
@keyframes slideDown {
    from { transform: translateX(-50%) translateY(0); opacity: 1; }
    to { transform: translateX(-50%) translateY(20px); opacity: 0; }
}
`;
document.head.appendChild(style);
