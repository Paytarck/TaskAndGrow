import { SyncManager } from './sync-manager.js';
import { onSnapshot, db, doc, auth } from './firebase-config.js';

// ── Storage Key ──
const STORAGE_KEY = 'taskflow_monthly_tasks';

// ── State ──
let tasks = [];
let currentFilter = 'all';
let currentSort   = 'date-asc';
let searchQuery   = '';
let reminderTimers = {};
let pendingConfirmCallback = null;
let currentScope = 'month';
let editingTaskId = null;

// ── DOM Refs ──
const taskListEl    = document.getElementById('task-list');
const emptyState    = document.getElementById('empty-state');
const clearBtn      = document.getElementById('clear-btn');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const headerStats   = document.getElementById('header-stats');
const topHeader     = document.getElementById('top-header');
const searchInput   = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    loadTasks();
    renderAll();
    setMonthLabel();
    bindFilterTabs();
    bindSortPills();
    bindSearchInput();
    scheduleAllReminders();
    checkAndPerformAutoDailySync();
    
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
            if (e.target === confirmOverlay) closeConfirm();
        });
    }

    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
    }
});

// ── Load / Save ──
function loadTasks() {
    try { tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { tasks = []; }
}

function saveTasks() {
    SyncManager.saveData('taskflow_monthly_tasks', tasks);
}

// ── Month label ──
function setMonthLabel() {
    const el = document.getElementById('page-month');
    if (el) {
        const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        el.textContent = monthName;
        document.getElementById('scope-month-name').textContent = monthName;
    }
}

function getCurrentMonthName() {
    return new Date().toLocaleDateString('en-US', { month: 'long' });
}

function refreshMonthLabel() {
    setMonthLabel();
}

// ── Scope Toggle ──
function setScope(scope) {
    currentScope = scope;
    document.querySelectorAll('.scope-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scope === scope);
    });
}

// ── Search toggle ──
function toggleSearch() {
    const open = topHeader.classList.toggle('expanded');
    document.body.classList.toggle('search-open', open);
    const navSearchBtn = document.getElementById('search-nav-btn');
    if (navSearchBtn) navSearchBtn.classList.toggle('search-active', open);
    if (open) {
        setTimeout(() => searchInput.focus(), 300);
    } else {
        closeSearch(false);
    }
}

function closeSearch(doToggle = true) {
    if (doToggle) {
        topHeader.classList.remove('expanded');
        document.body.classList.remove('search-open');
        const navSearchBtn = document.getElementById('search-nav-btn');
        if (navSearchBtn) navSearchBtn.classList.remove('search-active');
    }
    searchInput.value = '';
    searchQuery = '';
    if (searchClearBtn) searchClearBtn.classList.remove('visible');
    if (currentSort === 'this-month') {
        currentSort = 'date-asc';
        document.querySelectorAll('.sort-pill').forEach(pill =>
            pill.classList.toggle('active', pill.dataset.sort === 'date-asc'));
    }
    renderAll();
}

function clearSearch() {
    searchInput.value = '';
    searchQuery = '';
    searchInput.focus();
    if (searchClearBtn) searchClearBtn.classList.remove('visible');
    renderAll();
}

function bindSearchInput() {
    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.toLowerCase();
        if (searchClearBtn) {
            searchClearBtn.classList.toggle('visible', searchQuery.length > 0);
        }
        renderAll();
    });
}

// ── Open / Close Modal ──
function openModal(editId = null) {
    const overlay    = document.getElementById('modal-overlay');
    const titleEl    = document.getElementById('modal-title');
    const nameInput  = document.getElementById('input-name');
    const descInput  = document.getElementById('input-desc');
    const dayInput   = document.getElementById('input-day');
    const timeInput  = document.getElementById('input-time');

    overlay.dataset.editId = editId || '';
    editingTaskId = editId || null;

    if (editId) {
        const task = tasks.find(t => t.id === editId);
        if (task.fromYearly) {
            showToast('Cannot edit imported tasks');
            return;
        }
        titleEl.textContent = 'Edit Task';
        nameInput.value = task.text;
        descInput.value = task.description || '';
        dayInput.value  = task.dueDay || '';
        timeInput.value = task.dueTime || '';
        setScope(task.scope || 'month');
    } else {
        titleEl.textContent = 'New Monthly Task';
        nameInput.value = '';
        descInput.value = '';
        dayInput.value  = new Date().getDate();
        timeInput.value = '';
        setScope('month');
    }

    overlay.classList.add('open');
    setTimeout(() => nameInput.focus(), 350);
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    editingTaskId = null;
}

