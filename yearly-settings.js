// ── Storage Keys ──
const SYNC_KEY = 'taskflow_yearly_sync_enabled';
const AUTO_SYNC_KEY = 'taskflow_yearly_auto_sync_enabled';
const YEARLY_KEY = 'taskflow_yearly_data';
const MONTHLY_KEY = 'taskflow_monthly_tasks';
const DAILY_KEY = 'taskflow_daily_tasks';

const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let pendingConfirmCallback = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    setSyncToggle();
    updateSyncUI();
    checkAndPerformAutoSync();
    
    // ── FIX: Proper event listener binding ──
    const confirmOkBtn = document.getElementById('confirm-ok');
    if (confirmOkBtn) {
        confirmOkBtn.addEventListener('click', () => {
            if (typeof pendingConfirmCallback === 'function') {
                pendingConfirmCallback();
            }
            closeConfirm();
        });
    }

    const confirmOverlay = document.getElementById('confirm-overlay');
    if (confirmOverlay) {
        confirmOverlay.addEventListener('click', (e) => {
            if (e.target === confirmOverlay) {
                closeConfirm();
            }
        });
    }
});

// ── Enhanced Auto Sync ──
function checkAndPerformAutoSync() {
    if (localStorage.getItem(SYNC_KEY) !== 'true') return;
    if (localStorage.getItem(AUTO_SYNC_KEY) !== 'true') return;

    const hasEverSynced = localStorage.getItem('taskflow_yearly_ever_synced') === 'true';
    if (!hasEverSynced) {
        performFullAutoSync();
        localStorage.setItem('taskflow_yearly_ever_synced', 'true');
        return;
    }

    performContinuousAutoSync();
}

function performFullAutoSync() {
    const yearlyData = JSON.parse(localStorage.getItem(YEARLY_KEY)) || {};
    let monthlyTasks = JSON.parse(localStorage.getItem(MONTHLY_KEY)) || [];
    let dailyTasks = JSON.parse(localStorage.getItem(DAILY_KEY)) || [];
    const currentYear = new Date().getFullYear();
    let addedCount = 0;

    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
        const yearlyTasks = yearlyData[monthIndex] || [];
        if (yearlyTasks.length === 0) continue;

        yearlyTasks.forEach(yt => {
            const existingSync = monthlyTasks.find(mt => mt.yearlyTaskId === yt.id);
            if (existingSync) return;

            const m = String(monthIndex + 1).padStart(2, '0');
            const d = String(yt.day).padStart(2, '0');

            monthlyTasks.push({
                id: 'y2m_' + yt.id + '_' + Date.now(),
                yearlyTaskId: yt.id,
                yearlyMonthIndex: monthIndex,
                text: yt.text,
                description: yt.desc || '',
                dueDay: yt.day,
                dueDate: currentYear + '-' + m + '-' + d,
                dueTime: yt.time || '11:30',
                scope: 'month',
                completed: yt.completed,
                completedAt: yt.completed ? new Date().toISOString() : null,
                createdAt: new Date().toISOString(),
                fromYearly: true
            });
            addedCount++;
        });
    }

    if (addedCount > 0) {
        localStorage.setItem(MONTHLY_KEY, JSON.stringify(monthlyTasks));
    }
}

