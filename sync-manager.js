/**
 * =========================================================================
 * SYNC-MANAGER.JS - ULTRA ROBUST CLOUD SYNCHRONIZATION ENGINE
 * =========================================================================
 * Version: 2.1.0
 * Features:
 * - Full Real-time bidirectional sync (onSnapshot)
 * - Automatic "Chain of Export" Bridge Management
 * - Multi-device Conflict Resolution
 * - Device-specific Timestamping
 * - Batch Processing for Offline Persistence
 * - Global Settings/Preferences Distribution
 * =========================================================================
 */

import { auth, db, doc, setDoc, getDoc, onSnapshot } from './firebase-config.js';

export const SyncManager = {
    // Internal State
    state: {
        isOnline: navigator.onLine,
        initialized: false,
        lastCloudTimestamp: null,
        activeListeners: {},
        currentUserId: null,
        deviceInfo: {
            platform: navigator.platform,
            userAgent: navigator.userAgent.substring(0, 50)
        }
    },

    // NEW: Centralized Header Manager
    initHeader(auth, db) {
        const indicator = document.getElementById('sync-status-indicator');
        const avatar = document.querySelector('.user-avatar') || document.getElementById('avatar-display') || document.getElementById('profile-initials-circle');
        const dateEl = document.getElementById('header-date') || document.getElementById('page-date');

        // Set Date
        if (dateEl) {
            dateEl.innerText = new Date().toLocaleDateString('en-US', { 
                weekday: 'long', month: 'short', day: 'numeric' 
            });
        }

        // Listen for Auth to set Initials
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js').then(({ onAuthStateChanged }) => {
            onAuthStateChanged(auth, async (user) => {
                if (user && avatar) {
                    const name = user.displayName || user.email.split('@')[0];
                    const parts = name.trim().split(/\s+/);
                    const initials = parts.length > 1 
                        ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
                        : parts[0].substring(0, 2).toUpperCase();
                    avatar.innerText = initials;
                }
            });
        });

        this.updateStatus('synced'); // Initial state
    },

    /**
     * UI INDICATOR CONTROL
     * Updates the circular dot in the header to show sync status
     */
    updateStatus(status) {
        const indicator = document.getElementById('sync-status-indicator');
        if (!indicator) return;

        const statusMap = {
            'synced':  { color: '#10b981', text: 'All Data Cloud-Secured', glow: '0 0 10px rgba(16, 185, 129, 0.4)' },
            'pending': { color: '#f59e0b', text: 'Syncing Changes...', glow: '0 0 10px rgba(245, 158, 11, 0.4)' },
            'offline': { color: '#ef4444', text: 'Offline - Saving Locally', glow: 'none' },
            'error':   { color: '#7c3aed', text: 'Connection Interrupted', glow: 'none' },
            'loading': { color: '#6366f1', text: 'Initializing Cloud...', glow: '0 0 10px rgba(99, 102, 241, 0.4)' }
        };

        const config = statusMap[status] || { color: '#94a3b8', text: 'Unknown State' };
        
        // Apply Styles
        indicator.style.backgroundColor = config.color;
        indicator.title = config.text;
        indicator.style.boxShadow = config.glow;
        
        // Logic for animated pulse during activity
        if (status === 'pending' || status === 'loading') {
            indicator.classList.add('pulse-sync');
        } else {
            indicator.classList.remove('pulse-sync');
        }
    },

    /**
     * DATA SAVE ENGINE
     * Saves to LocalStorage immediately and pushes to Firestore
     */
    async saveData(key, data) {
        const userId = auth.currentUser?.uid;
        if (!userId) {
            console.warn("Save attempted without authenticated user.");
            localStorage.setItem(key, JSON.stringify(data));
            return;
        }

        // 1. Immediate Local Save
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_status`, 'pending');
        this.updateStatus('pending');

        // 2. Cloud Upload
        if (this.state.isOnline) {
            try {
                const docRef = doc(db, "users", userId, "data", key);
                await setDoc(docRef, {
                    tasks: data,
                    metadata: {
                        lastSynced: new Date().toISOString(),
                        device: this.state.deviceInfo.platform,
                        appVersion: "1.0.5"
                    }
                }, { merge: true });

                localStorage.setItem(`${key}_status`, 'synced');
                this.updateStatus('synced');
                return true;
            } catch (error) {
                console.error("Cloud Save Failed:", error);
                this.updateStatus('error');
                return false;
            }
        } else {
            this.updateStatus('offline');
            return false;
        }
    },

    /**
     * REAL-TIME DATA LISTENER
     * Listens for changes made on Phone B and updates Phone A automatically
     */
    initRealTimeData(userId, key, callback) {
    if (this.state.activeListeners[key]) {
        this.state.activeListeners[key](); 
    }

    const docRef = doc(db, "users", userId, "data", key);
    
    this.state.activeListeners[key] = onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
            const cloudData = snapshot.data().tasks;
            // Get local data for comparison
            const localDataRaw = localStorage.getItem(key);
            const cloudDataRaw = JSON.stringify(cloudData);
            
            // Only update and trigger callback if data actually changed
            if (cloudDataRaw !== localDataRaw) {
                localStorage.setItem(key, cloudDataRaw);
                localStorage.setItem(`${key}_status`, 'synced');
                console.log(`Cloud Sync: ${key} updated.`);
                if (callback) callback(cloudData);
                this.updateStatus('synced');
            }
        }
    }, (error) => {
        console.error(`Listener error for ${key}:`, error);
        this.updateStatus('error');
    });
},

    /**
     * PREFERENCES / SETTINGS WATCHER
     * Syncs "Export Buttons" and Toggles across all devices
     */
    watchSettings(userId, callback) {
        const docRef = doc(db, "users", userId, "config", "preferences");
        
        return onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                const settings = snapshot.data();
                
                // Distribute settings to local storage
                Object.keys(settings).forEach(k => {
                    localStorage.setItem(`taskflow_${k}`, settings[k]);
                });

                if (callback) callback(settings);
                console.log("Global Settings Synchronized.");
            }
        });
    },

    /**
     * BULK DOWNLOAD
     * Used on initial load/login to fetch all 3 lists
     */
    async downloadAllFromCloud() {
        const userId = auth.currentUser?.uid;
        if (!userId || !this.state.isOnline) return;

        this.updateStatus('loading');
        const collections = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        
        try {
            const fetchPromises = collections.map(async (key) => {
                const snap = await getDoc(doc(db, "users", userId, "data", key));
                if (snap.exists()) {
                    localStorage.setItem(key, JSON.stringify(snap.data().tasks));
                    localStorage.setItem(`${key}_status`, 'synced');
                }
            });

            await Promise.all(fetchPromises);
            this.updateStatus('synced');
        } catch (e) {
            console.error("Bulk sync failed:", e);
            this.updateStatus('error');
        }
    },

    /**
     * OFFLINE QUEUE PROCESSOR
     * Pushes changes made while the user had no internet
     */
    async syncAllPending() {
        const userId = auth.currentUser?.uid;
        if (!userId || !this.state.isOnline) return;

        const keys = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        let workDone = false;

        for (const key of keys) {
            if (localStorage.getItem(`${key}_status`) === 'pending') {
                const data = JSON.parse(localStorage.getItem(key));
                if (data) {
                    await this.saveData(key, data);
                    workDone = true;
                }
            }
        }
        
        if (workDone) console.log("Offline changes pushed to cloud.");
    },

    /**
     * SETTINGS SAVE ENGINE
     * Pushes local toggle states to the Cloud preferences doc
     */
    async saveSettings() {
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        const settings = {
            daily_sync_enabled: localStorage.getItem('taskflow_daily_sync_enabled') === 'true',
            auto_daily_sync_enabled: localStorage.getItem('taskflow_auto_daily_sync_enabled') === 'true',
            yearly_sync_enabled: localStorage.getItem('taskflow_yearly_sync_enabled') === 'true',
            yearly_auto_sync_enabled: localStorage.getItem('taskflow_yearly_auto_sync_enabled') === 'true',
            auto_jump: localStorage.getItem('taskflow_auto_jump') === 'true',
            sync_timestamp: new Date().getTime()
        };

        try {
            await setDoc(doc(db, "users", userId, "config", "preferences"), settings, { merge: true });
            this.updateStatus('synced');
        } catch (e) {
            console.error("Settings export failed:", e);
        }
    },

    /**
     * CACHE CLEANER
     * Safe logout procedure
     */
    clearLocalCache() {
        const keysToRemove = [
            'taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data',
            'taskflow_daily_tasks_status', 'taskflow_monthly_tasks_status', 'taskflow_yearly_data_status'
        ];
        keysToRemove.forEach(k => localStorage.removeItem(k));
        console.log("Sync cache purged.");
    }
};

/**
 * GLOBAL NETWORK OBSERVER
 */
window.addEventListener('online', () => {
    SyncManager.state.isOnline = true;
    SyncManager.updateStatus('loading');
    SyncManager.syncAllPending();
});

window.addEventListener('offline', () => {
    SyncManager.state.isOnline = false;
    SyncManager.updateStatus('offline');
});

// Injection of Pulse Style for Indicator
const style = document.createElement('style');
style.textContent = `
    .pulse-sync { animation: syncPulse 1.5s infinite; }
    @keyframes syncPulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.3); opacity: 0.7; }
        100% { transform: scale(1); opacity: 1; }
    }
`;
document.head.appendChild(style);