// ── Save from modal ──
function saveModal() {
    const overlay   = document.getElementById('modal-overlay');
    const nameInput = document.getElementById('input-name');
    const descInput = document.getElementById('input-desc');
    const dayInput  = document.getElementById('input-day');
    const timeInput = document.getElementById('input-time');

    const text        = nameInput.value.trim();
    const description = descInput.value.trim();
    const dueDay      = dayInput.value ? parseInt(dayInput.value, 10) : null;
    const dueTime     = timeInput.value;

    if (!text) { shakeEl(nameInput); return; }

    if (dueDay !== null && (dueDay < 1 || dueDay > 31 || isNaN(dueDay))) {
        shakeEl(dayInput);
        showToast('Please enter a valid day (1–31)');
        return;
    }

    let dueDate = null;
    if (dueDay !== null) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(dueDay).padStart(2, '0');
        dueDate = `${y}-${m}-${d}`;
    }

    const editId = overlay.dataset.editId;
    if (editId) {
        const task = tasks.find(t => t.id === editId);
        if (task) {
            task.text        = text;
            task.description = description;
            task.dueDay      = dueDay;
            task.dueDate     = dueDate;
            task.dueTime     = dueTime;
            task.scope       = currentScope;
            clearReminderTimer(editId);
            syncEditToDaily(editId, text, description, dueDay, dueDate, dueTime);
        }
        showToast('Task updated ✓');
    } else {
        const newTask = {
            id:          Date.now().toString(),
            text,
            description,
            dueDay,
            dueDate,
            dueTime,
            scope:       currentScope,
            completed:   false,
            createdAt:   new Date().toISOString(),
            completedAt: null
        };
        tasks.push(newTask);
        
        if (localStorage.getItem('taskflow_daily_sync_enabled') === 'true') {
            const today = new Date().getDate();
            if (dueDay === today) {
                syncNewTaskToDaily(newTask);
            }
        }
        
        showToast('Task added ✓');
    }

    saveTasks();
    closeModal();
    renderAll();
    scheduleAllReminders();
}

function syncEditToDaily(monthlyTaskId, text, description, dueDay, dueDate, dueTime) {
    try {
        const dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
        const dailyTask = dailyTasks.find(t => t.monthlyTaskId === monthlyTaskId);
        if (dailyTask) {
            dailyTask.text = text;
            localStorage.setItem('taskflow_daily_tasks', JSON.stringify(dailyTasks));
        }
    } catch (e) {}
}

function syncNewTaskToDaily(monthlyTask) {
    try {
        let dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
        const today = new Date().getDate();
        
        if (monthlyTask.dueDay === today && !monthlyTask.completed) {
            const existingSync = dailyTasks.find(t => t.monthlyTaskId === monthlyTask.id);
            if (!existingSync) {
                dailyTasks.unshift({
                    id: 'm2d_' + monthlyTask.id,
                    monthlyTaskId: monthlyTask.id,
                    yearlyTaskId: monthlyTask.yearlyTaskId || undefined,
                    yearlyMonthIndex: monthlyTask.yearlyMonthIndex || undefined,
                    text: monthlyTask.text,
                    completed: false,
                    createdAt: new Date().toISOString(),
                    completedAt: null,
                    fromMonthly: true
                });
                localStorage.setItem('taskflow_daily_tasks', JSON.stringify(dailyTasks));
            }
        }
    } catch (e) {}
}

// ── Toggle Complete ──
function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (task.completed) {
        showToast('Completed tasks cannot be unchecked');
        renderAll();
        return;
    }

    task.completed   = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    saveTasks();
    
    if (task.yearlyTaskId !== undefined) {
        syncCompletionToYearly(task.yearlyTaskId, task.yearlyMonthIndex, task.completed);
    }
    
    syncCompletionToDaily(id, task.completed);
    
    renderAll();
    if (task.completed) showToast('Task completed! 🎉');
}

async function syncCompletionToDaily(monthlyTaskId, completed) {
    try {
        const dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
        const dailyTask = dailyTasks.find(t => t.monthlyTaskId === monthlyTaskId);
        if (dailyTask) {
            dailyTask.completed = completed;
            dailyTask.completedAt = completed ? new Date().toISOString() : null;
            // PUSH TO CLOUD
            await SyncManager.saveData('taskflow_daily_tasks', dailyTasks);
        }
    } catch (e) {}
}

