/**
 * =========================================================================
 * SYNC-MANAGER.JS - ULTRA ROBUST CLOUD SYNCHRONIZATION ENGINE
 * =========================================================================
 * Version: 3.0.0
 * Features:
 * - Full Real-time bidirectional sync (onSnapshot)
 * - Hourly Recurring Push Notifications for Yearly Tasks
 * - Global Header Sync (Indicator + Initials)
 * - Multi-device Conflict Resolution
 * - Batch Processing for Offline Persistence
 * - Global Settings distribution
 * =========================================================================
 */

import { auth, db, doc, setDoc, getDoc, onSnapshot } from './firebase-config.js';

export const SyncManager = {
    // Internal State
    state: {
        isOnline: navigator.onLine,
        initialized: false,
        activeListeners: {},
        currentUserId: null,
        notifInterval: null,
        deviceInfo: {
            platform: navigator.platform,
            userAgent: navigator.userAgent.substring(0, 50)
        }
    },

    /**
     * ─── HEADER & UI INITIALIZATION ───
     * Synchronizes Initials and Sync Dot across all pages
     */
    initHeader(auth) {
        // 1. Set Global Date for any page with these IDs
        const dateEl = document.getElementById('header-date') || 
                       document.getElementById('page-date') || 
                       document.getElementById('current-year-display');
        
        if (dateEl) {
            dateEl.innerText = new Date().toLocaleDateString('en-US', { 
                weekday: 'long', month: 'short', day: 'numeric' 
            });
        }

        // 2. Initial Status
        this.updateStatus(this.state.isOnline ? 'synced' : 'offline');

        // 3. Listen for Auth to set Initials and start Notification Engine
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js').then(({ onAuthStateChanged }) => {
            onAuthStateChanged(auth, async (user) => {
                const avatar = document.querySelector('.user-avatar') || 
                               document.getElementById('avatar-display') || 
                               document.getElementById('profile-initials-circle');

                if (user) {
                    // Calculate Initials
                    const name = user.displayName || user.email.split('@')[0];
                    const parts = name.trim().split(/\s+/);
                    const initials = parts.length > 1 
                        ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
                        : parts[0].substring(0, 2).toUpperCase();
                    
                    if (avatar) avatar.innerText = initials;
                    
                    // Start the Push Notification System
                    this.startNotificationEngine();
                } else {
                    if (avatar) avatar.innerText = "U";
                }
            });
        });
    },

    /**
     * ─── SYNC STATUS INDICATOR ───
     */
    updateStatus(status) {
        const indicator = document.getElementById('sync-status-indicator');
        if (!indicator) return;

        const statusMap = {
            'synced':  { color: '#10b981', glow: '0 0 10px rgba(16, 185, 129, 0.4)' },
            'pending': { color: '#f59e0b', glow: '0 0 12px rgba(245, 158, 11, 0.6)' },
            'offline': { color: '#ef4444', glow: 'none' },
            'error':   { color: '#7c3aed', glow: 'none' },
            'loading': { color: '#6366f1', glow: '0 0 10px rgba(99, 102, 241, 0.4)' }
        };

        const config = statusMap[status] || { color: '#94a3b8', glow: 'none' };
        indicator.style.backgroundColor = config.color;
        indicator.style.boxShadow = config.glow;
        
        if (status === 'pending' || status === 'loading') {
            indicator.classList.add('pulse-sync');
        } else {
            indicator.classList.remove('pulse-sync');
        }
    },

    /**
     * ─── HOURLY PUSH NOTIFICATION ENGINE ───
     * Monitors Yearly Tasks and sends reminders every hour if not completed
     */
    startNotificationEngine() {
        if (this.state.notifInterval) return;

        // Request Permission
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

        // Check every 60 seconds
        this.state.notifInterval = setInterval(() => {
            this.checkYearlyTasksForNotifications();
        }, 60000);

        // Initial check on load
        this.checkYearlyTasksForNotifications();
    },

    checkYearlyTasksForNotifications() {
        if (!("Notification" in window) || Notification.permission !== "granted") return;

        const yearlyData = JSON.parse(localStorage.getItem('taskflow_yearly_data')) || {};
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentDay = now.getDate();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();

        const todaysTasks = yearlyData[currentMonth] || [];

        todaysTasks.forEach(task => {
            // Only remind if task is NOT completed and belongs to TODAY
            if (task.completed || task.day !== currentDay) return;

            // Get task time (default to 11:30 AM if not set)
            const [tHour, tMin] = (task.time || "11:30").split(':').map(Number);
            
            const taskTotalMins = (tHour * 60) + tMin;
            const currentTotalMins = (currentHour * 60) + currentMin;

            // Is it time?
            if (currentTotalMins >= taskTotalMins) {
                const lastNotifiedKey = `tf_notif_last_${task.id}`;
                const lastNotified = localStorage.getItem(lastNotifiedKey);
                const oneHour = 60 * 60 * 1000;

                // Send if never notified OR if 1 hour has passed
                if (!lastNotified || (Date.now() - parseInt(lastNotified)) > oneHour) {
                    this.sendPushNotification(task);
                    localStorage.setItem(lastNotifiedKey, Date.now().toString());
                }
            }
        });
    },

    sendPushNotification(task) {
        new Notification("Task & Grow: Yearly Task", {
            body: `Reminder: "${task.text}" is due. Please complete this goal!`,
            icon: 'app-logo.png', // Ensure this path is correct
            tag: task.id, // Group notifications by task ID
            requireInteraction: true // Stays on screen like WhatsApp until dismissed
        });
    },

    /**
     * ─── DATA SAVE & CLOUD PUSH ───
     */
    async saveData(key, data) {
        const userId = auth.currentUser?.uid;
        localStorage.setItem(key, JSON.stringify(data));

        if (!userId) return;

        localStorage.setItem(`${key}_status`, 'pending');
        this.updateStatus('pending');

        if (this.state.isOnline) {
            try {
                const docRef = doc(db, "users", userId, "data", key);
                await setDoc(docRef, {
                    tasks: data,
                    metadata: { lastSynced: new Date().toISOString() }
                }, { merge: true });

                localStorage.setItem(`${key}_status`, 'synced');
                this.updateStatus('synced');
            } catch (error) {
                console.error("Cloud Save Error:", error);
                this.updateStatus('error');
            }
        } else {
            this.updateStatus('offline');
        }
    },

    /**
     * ─── REAL-TIME BI-DIRECTIONAL SYNC ───
     */
    initRealTimeData(userId, key, callback) {
        if (this.state.activeListeners[key]) this.state.activeListeners[key]();

        const docRef = doc(db, "users", userId, "data", key);
        this.state.activeListeners[key] = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const cloudData = snapshot.data().tasks;
                const localDataRaw = localStorage.getItem(key);
                
                if (JSON.stringify(cloudData) !== localDataRaw) {
                    localStorage.setItem(key, JSON.stringify(cloudData));
                    localStorage.setItem(`${key}_status`, 'synced');
                    if (callback) callback(cloudData);
                    this.updateStatus('synced');
                }
            }
        });
    },

    /**
     * ─── SETTINGS & PREFERENCES SYNC ───
     */
    watchSettings(userId, callback) {
        const docRef = doc(db, "users", userId, "config", "preferences");
        return onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const settings = snapshot.data();
                Object.keys(settings).forEach(k => {
                    localStorage.setItem(`taskflow_${k}`, settings[k]);
                });
                if (callback) callback(settings);
                this.updateStatus('synced');
            }
        });
    },

    async saveSettings() {
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        const settings = {
            daily_sync_enabled: localStorage.getItem('taskflow_daily_sync_enabled') === 'true',
            auto_daily_sync_enabled: localStorage.getItem('taskflow_auto_daily_sync_enabled') === 'true',
            yearly_sync_enabled: localStorage.getItem('taskflow_yearly_sync_enabled') === 'true',
            auto_jump: localStorage.getItem('taskflow_auto_jump') === 'true'
        };

        try {
            await setDoc(doc(db, "users", userId, "config", "preferences"), settings, { merge: true });
        } catch (e) { console.error("Settings Sync Failed:", e); }
    },

    /**
     * ─── INITIAL LOAD / LOGIN SYNC ───
     */
    async downloadAllFromCloud() {
        const userId = auth.currentUser?.uid;
        if (!userId || !this.state.isOnline) return;

        this.updateStatus('loading');
        const collections = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        
        try {
            for (const key of collections) {
                const snap = await getDoc(doc(db, "users", userId, "data", key));
                if (snap.exists()) {
                    localStorage.setItem(key, JSON.stringify(snap.data().tasks));
                    localStorage.setItem(`${key}_status`, 'synced');
                }
            }
            this.updateStatus('synced');
        } catch (e) { this.updateStatus('error'); }
    },

    /**
     * ─── OFFLINE RESILIENCE ───
     */
    async syncAllPending() {
        const userId = auth.currentUser?.uid;
        if (!userId || !this.state.isOnline) return;

        const keys = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        for (const key of keys) {
            if (localStorage.getItem(`${key}_status`) === 'pending') {
                const data = JSON.parse(localStorage.getItem(key));
                if (data) await this.saveData(key, data);
            }
        }
    },

    clearLocalCache() {
        const keys = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        keys.forEach(k => {
            localStorage.removeItem(k);
            localStorage.removeItem(`${k}_status`);
        });
    }
};

/**
 * ─── NETWORK EVENT LISTENERS ───
 */
window.addEventListener('online', () => {
    SyncManager.state.isOnline = true;
    SyncManager.syncAllPending();
});

window.addEventListener('offline', () => {
    SyncManager.state.isOnline = false;
    SyncManager.updateStatus('offline');
});

/**
 * ─── DYNAMIC CSS FOR PULSE ───
 */
const syncStyle = document.createElement('style');
syncStyle.textContent = `
    .pulse-sync { animation: tfSyncPulse 1.8s infinite; }
    @keyframes tfSyncPulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.4); opacity: 0.6; }
        100% { transform: scale(1); opacity: 1; }
    }
`;
document.head.appendChild(syncStyle);
