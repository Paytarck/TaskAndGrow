import { SyncManager } from './sync-manager.js';

// ── Storage Keys ──
const STORAGE_KEY = 'taskflow_monthly_tasks';
const DAILY_STORAGE_KEY = 'taskflow_daily_tasks';
const AUTO_JUMP_KEY = 'taskflow_auto_jump';
const LAST_JUMP_KEY = 'taskflow_last_jump_month';
const MONTH_ARCHIVE_KEY = 'taskflow_month_archive';
const DAILY_SYNC_KEY = 'taskflow_daily_sync_enabled';
const AUTO_DAILY_SYNC_KEY = 'taskflow_auto_daily_sync_enabled';

// ── State ──
let pendingConfirmCallback = null;
let selectiveImportData = null;
let selectedImportTasks = [];
let previewData = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    initAutoJump();
    setAutoJumpToggle();
    loadPreviousData();
    setDailySyncToggles();
    checkAutoDailySync();
    
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

    const importConfirmOverlay = document.getElementById('import-confirm-overlay');
    if (importConfirmOverlay) {
        importConfirmOverlay.addEventListener('click', (e) => {
            if (e.target === importConfirmOverlay) {
                closeImportConfirm();
            }
        });
    }

    const selectiveImportModal = document.getElementById('selective-import-modal');
    if (selectiveImportModal) {
        selectiveImportModal.addEventListener('click', (e) => {
            if (e.target === selectiveImportModal) {
                closeSelectiveImport();
            }
        });
    }
});

// ── Section Navigation ──
function openSection(section) {
    document.getElementById('settings-home').style.display = 'none';
    
    if (section === 'month-management') {
        document.getElementById('section-month-management').style.display = 'block';
    } else if (section === 'how-it-works') {
        document.getElementById('section-how-it-works').style.display = 'block';
    } else if (section === 'previous-data') {
        document.getElementById('section-previous-data').style.display = 'block';
        loadPreviousData();
    } else if (section === 'daily-sync') {
        document.getElementById('section-daily-sync').style.display = 'block';
        updateDailySyncUI();
    }
}

function backToHome() {
    document.getElementById('settings-home').style.display = 'block';
    document.getElementById('section-month-management').style.display = 'none';
    document.getElementById('section-how-it-works').style.display = 'none';
    document.getElementById('section-previous-data').style.display = 'none';
    document.getElementById('section-daily-sync').style.display = 'none';
}

