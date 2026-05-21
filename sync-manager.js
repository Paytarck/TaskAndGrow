import { auth, db, doc, setDoc, getDoc } from './firebase-config.js';

export const SyncManager = {
    // Helper to update the visual dot/text
    updateStatus(status) {
        const indicator = document.getElementById('sync-status-indicator');
        if (!indicator) return; // Prevents "Cannot read property of null" error

        switch(status) {
            // Updated style logic (non-deprecated)
            case 'synced':
                indicator.style.backgroundColor = '#10b981'; // Green
                indicator.title = 'All data saved to cloud';
                break;
            case 'pending':
                indicator.style.backgroundColor = '#f59e0b'; // Yellow
                indicator.title = 'Syncing...';
                break;
            case 'offline':
                indicator.style.backgroundColor = '#ef4444'; // Red
                indicator.title = 'Offline - saving locally';
                break;
        }
    },

    async saveData(key, data) {
        const userId = auth.currentUser?.uid;
        
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_status`, 'pending');
        this.updateStatus('pending');

        if (navigator.onLine && userId) {
            const success = await this.uploadToCloud(userId, key, data);
            if (success) {
                localStorage.setItem(`${key}_status`, 'synced');
                this.updateStatus('synced');
            }
        } else {
            this.updateStatus('offline');
        }
    },

    async uploadToCloud(userId, key, data) {
        try {
            await setDoc(doc(db, "users", userId, "data", key), {
                tasks: data,
                lastSynced: new Date().toISOString()
            }, { merge: true });
            return true;
        } catch (error) {
            console.error("Cloud upload failed:", error);
            this.updateStatus('offline');
            return false;
        }
    },

    async downloadAllFromCloud() {
        const userId = auth.currentUser?.uid;
        if (!userId || !navigator.onLine) return;

        this.updateStatus('pending');
        const keys = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        
        try {
            for (const key of keys) {
                const docSnap = await getDoc(doc(db, "users", userId, "data", key));
                if (docSnap.exists()) {
                    localStorage.setItem(key, JSON.stringify(docSnap.data().tasks));
                }
            }
            this.updateStatus('synced');
        } catch (e) {
            this.updateStatus('offline');
        }
    },

    async syncAllPending() {
        const userId = auth.currentUser?.uid;
        if (!userId || !navigator.onLine) return;

        const keys = ['taskflow_daily_tasks', 'taskflow_monthly_tasks', 'taskflow_yearly_data'];
        for (const key of keys) {
            if (localStorage.getItem(`${key}_status`) === 'pending') {
                const data = JSON.parse(localStorage.getItem(key));
                if (data) await this.uploadToCloud(userId, key, data);
            }
        }
        this.updateStatus('synced');
    },

    async loadSettings() {
        const userId = auth.currentUser?.uid;
        if (!userId) return;
        const docSnap = await getDoc(doc(db, "users", userId, "config", "preferences"));
        if (docSnap.exists()) {
            const settings = docSnap.data();
            Object.keys(settings).forEach(k => localStorage.setItem(`taskflow_${k}`, settings[k]));
        }
    },

    async saveSettings() {
        const userId = auth.currentUser?.uid;
        if (!userId) return;
        const settings = {
            daily_sync_enabled: localStorage.getItem('taskflow_daily_sync_enabled') === 'true',
            auto_daily_sync_enabled: localStorage.getItem('taskflow_auto_daily_sync_enabled') === 'true'
        };
        await setDoc(doc(db, "users", userId, "config", "preferences"), settings, { merge: true });
    }
};

// Listeners
window.addEventListener('online', () => SyncManager.syncAllPending());
window.addEventListener('offline', () => SyncManager.updateStatus('offline'));