function performContinuousAutoSync() {
    const yearlyData = JSON.parse(localStorage.getItem(YEARLY_KEY)) || {};
    let monthlyTasks = JSON.parse(localStorage.getItem(MONTHLY_KEY)) || [];
    let dailyTasks = JSON.parse(localStorage.getItem(DAILY_KEY)) || [];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const currentDay = new Date().getDate();
    let addedToMonthlyCount = 0;
    let addedToDailyCount = 0;

    for (let i = 0; i < 12; i++) {
        const monthIndex = (currentMonth + i) % 12;
        const yearlyTasks = yearlyData[monthIndex] || [];
        
        yearlyTasks.forEach(yt => {
            const existingSync = monthlyTasks.find(mt => mt.yearlyTaskId === yt.id && mt.yearlyMonthIndex === monthIndex);
            if (existingSync) {
                if (existingSync.completed !== yt.completed) {
                    existingSync.completed = yt.completed;
                    existingSync.completedAt = yt.completed ? new Date().toISOString() : null;
                }
                return;
            }

            let targetYear = currentYear;
            if (monthIndex < currentMonth) {
                targetYear = currentYear + 1;
            }

            const m = String(monthIndex + 1).padStart(2, '0');
            const d = String(yt.day).padStart(2, '0');
            const dueDate = targetYear + '-' + m + '-' + d;

            const newMonthlyTask = {
                id: 'y2m_' + yt.id + '_' + Date.now(),
                yearlyTaskId: yt.id,
                yearlyMonthIndex: monthIndex,
                text: yt.text,
                description: yt.desc || '',
                dueDay: yt.day,
                dueDate: dueDate,
                dueTime: yt.time || '11:30',
                scope: 'month',
                completed: yt.completed,
                completedAt: yt.completed ? new Date().toISOString() : null,
                createdAt: new Date().toISOString(),
                fromYearly: true
            };

            monthlyTasks.push(newMonthlyTask);
            addedToMonthlyCount++;

            if (monthIndex === currentMonth && yt.day === currentDay && !yt.completed) {
                const existingDailySync = dailyTasks.find(dt => dt.yearlyTaskId === yt.id);
                if (!existingDailySync) {
                    dailyTasks.push({
                        id: 'y2d_' + yt.id + '_' + Date.now(),
                        yearlyTaskId: yt.id,
                        yearlyMonthIndex: monthIndex,
                        monthlyTaskId: newMonthlyTask.id,
                        text: yt.text,
                        completed: false,
                        createdAt: new Date().toISOString(),
                        completedAt: null,
                        fromMonthly: true,
                        fromYearly: true
                    });
                    addedToDailyCount++;
                }
            }
        });
    }

    if (addedToMonthlyCount > 0 || monthlyTasks.length > 0) {
        localStorage.setItem(MONTHLY_KEY, JSON.stringify(monthlyTasks));
    }
    if (addedToDailyCount > 0 || dailyTasks.length > 0) {
        localStorage.setItem(DAILY_KEY, JSON.stringify(dailyTasks));
    }
}

// ── Section Navigation ──
function openSection(section) {
    document.getElementById('settings-home').style.display = 'none';
    if (section === 'how-it-works') {
        document.getElementById('section-how-it-works').style.display = 'block';
    } else if (section === 'data-management') {
        document.getElementById('section-data-management').style.display = 'block';
        updateSyncUI();
    }
}

function backToHome() {
    document.getElementById('settings-home').style.display = 'flex';
    document.getElementById('section-how-it-works').style.display = 'none';
    document.getElementById('section-data-management').style.display = 'none';
}

// ── Sync Toggle ──
function setSyncToggle() {
    const toggle = document.getElementById('sync-toggle');
    if (toggle) toggle.checked = localStorage.getItem(SYNC_KEY) === 'true';
    const autoToggle = document.getElementById('auto-sync-toggle');
    if (autoToggle) autoToggle.checked = localStorage.getItem(AUTO_SYNC_KEY) === 'true';
}

function toggleSync() {
    const toggle = document.getElementById('sync-toggle');
    const enabled = toggle.checked;
    localStorage.setItem(SYNC_KEY, enabled ? 'true' : 'false');
    if (!enabled) {
        localStorage.setItem(AUTO_SYNC_KEY, 'false');
        const autoToggle = document.getElementById('auto-sync-toggle');
        if (autoToggle) autoToggle.checked = false;
    }
    updateSyncUI();
    showToast(enabled ? '🔗 Yearly Sync enabled' : 'Sync disabled');
}

function toggleAutoSync() {
    const toggle = document.getElementById('auto-sync-toggle');
    const enabled = toggle.checked;
    localStorage.setItem(AUTO_SYNC_KEY, enabled ? 'true' : 'false');
    
    if (enabled) {
        performFullAutoSync();
    }
    
    updateSyncUI();
    showToast(enabled ? '⚡ Auto Sync enabled — syncs continuously' : 'Auto Sync disabled');
}