async function syncCompletionToYearly(yearlyTaskId, monthIndex, completed) {
    if (yearlyTaskId === undefined || monthIndex === undefined) return;
    try {
        const yearlyData = JSON.parse(localStorage.getItem('taskflow_yearly_data')) || {};
        const monthTasks = yearlyData[monthIndex] || [];
        const yt = monthTasks.find(t => t.id === yearlyTaskId);
        
        if (yt && yt.completed !== completed) {
            yt.completed = completed;
            yt.completedAt = completed ? new Date().toISOString() : null;
            yearlyData[monthIndex] = monthTasks;
            
            // Save the entire YEARLY object back to cloud
            await SyncManager.saveData('taskflow_yearly_data', yearlyData);
            console.log("Yearly task status synced.");
        }
    } catch(e) { 
        console.error("Yearly Sync Error:", e); 
    }
}

// ── Edit Task ──
function startEdit(id) {
    const task = tasks.find(t => t.id === id);
    if (!task || task.completed) { showToast('Cannot edit completed tasks'); return; }

    const li = document.querySelector(`[data-id="${id}"]`);
    if (!li) return;

    const textEl = li.querySelector('.task-text');
    const actionsEl = li.querySelector('.task-actions');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;
    input.maxLength = 200;
    textEl.replaceWith(input);
    input.focus();
    input.select();

    const editBtn = actionsEl.querySelector('.action-btn.edit');
    if (editBtn) {
        editBtn.textContent = '✓';
        editBtn.classList.remove('edit');
        editBtn.classList.add('save');
        editBtn.title = 'Save';
        editBtn.onclick = () => saveEdit(id, input);
    }

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveEdit(id, input);
        if (e.key === 'Escape') cancelEdit(id);
    });
}

function saveEdit(id, input) {
    const newText = input.value.trim();
    if (!newText) { shakeEl(input); return; }
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    task.text = newText;
    saveTasks();
    renderAll();
    showToast('Task updated ✓');
}

function cancelEdit(id) {
    renderAll();
}

// ── Delete Task ──
function deleteTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const el = document.querySelector(`[data-id="${id}"]`);
    const doRemove = () => {
        tasks = tasks.filter(t => t.id !== id);
        saveTasks();
        renderAll();
    };
    if (el) {
        el.style.transition = 'all 0.25s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px) scale(0.95)';
        setTimeout(doRemove, 230);
    } else { doRemove(); }
    if (task.fromMonthly) showToast('Task removed from Daily (source kept)');
    else showToast('Task removed');
}

function confirmDelete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    document.getElementById('confirm-icon').textContent = '🗑';
    document.getElementById('confirm-title').textContent = 'Delete Task?';
    document.getElementById('confirm-body').textContent = `"${task.text}" will be permanently removed.`;
    document.getElementById('confirm-ok').textContent = 'Delete';
    pendingConfirmCallback = () => deleteTask(id);
    document.getElementById('confirm-overlay').classList.add('open');
}

// ── Clear Completed ──
function clearCompleted() {
    tasks = tasks.filter(t => !t.completed);
    saveTasks();
    renderAll();
    showToast('Completed tasks cleared');
}

function confirmClearCompleted() {
    const hasCompleted = tasks.some(t => t.completed);
    if (!hasCompleted) {
        showToast('No completed tasks to clear');
        return;
    }
    
    document.getElementById('confirm-icon').textContent = '🧹';
    document.getElementById('confirm-title').textContent = 'Clear Completed Tasks?';
    document.getElementById('confirm-body').textContent = 'All completed tasks will be removed. This action cannot be undone.';
    document.getElementById('confirm-ok').textContent = 'Clear Completed';
    pendingConfirmCallback = () => clearCompleted();
    document.getElementById('confirm-overlay').classList.add('open');
}

// ── Clear All Tasks ──
function clearAllTasks() {
    tasks = [];
    saveTasks();
    renderAll();
    showToast('All tasks cleared');
}

function confirmClearAll() {
    if (tasks.length === 0) {
        showToast('No tasks to clear');
        return;
    }
    
    document.getElementById('confirm-icon').textContent = '⚠️';
    document.getElementById('confirm-title').textContent = 'Clear All Tasks?';
    document.getElementById('confirm-body').textContent = 'All tasks will be permanently removed. This action cannot be undone.';
    document.getElementById('confirm-ok').textContent = 'Clear All';
    pendingConfirmCallback = () => clearAllTasks();
    document.getElementById('confirm-overlay').classList.add('open');
}