// ── Get Current Month ──
function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthName(yearMonth = null) {
    let date = new Date();
    if (yearMonth) {
        const [y, m] = yearMonth.split('-');
        date = new Date(y, parseInt(m) - 1);
    }
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Archive Management ──
function archiveCurrentMonth() {
    const currentMonth = getCurrentMonth();
    const tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const archive = JSON.parse(localStorage.getItem(MONTH_ARCHIVE_KEY)) || {};

    if (!archive[currentMonth]) {
        archive[currentMonth] = {
            month: currentMonth,
            tasks: tasks.filter(t => t.scope === 'month'),
            archivedAt: new Date().toISOString()
        };
        localStorage.setItem(MONTH_ARCHIVE_KEY, JSON.stringify(archive));
    }
}

function getPreviousMonthsData() {
    const archive = JSON.parse(localStorage.getItem(MONTH_ARCHIVE_KEY)) || {};
    return Object.values(archive).sort((a, b) => b.month.localeCompare(a.month));
}

// ── Load Previous Data ──
function loadPreviousData() {
    const previousMonths = getPreviousMonthsData();
    const listEl = document.getElementById('previous-data-list');
    const noDataEl = document.getElementById('no-previous-data');

    listEl.innerHTML = '';

    if (previousMonths.length === 0) {
        noDataEl.style.display = 'block';
        return;
    }

    noDataEl.style.display = 'none';

    previousMonths.forEach(monthData => {
        const completed = monthData.tasks.filter(t => t.completed).length;
        const total = monthData.tasks.length;

        const itemEl = document.createElement('div');
        itemEl.className = 'previous-data-item';
        itemEl.innerHTML = `
            <div class="previous-data-header">
                <span class="previous-data-month">${getMonthName(monthData.month)}</span>
                <span class="previous-data-count">${total} task${total !== 1 ? 's' : ''}</span>
            </div>
            <div class="previous-data-summary">
                <div class="summary-stat">
                    <span>✔</span>
                    <span>${completed} completed</span>
                </div>
                <div class="summary-stat">
                    <span>⏳</span>
                    <span>${total - completed} pending</span>
                </div>
            </div>
            <div class="previous-data-actions">
                <button class="action-btn-secondary" onclick="showPreview('${monthData.month}')">
                    Preview
                </button>
                <button class="action-btn-secondary" onclick="showSelectiveImport('${monthData.month}')">
                    Selective Import
                </button>
                <button class="action-btn-primary" onclick="confirmImportAll('${monthData.month}')">
                    Import All
                </button>
            </div>
        `;
        listEl.appendChild(itemEl);
    });
}

// ── Show Preview Modal ──
function showPreview(yearMonth) {
    const archive = JSON.parse(localStorage.getItem(MONTH_ARCHIVE_KEY)) || {};
    const monthData = archive[yearMonth];

    if (!monthData) return;

    previewData = monthData;
    const listEl = document.getElementById('selective-import-list');
    listEl.innerHTML = '';

    document.getElementById('import-month-label').textContent = `Tasks from ${getMonthName(yearMonth)}`;

    if (monthData.tasks.length === 0) {
        listEl.innerHTML = '<div class="preview-tasks-empty">No tasks recorded for this month</div>';
    } else {
        monthData.tasks.forEach(task => {
            const itemEl = document.createElement('div');
            itemEl.className = 'preview-task-item' + (task.completed ? ' completed' : '');
            itemEl.innerHTML = `
                <div class="preview-task-checkbox${task.completed ? ' checked' : ''}">
                    ${task.completed ? '✔' : ''}
                </div>
                <div class="preview-task-content">
                    <div class="preview-task-text">${escapeHtml(task.text)}</div>
                    ${task.description ? `<div class="preview-task-desc">${escapeHtml(task.description)}</div>` : ''}
                </div>
            `;
            listEl.appendChild(itemEl);
        });
    }

    const modal = document.getElementById('selective-import-modal');
    const saveBtn = modal.querySelector('.btn-save');
    saveBtn.style.display = 'none';
    const cancelBtn = modal.querySelector('.btn-cancel');
    cancelBtn.textContent = 'Close';
    modal.classList.add('open');
}

function closePreview() {
    document.getElementById('selective-import-modal').classList.remove('open');
    previewData = null;
}

// ── Show Selective Import Modal ──
function showSelectiveImport(yearMonth) {
    const archive = JSON.parse(localStorage.getItem(MONTH_ARCHIVE_KEY)) || {};
    const monthData = archive[yearMonth];

    if (!monthData) return;

    selectiveImportData = monthData;
    selectedImportTasks = [];

    document.getElementById('import-month-label').textContent = `From ${getMonthName(yearMonth)}`;

    const listEl = document.getElementById('selective-import-list');
    listEl.innerHTML = '';

    monthData.tasks.forEach(task => {
        const itemEl = document.createElement('label');
        itemEl.className = 'import-task-item';
        itemEl.innerHTML = `
            <input type="checkbox" value="${task.id}" onchange="updateSelectedTasks()">
            <span class="import-task-checkbox"></span>
            <div class="import-task-text">
                <strong>${escapeHtml(task.text)}</strong>
                <small>${task.completed ? '✔ Completed' : '⏳ Pending'}</small>
            </div>
        `;
        listEl.appendChild(itemEl);
    });

    const modal = document.getElementById('selective-import-modal');
    const saveBtn = modal.querySelector('.btn-save');
    saveBtn.style.display = 'block';
    const cancelBtn = modal.querySelector('.btn-cancel');
    cancelBtn.textContent = 'Cancel';
    modal.classList.add('open');
}

function updateSelectedTasks() {
    const checkboxes = document.querySelectorAll('#selective-import-list input[type="checkbox"]:checked');
    selectedImportTasks = Array.from(checkboxes).map(cb => cb.value);
}

function closeSelectiveImport() {
    document.getElementById('selective-import-modal').classList.remove('open');
    selectiveImportData = null;
    selectedImportTasks = [];
}

function performSelectiveImport() {
    if (!selectiveImportData || selectedImportTasks.length === 0) {
        showToast('No tasks selected');
        return;
    }

    let tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    
    selectedImportTasks.forEach(taskId => {
        const archivedTask = selectiveImportData.tasks.find(t => t.id === taskId);
        if (archivedTask) {
            const newTask = {
                ...archivedTask,
                id: Date.now().toString() + Math.random(),
                completed: false,
                completedAt: null,
                createdAt: new Date().toISOString()
            };
            tasks.unshift(newTask);
        }
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    closeSelectiveImport();
    loadPreviousData();
    showToast(`Imported ${selectedImportTasks.length} task${selectedImportTasks.length !== 1 ? 's' : ''}`);
}

// ── Confirm Import All ──
function confirmImportAll(yearMonth) {
    const archive = JSON.parse(localStorage.getItem(MONTH_ARCHIVE_KEY)) || {};
    const monthData = archive[yearMonth];

    if (!monthData) return;

    document.getElementById('import-confirm-body').textContent = 
        `This will import ${monthData.tasks.length} task${monthData.tasks.length !== 1 ? 's' : ''} from ${getMonthName(yearMonth)}. Existing tasks will not be affected.`;
    
    pendingConfirmCallback = () => performImportAll(yearMonth);
    document.getElementById('import-confirm-overlay').classList.add('open');
}

function closeImportConfirm() {
    document.getElementById('import-confirm-overlay').classList.remove('open');
    pendingConfirmCallback = null;
}

function performImportAll(yearMonth) {
    const archive = JSON.parse(localStorage.getItem(MONTH_ARCHIVE_KEY)) || {};
    const monthData = archive[yearMonth];

    if (!monthData) return;

    let tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    
    monthData.tasks.forEach(task => {
        const newTask = {
            ...task,
            id: Date.now().toString() + Math.random(),
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString()
        };
        tasks.unshift(newTask);
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    closeImportConfirm();
    loadPreviousData();
    showToast('Tasks imported! ✓');
}

// ── Init Auto-Jump ──
function initAutoJump() {
    const autoJumpEnabled = localStorage.getItem(AUTO_JUMP_KEY) === 'true';
    const lastJumpMonth = localStorage.getItem(LAST_JUMP_KEY);
    const currentMonth = getCurrentMonth();

    if (autoJumpEnabled && lastJumpMonth !== currentMonth) {
        archiveCurrentMonth();
        performMonthJump();
        localStorage.setItem(LAST_JUMP_KEY, currentMonth);
    }
}

// ── Set Toggle State ──
function setAutoJumpToggle() {
    const toggle = document.getElementById('auto-jump-toggle');
    if (toggle) {
        toggle.checked = localStorage.getItem(AUTO_JUMP_KEY) === 'true';
    }
}

// ── Toggle Auto-Jump ──
function toggleAutoJump() {
    const toggle = document.getElementById('auto-jump-toggle');
    const isChecked = toggle.checked;
    localStorage.setItem(AUTO_JUMP_KEY, isChecked);
    showToast(isChecked ? 'Auto-Jump enabled' : 'Auto-Jump disabled');
}

// ── Manual Jump with Confirmation ──
function manualJump() {
    const realCalendarMonth = getCurrentMonth();
    const appCurrentMonth = getAppCurrentMonth();

    if (realCalendarMonth <= appCurrentMonth) {
        showToast(`🚫 ${getMonthName(appCurrentMonth)} is still ongoing. Jumping is not possible.`);
        return;
    }

    archiveCurrentMonth();
    showConfirm({
        icon: '🚀',
        title: 'New Month Detected!',
        body: `Ready to jump from ${getMonthName(appCurrentMonth)} to ${getMonthName(realCalendarMonth)}? This will reset recurring tasks.`,
        okLabel: 'Jump Now',
        onOk: () => {
            performMonthJump();
            localStorage.setItem(LAST_JUMP_KEY, realCalendarMonth); 
            showToast(`Welcome to ${getMonthName(realCalendarMonth)}! 🎉`);
            setTimeout(() => {
                window.location.href = 'monthly.html';
            }, 1500);
        }
    });
}

// ── Perform Month Jump ──
function performMonthJump() {
    try {
        let tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

        tasks = tasks.filter(task => task.scope !== 'month');

        tasks = tasks.map(task => {
            if (task.scope === 'all') {
                return {
                    ...task,
                    completed: false,
                    completedAt: null,
                    dueDate: updateDateToCurrentMonth(task.dueDay)
                };
            }
            return task;
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
        console.error('Error during month jump:', e);
        showToast('Error during month jump');
    }
}

// ── Update Date to Current Month ──
function updateDateToCurrentMonth(day) {
    if (!day) return null;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

// ── Daily Sync ──
function setDailySyncToggles() {
    const toggle = document.getElementById('daily-sync-toggle');
    if (toggle) toggle.checked = localStorage.getItem(DAILY_SYNC_KEY) === 'true';
    const autoToggle = document.getElementById('auto-daily-sync-toggle');
    if (autoToggle) autoToggle.checked = localStorage.getItem(AUTO_DAILY_SYNC_KEY) === 'true';
}

function toggleDailySync() {
    const toggle = document.getElementById('daily-sync-toggle');
    const enabled = toggle.checked;
    localStorage.setItem(DAILY_SYNC_KEY, enabled ? 'true' : 'false');
    if (!enabled) {
        localStorage.setItem(AUTO_DAILY_SYNC_KEY, 'false');
        const autoToggle = document.getElementById('auto-daily-sync-toggle');
        if (autoToggle) autoToggle.checked = false;
    }
    updateDailySyncUI();
    showToast(enabled ? '⚡ Daily Sync enabled' : 'Daily Sync disabled');
}

function toggleAutoDailySync() {
    const toggle = document.getElementById('auto-daily-sync-toggle');
    const enabled = toggle.checked;
    localStorage.setItem(AUTO_DAILY_SYNC_KEY, enabled ? 'true' : 'false');
    updateDailySyncUI();
    showToast(enabled ? '⚡ Auto Daily Sync ON — syncs today\'s tasks automatically' : 'Auto Daily Sync disabled');
}

function updateDailySyncUI() {
    const enabled = localStorage.getItem(DAILY_SYNC_KEY) === 'true';
    const autoEnabled = localStorage.getItem(AUTO_DAILY_SYNC_KEY) === 'true';

    const autoCard = document.getElementById('auto-daily-sync-card');
    const statusCard = document.getElementById('daily-sync-status-card');
    const syncNowCard = document.getElementById('daily-sync-now-card');
    const clearCard = document.getElementById('clear-daily-sync-card');

    if (autoCard) autoCard.style.display = enabled ? 'flex' : 'none';
    if (statusCard) statusCard.style.display = enabled ? 'block' : 'none';
    if (syncNowCard) syncNowCard.style.display = enabled ? 'flex' : 'none';
    if (clearCard) clearCard.style.display = enabled ? 'flex' : 'none';

    if (enabled) {
        const today = new Date().getDate();
        const allMonthly = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        const todayTasks = allMonthly.filter(t => !t.completed && t.dueDay === today);
        const el = document.getElementById('daily-sync-status-text');
        if (el) {
            const autoNote = autoEnabled ? ' Auto Daily Sync is ON.' : '';
            el.textContent = todayTasks.length > 0
                ? `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} due today will be synced to Daily.${autoNote}`
                : `No tasks due today found in Monthly.${autoNote}`;
        }
    }
}

function checkAutoDailySync() {
    if (localStorage.getItem(DAILY_SYNC_KEY) !== 'true') return;
    if (localStorage.getItem(AUTO_DAILY_SYNC_KEY) !== 'true') return;

    const todayStr = new Date().toISOString().split('T')[0];
    const lastSyncKey = 'taskflow_daily_sync_last_' + todayStr;
    if (localStorage.getItem(lastSyncKey) === 'true') return;

    performDailySync();
}

function performDailySync() {
    const today = new Date().getDate();
    const todayStr = new Date().toISOString().split('T')[0];

    const allMonthly = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const todayTasks = allMonthly.filter(t => !t.completed && t.dueDay === today);

    if (todayTasks.length === 0) {
        showToast('No tasks due today to sync');
        return 0;
    }

    let dailyTasks = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY)) || [];
    const existingSourceIds = new Set(
        dailyTasks.filter(t => t.fromMonthly).map(t => t.monthlyTaskId)
    );

    let added = 0;
    todayTasks.forEach(mt => {
        if (existingSourceIds.has(mt.id)) return;
        dailyTasks.unshift({
            id: 'm2d_' + mt.id + '_' + Date.now(),
            monthlyTaskId: mt.id,
            text: mt.text,
            completed: false,
            createdAt: new Date().toISOString(),
            completedAt: null,
            fromMonthly: true
        });
        added++;
    });

    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyTasks));
    localStorage.setItem('taskflow_daily_sync_last_' + todayStr, 'true');
    return added;
}

function confirmDailySyncNow() {
    const today = new Date().getDate();
    const allMonthly = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const todayTasks = allMonthly.filter(t => !t.completed && t.dueDay === today);

    showConfirm({
        icon: '⚡',
        title: 'Sync Today\'s Tasks?',
        body: `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} due today will be pushed to your Daily todo.`,
        okLabel: 'Sync Now',
        onOk: () => {
            const todayStr = new Date().toISOString().split('T')[0];
            localStorage.removeItem('taskflow_daily_sync_last_' + todayStr);
            const added = performDailySync();
            updateDailySyncUI();
            showToast(added > 0 ? `Synced ${added} task${added !== 1 ? 's' : ''} to Daily ✓` : 'All tasks already synced');
        }
    });
}

function confirmClearDailySynced() {
    const dailyTasks = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY)) || [];
    const syncedCount = dailyTasks.filter(t => t.fromMonthly).length;

    showConfirm({
        icon: '🗑',
        title: 'Clear Synced Daily Tasks?',
        body: `This will remove ${syncedCount} synced task${syncedCount !== 1 ? 's' : ''} from Daily Tasks. Your original monthly tasks are not affected.`,
        okLabel: 'Clear',
        onOk: () => {
            let dailyTasks = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY)) || [];
            dailyTasks = dailyTasks.filter(t => !t.fromMonthly);
            localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyTasks));
            for (let i = 0; i < 31; i++) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                localStorage.removeItem('taskflow_daily_sync_last_' + d.toISOString().split('T')[0]);
            }
            updateDailySyncUI();
            showToast(`Removed ${syncedCount} synced task${syncedCount !== 1 ? 's' : ''}`);
        }
    });
}

// ── Helpers ──
function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function getAppCurrentMonth() {
    return localStorage.getItem(LAST_JUMP_KEY) || getCurrentMonth();
}

window.openSection = openSection;
window.backToHome = backToHome;
window.toggleAutoJump = toggleAutoJump;
window.manualJump = manualJump;
window.showPreview = showPreview;
window.showSelectiveImport = showSelectiveImport;
window.confirmImportAll = confirmImportAll;
window.performImportAll = performImportAll;
window.performSelectiveImport = performSelectiveImport;
window.closeSelectiveImport = closeSelectiveImport;
window.closeImportConfirm = closeImportConfirm;
window.toggleDailySync = toggleDailySync;
window.toggleAutoDailySync = toggleAutoDailySync;
window.confirmDailySyncNow = confirmDailySyncNow;
window.confirmClearDailySynced = confirmClearDailySynced;
window.updateSelectedTasks = updateSelectedTasks;
window.closeConfirm = closeConfirm;