function updateSyncUI() {
    const enabled = localStorage.getItem(SYNC_KEY) === 'true';
    const autoEnabled = localStorage.getItem(AUTO_SYNC_KEY) === 'true';

    const statusCard = document.getElementById('sync-status-card');
    const resyncCard = document.getElementById('resync-card');
    const clearCard = document.getElementById('clear-sync-card');
    const autoSyncCard = document.getElementById('auto-sync-card');

    if (autoSyncCard) autoSyncCard.style.display = enabled ? 'flex' : 'none';
    if (statusCard) statusCard.style.display = enabled ? 'block' : 'none';
    if (resyncCard) resyncCard.style.display = enabled ? 'flex' : 'none';
    if (clearCard) clearCard.style.display = enabled ? 'flex' : 'none';

    if (enabled) {
        const yearlyData = JSON.parse(localStorage.getItem(YEARLY_KEY)) || {};
        const currentMonth = new Date().getMonth();
        const currentTasks = yearlyData[currentMonth] || [];
        const el = document.getElementById('sync-status-text');
        if (el) {
            const autoNote = autoEnabled ? ' Auto Sync is ON — syncs all months continuously.' : '';
            el.textContent = currentTasks.length > 0
                ? `${currentTasks.length} task${currentTasks.length !== 1 ? 's' : ''} from ${months[currentMonth]} are synced and will update continuously.${autoNote}`
                : `No tasks found for ${months[currentMonth]} yet. Add tasks in the yearly month view.${autoNote}`;
        }
    }
}

// ── Re-sync ──
function confirmResync() {
    showConfirm({
        icon: '🔄',
        title: 'Re-sync All Months?',
        body: `All yearly tasks will be pushed to Monthly and Daily Tasks with full sync. Existing synced tasks will be updated if changed.`,
        okLabel: 'Re-sync',
        onOk: performFullAutoSync
    });
}

// ── Clear Synced Tasks ──
function confirmClearSynced() {
    const monthlyTasks = JSON.parse(localStorage.getItem(MONTHLY_KEY)) || [];
    const dailyTasks = JSON.parse(localStorage.getItem(DAILY_KEY)) || [];
    const syncedMonthlyCount = monthlyTasks.filter(t => t.fromYearly).length;
    const syncedDailyCount = dailyTasks.filter(t => t.fromYearly).length;
    const totalSynced = syncedMonthlyCount + syncedDailyCount;

    showConfirm({
        icon: '🗑',
        title: 'Clear Synced Tasks?',
        body: `This will remove ${totalSynced} synced task${totalSynced !== 1 ? 's' : ''} from Monthly and Daily Tasks. Your original yearly tasks are not affected.`,
        okLabel: 'Clear',
        onOk: performClearSynced
    });
}

function performClearSynced() {
    let monthlyTasks = JSON.parse(localStorage.getItem(MONTHLY_KEY)) || [];
    let dailyTasks = JSON.parse(localStorage.getItem(DAILY_KEY)) || [];
    
    const beforeMonthly = monthlyTasks.length;
    const beforeDaily = dailyTasks.length;
    
    monthlyTasks = monthlyTasks.filter(t => !t.fromYearly);
    dailyTasks = dailyTasks.filter(t => !t.fromYearly);
    
    localStorage.setItem(MONTHLY_KEY, JSON.stringify(monthlyTasks));
    localStorage.setItem(DAILY_KEY, JSON.stringify(dailyTasks));
    localStorage.setItem('taskflow_yearly_ever_synced', 'false');
    
    const removedMonthly = beforeMonthly - monthlyTasks.length;
    const removedDaily = beforeDaily - dailyTasks.length;
    const totalRemoved = removedMonthly + removedDaily;
    
    showToast(`Removed ${totalRemoved} synced task${totalRemoved !== 1 ? 's' : ''}`);
    updateSyncUI();
}

// ── Confirm Dialog ──
function showConfirm({ icon, title, body, okLabel, onOk }) {
    document.getElementById('confirm-icon').textContent = icon || '⚠';
    document.getElementById('confirm-title').textContent = title || 'Are you sure?';
    document.getElementById('confirm-body').textContent = body || 'This action cannot be undone.';
    const okBtn = document.getElementById('confirm-ok');
    okBtn.textContent = okLabel || 'Confirm';
    pendingConfirmCallback = onOk;
    document.getElementById('confirm-overlay').classList.add('open');
}

function closeConfirm() {
    document.getElementById('confirm-overlay').classList.remove('open');
    pendingConfirmCallback = null;
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

window.openSection = openSection;
window.backToHome = backToHome;
window.toggleSync = toggleSync;
window.toggleAutoSync = toggleAutoSync;
window.confirmResync = confirmResync;
window.confirmClearSynced = confirmClearSynced;
window.closeConfirm = closeConfirm;