// ── Filter ──
function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    renderAll();
}
function bindFilterTabs() {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => setFilter(tab.dataset.filter));
    });
}
function getFiltered() {
    let list = [...tasks];
    if (currentFilter === 'active')    list = list.filter(t => !t.completed);
    if (currentFilter === 'completed') list = list.filter(t => t.completed);
    if (searchQuery) list = list.filter(t => t.text.toLowerCase().includes(searchQuery));
    
    list.sort((a, b) => {
        if (currentSort === 'date-asc')    return dateVal(a) - dateVal(b);
        if (currentSort === 'date-desc')   return dateVal(b) - dateVal(a);
        if (currentSort === 'alpha-asc')   return a.text.localeCompare(b.text);
        if (currentSort === 'alpha-desc')  return b.text.localeCompare(a.text);
        if (currentSort === 'status')      return (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
        if (currentSort === 'this-month')  return dateVal(a) - dateVal(b);
        return 0;
    });
    return list;
}

function dateVal(t) {
    if (!t.dueDate) return t.dueDay ? t.dueDay * 1000 : Infinity;
    const dt = t.dueDate + (t.dueTime ? 'T' + t.dueTime : 'T00:00');
    return new Date(dt).getTime();
}

// ── Sort ──
function setSort(s) {
    currentSort = s;
    document.querySelectorAll('.sort-pill').forEach(pill =>
        pill.classList.toggle('active', pill.dataset.sort === s));
    renderAll();
    closeSortPanel();
    showToast('Sorted ✓');
}
function bindSortPills() {
    document.querySelectorAll('.sort-pill').forEach(pill => {
        pill.addEventListener('click', () => setSort(pill.dataset.sort));
    });
}
function toggleSortPanel() {}
function closeSortPanel() {}

// ── Render ──
function renderAll() {
    const filtered = getFiltered();
    taskListEl.innerHTML = '';

    const hasCompleted = tasks.some(t => t.completed);
    const clearCompletedBtn = document.getElementById('clear-completed-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    
    if (clearCompletedBtn) clearCompletedBtn.classList.toggle('show', hasCompleted);
    if (clearAllBtn) clearAllBtn.classList.toggle('show', tasks.length > 0);

    if (filtered.length === 0) {
        emptyState.classList.add('show');
    } else {
        emptyState.classList.remove('show');
        let lastDayKey = null;
        filtered.forEach(task => {
            const dayKey = task.dueDay != null ? String(task.dueDay) : 'no-day';
            if (dayKey !== lastDayKey) {
                taskListEl.appendChild(buildDivider(task));
                lastDayKey = dayKey;
            }
            taskListEl.appendChild(createTaskEl(task));
        });
    }

    updateProgress();
    updateHeaderStats();
}

function buildDivider(task) {
    const div = document.createElement('div');
    div.className = 'date-divider';

    let label = 'No Date';
    let cls   = '';

    if (task.dueDay != null) {
        const todayDay = new Date().getDate();
        if (task.dueDay === todayDay) {
            label = `Day ${task.dueDay} · Today`;
            cls   = 'today';
        } else if (task.dueDate && task.dueDate < todayDateStr()) {
            label = `Day ${task.dueDay} · Overdue`;
            cls   = 'overdue';
        } else {
            label = `Day ${task.dueDay}`;
        }
    }

    div.innerHTML = `
        <div class="date-divider-line"></div>
        <span class="date-divider-label ${cls}">${label}</span>
        <div class="date-divider-line"></div>
    `;
    return div;
}

function createTaskEl(task) {
    const li = document.createElement('li');
    li.className = 'task-item'
        + (task.completed ? ' completed' : '')
        + (!task.completed && isOverdue(task) ? ' overdue' : '')
        + (task.scope === 'all' ? ' recurring' : '');
    li.dataset.id = task.id;

    const dueLabel  = buildDueLabel(task);
    const compTime  = task.completedAt ? formatTime(task.completedAt) : '';
    const remBadge  = (!task.completed && task.dueDay != null && task.dueTime)
        ? `<span class="reminder-badge">🔔 Reminder set</span>` : '';
    const scopeBadge = task.scope === 'all'
        ? `<span class="scope-badge recurring-badge">🔁 Recurring</span>` 
        : `<span class="scope-badge">📌 This month</span>`;
    const yearlyBadge = task.fromYearly
        ? `<span class="scope-badge yearly-import-badge">📥 Imported from Yearly</span>` : '';
    const descHtml = task.description
        ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : '';

    li.innerHTML = `
        <label class="task-checkbox">
            <input type="checkbox" ${task.completed ? 'checked' : ''}
                   onchange="toggleTask('${task.id}')">
            <span class="checkmark">
                <svg viewBox="0 0 16 12"><polyline points="1,6 5,10 14,1"/></svg>
            </span>
        </label>
        <div class="task-body">
            <div class="task-text">${escapeHtml(task.text)}</div>
            ${descHtml}
            <div class="task-meta">
                ${dueLabel}
                ${remBadge}
                ${yearlyBadge}
                ${scopeBadge}
                ${task.completed
                    ? `<span class="completed-badge">✔ Completed at ${compTime}</span>`
                    : ''}
            </div>
        </div>
        <div class="task-actions">
            ${!task.completed && !task.fromYearly
                ? `<button class="action-btn" title="Edit" onclick="startEdit('${task.id}')">✎</button>`
                : ''}
            <button class="action-btn delete" title="Delete" onclick="confirmDelete('${task.id}')">✕</button>
        </div>
    `;
    return li;
}

function buildDueLabel(task) {
    if (task.dueDay == null) return '';
    const todayDay = new Date().getDate();
    const timeStr = task.dueTime ? ' · ' + formatDisplayTime(task.dueTime) : '';
    const dayStr = `Day ${task.dueDay}`;

    if (task.completed) return `<span class="task-due completed-due">✔ ${dayStr}${timeStr}</span>`;
    if (task.dueDate && task.dueDate < todayDateStr()) return `<span class="task-due overdue-due">⚠ ${dayStr}${timeStr}</span>`;
    if (task.dueDay === todayDay) return `<span class="task-due today-due">📅 Today${timeStr}</span>`;
    return `<span class="task-due upcoming-due">🗓 ${dayStr}${timeStr}</span>`;
}

// ── Progress / Stats ──
function updateProgress() {
    const total = tasks.length;
    const done  = tasks.filter(t => t.completed).length;
    const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = pct + '%';
}
function updateHeaderStats() {
    const total = tasks.length;
    const done  = tasks.filter(t => t.completed).length;
    headerStats.innerHTML = `
        <span class="stat-badge done">${done}</span>
        <span class="stat-sep">/</span>
        <span class="stat-badge total">${total}</span>
    `;
}

// ── Reminders ──
function scheduleAllReminders() {
    Object.keys(reminderTimers).forEach(clearReminderTimer);
    tasks.forEach(scheduleReminder);
}

function scheduleReminder(task) {
    if (task.completed || !task.dueDate || !task.dueTime) return;
    const triggerTime = new Date(task.dueDate + 'T' + task.dueTime).getTime();
    const now = Date.now();
    const delay = triggerTime - now;
    if (delay <= 0 || delay > 7 * 24 * 60 * 60 * 1000) return;

    reminderTimers[task.id] = setTimeout(() => {
        showReminderPopup(task);
        delete reminderTimers[task.id];
    }, delay);
}

function clearReminderTimer(id) {
    if (reminderTimers[id]) { clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
}

function showReminderPopup(task) {
    const popup = document.getElementById('reminder-popup');
    document.getElementById('reminder-popup-body').textContent = `Time to: "${task.text}"`;
    popup.classList.add('show');
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('TaskFlow Reminder', { body: `Time to: ${task.text}` });
    }
    setTimeout(() => popup.classList.remove('show'), 8000);
}

function closeReminderPopup() {
    document.getElementById('reminder-popup').classList.remove('show');
}

function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ── Auto Daily Sync ──
function checkAndPerformAutoDailySync() {
    if (localStorage.getItem('taskflow_daily_sync_enabled') !== 'true') return;
    if (localStorage.getItem('taskflow_auto_daily_sync_enabled') !== 'true') return;

    const todayStr = new Date().toISOString().split('T')[0];
    const lastSyncKey = 'taskflow_daily_sync_last_' + todayStr;
    
    if (localStorage.getItem(lastSyncKey) === 'true') return;

    performDailySyncInternal();
}

function performDailySyncInternal() {
    if (localStorage.getItem('taskflow_daily_sync_enabled') !== 'true') return;

    const today = new Date().getDate();
    const allMonthly = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const todayTasks = allMonthly.filter(t => !t.completed && t.dueDay === today);

    if (todayTasks.length === 0) return;

    let dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
    let added = 0;
    
    todayTasks.forEach(mt => {
        if (!dailyTasks.find(t => t.monthlyTaskId === mt.id)) {
            dailyTasks.unshift({
                id: 'm2d_' + monthlyTask.id,
                monthlyTaskId: mt.id,
                text: mt.text,
                completed: false,
                createdAt: new Date().toISOString(),
                fromMonthly: true
            });
            added++;
        }
    });

    if (added > 0) {
        // Save the updated Daily list to the cloud from the Monthly page
        SyncManager.saveData('taskflow_daily_tasks', dailyTasks);
    }
}

// ── Helpers ──
function isOverdue(task) {
    if (!task.dueDate) return false;
    const dt = task.dueDate + (task.dueTime ? 'T' + task.dueTime : 'T23:59');
    return new Date(dt).getTime() < Date.now();
}
function isToday(dateStr) { return dateStr === todayDateStr(); }
function todayDateStr() { return new Date().toISOString().split('T')[0]; }

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function formatDisplayTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shakeEl(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake 0.35s ease';
    setTimeout(() => el.style.animation = '', 400);
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Confirm Dialog ──
function closeConfirm() {
    document.getElementById('confirm-overlay').classList.remove('open');
    pendingConfirmCallback = null;
}

// ── Shake keyframe ──
const style = document.createElement('style');
style.textContent = `
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-6px); }
    40%       { transform: translateX(6px); }
    60%       { transform: translateX(-4px); }
    80%       { transform: translateX(4px); }
}`;
document.head.appendChild(style);

// Call this function when the user logs in
function startRealTimeSync(userId, storageKey) {
    onSnapshot(doc(db, "users", userId, "data", storageKey), (doc) => {
        if (doc.exists()) {
            const cloudData = doc.data().tasks;
            localStorage.setItem(storageKey, JSON.stringify(cloudData));
            loadTasks(); // Update your local variable
            renderAll(); // Refresh UI
        }
    });
}



async function runYearlyToMonthlyBridge() {
    // 1. Only run if the user turned ON the Export Button
    if (localStorage.getItem('taskflow_yearly_sync_enabled') !== 'true') return;

    const currentMonthIndex = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    // 2. Load the data
    const yearlyData = JSON.parse(localStorage.getItem('taskflow_yearly_data')) || {};
    let monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
    const yearlyTasksForThisMonth = yearlyData[currentMonthIndex] || [];

    let hasNewExport = false;

    // 3. Match and Create Bridges
    yearlyTasksForThisMonth.forEach(yt => {
        // Prevent duplicate exports
        const isAlreadyExported = monthlyTasks.find(mt => mt.yearlyTaskId === yt.id);

        if (!isAlreadyExported && !yt.completed) {
            monthlyTasks.push({
                id: 'y2m_' + yt.id, // The ID is now permanent and linked only to the yearly task
                yearlyTaskId: yt.id, // Linking ID
                text: yt.text,
                dueDay: yt.day,
                dueDate: `${currentYear}-${String(currentMonthIndex + 1).padStart(2, '0')}-${String(yt.day).padStart(2, '0')}`,
                fromYearly: true,
                completed: false
            });
            hasNewExport = true;
        }
    });

    if (hasNewExport) {
        // Save to cloud so Phone B receives the exported monthly tasks
        await SyncManager.saveData('taskflow_monthly_tasks', monthlyTasks);
        renderAll();
    }
}

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Real-time data listener (STORAGE_KEY varies per page)
        SyncManager.initRealTimeData(user.uid, STORAGE_KEY, (updatedData) => {
            tasks = updatedData;
            renderAll();
        });

        // 2. Real-time settings listener (Toggles sync across devices)
        SyncManager.watchSettings(user.uid);

        // 3. Run the specific bridge for this page
        if (window.location.pathname.includes('daily.html')) {
            await runMonthlyToDailyBridge();
        } else if (window.location.pathname.includes('monthly.html')) {
            await runYearlyToMonthlyBridge();
        }
    }
});

// Add this to the end of monthly.js
window.runYearlyToMonthlyBridge = runYearlyToMonthlyBridge;
window.openModal = openModal;
window.closeModal = closeModal;
window.saveModal = saveModal;
window.toggleTask = toggleTask;
window.confirmDelete = confirmDelete;
window.toggleSearch = toggleSearch;
window.clearSearch = clearSearch;
window.closeSearch = closeSearch;
window.setScope = setScope;
window.confirmClearCompleted = confirmClearCompleted;
window.startEdit = startEdit;
window.refreshPage = () => window.location.reload(); 
window.closeConfirm = closeConfirm;
window.closeReminderPopup = closeReminderPopup;
window.requestNotifPermission = requestNotifPermission;
