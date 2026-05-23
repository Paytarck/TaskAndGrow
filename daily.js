import { SyncManager } from './sync-manager.js';
import { onSnapshot, db, doc, auth } from './firebase-config.js';
// ── Storage Key ──
const STORAGE_KEY = 'taskflow_daily_tasks';

// ── State ──
let tasks = [];
let currentFilter = 'all';
let currentSort = 'newest';
let searchQuery = '';
let pendingConfirmCallback = null;
let confirmMode = null; // 'delete', 'clear-completed', 'clear-all'

// ── DOM Refs ──
const taskInput     = document.getElementById('task-input');
const taskList      = document.getElementById('task-list');
const emptyState    = document.getElementById('empty-state');
const clearBtn      = document.getElementById('clear-completed-btn');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const headerStats   = document.getElementById('header-stats');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    checkDailyReset();
    loadTasks();
    renderAll();
    updateHeader();
    bindFilterTabs();
    checkAndSyncDaily();

    taskInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') addTask();
    });

    // Set date
    const dateEl = document.getElementById('page-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
        });
    }

    // Confirm dialog wiring
    document.getElementById('confirm-ok').addEventListener('click', () => {
        if (typeof pendingConfirmCallback === 'function') pendingConfirmCallback();
        closeConfirm();
    });
    document.getElementById('confirm-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('confirm-overlay')) closeConfirm();
    });

    // Search input wiring
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim().toLowerCase();
            const clearBtn = document.getElementById('search-clear-btn');
            if (clearBtn) clearBtn.classList.toggle('visible', searchQuery.length > 0);
            renderAll();
        });
    }

    // Sort pills wiring (search bar pills)
    document.querySelectorAll('.sort-pill').forEach(pill => {
        pill.addEventListener('click', () => setSort(pill.dataset.sort));
    });
});

// ── Load / Save ──
function loadTasks() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        tasks = raw ? JSON.parse(raw) : [];
    } catch { tasks = []; }
}
function saveTasks() {
    // Instead of localStorage.setItem, use:
    SyncManager.saveData('taskflow_daily_tasks', tasks);
}

// ── Daily Reset: clear all tasks when a new day starts ──
function checkDailyReset() {
    const todayStr = new Date().toISOString().split('T')[0];
    const lastDayKey = 'taskflow_last_active_day';
    const lastDay = localStorage.getItem(lastDayKey);
    if (lastDay && lastDay !== todayStr) {
        // New day — wipe all tasks
        tasks = [];
        saveTasks();
        showToast('New day! Tasks have been reset 🌅');
    }
    localStorage.setItem(lastDayKey, todayStr);
}

// ── Auto sync on first load of day ──
function checkAndSyncDaily() {
    if (localStorage.getItem('taskflow_daily_sync_enabled') !== 'true') return;
    if (localStorage.getItem('taskflow_auto_daily_sync_enabled') !== 'true') return;
    const todayStr = new Date().toISOString().split('T')[0];
    const lastSyncKey = 'taskflow_daily_sync_last_' + todayStr;
    if (localStorage.getItem(lastSyncKey) === 'true') return;
    performDailySyncInternal();
}
function performDailySyncInternal() {
    const today = new Date().getDate();
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Check if sync is enabled
    if (localStorage.getItem('taskflow_daily_sync_enabled') !== 'true') return;

    const allMonthly = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
    const todayTasks = allMonthly.filter(t => !t.completed && t.dueDay === today);
    
    if (todayTasks.length === 0) return;

    let added = 0;
    todayTasks.forEach(mt => {
        // Prevent duplicates
        if (!tasks.find(t => t.monthlyTaskId === mt.id)) {
            tasks.unshift({
                id: 'm2d_' + mt.id,
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
        // CRITICAL: Save to cloud so Phone B receives the new Daily list
        SyncManager.saveData(STORAGE_KEY, tasks);
        renderAll();
    }
    localStorage.setItem('taskflow_daily_sync_last_' + todayStr, 'true');
}

// ── Refresh Daily Tasks ──
async function refreshDailyTasks() {
    const btn = document.getElementById('refresh-nav-btn');
    
    // Add visual feedback (spinning animation if you have CSS for it)
    if (btn) btn.style.transform = "rotate(360deg)";
    if (btn) btn.style.transition = "transform 0.5s ease";

    try {
        // 1. Pull the latest data from the Cloud (Firebase)
        await SyncManager.downloadAllFromCloud();
        
        // 2. Re-load the tasks from the local storage (which was just updated)
        loadTasks();
        
        // 3. Check for any new tasks from Monthly that belong to today
        performDailySyncInternal();
        
        // 4. Re-draw the entire list
        renderAll();
        
        showToast('Synced with cloud! ✓');
    } catch (error) {
        console.error("Refresh failed:", error);
        showToast('Refresh failed. Check internet.');
    } finally {
        // Reset button rotation after a delay
        setTimeout(() => {
            if (btn) btn.style.transform = "rotate(0deg)";
        }, 500);
    }
}

// ── Go Home ──
function goHome() {
    window.location.href = 'mainPage.html';
}

// ── Toggle Add Task Input ──
function toggleAddTaskInput() {
    const wrapper = document.getElementById('add-task-input-wrapper');
    const btn = document.getElementById('add-task-btn');
    
    if (wrapper.style.display === 'none') {
        wrapper.style.display = 'flex';
        taskInput.focus();
        taskInput.select();
    } else {
        wrapper.style.display = 'none';
        taskInput.value = '';
    }
}

// ── Add Task ──
function addTask() {
    const text = taskInput.value.trim();
    if (!text) { shakeInput(); return; }
    tasks.unshift({
        id: Date.now().toString(),
        text,
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null
    });
    saveTasks();
    taskInput.value = '';
    toggleAddTaskInput();
    renderAll();
    showToast('Task added ✓');
}

function focusAddInput() {
    const wrapper = document.getElementById('add-task-input-wrapper');
    if (!wrapper) return;
    
    if (wrapper.style.display === 'none' || wrapper.style.display === '') {
        wrapper.style.display = 'flex';
        const input = document.getElementById('task-input');
        if (input) {
            input.focus();
            input.select();
        }
    } else {
        const input = document.getElementById('task-input');
        input.focus();
    }
}

// ── Toggle Complete ──
async function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    if (task.completed) { showToast('Completed tasks cannot be unchecked'); renderAll(); return; }
    
    task.completed = true;
    task.completedAt = new Date().toISOString();
    
    await saveTasks(); // Saves Daily to Cloud
    renderAll();
    
    // This part tells the other lists (Monthly/Yearly) to complete too
    if (task.monthlyTaskId) await syncCompletionToMonthly(task.monthlyTaskId, true);
    if (task.yearlyTaskId !== undefined) await syncCompletionToYearly(task.yearlyTaskId, task.yearlyMonthIndex, true);
    
    showToast('Task completed! 🎉');
}
// ── Sync completion ──
async function syncCompletionToMonthly(monthlyTaskId, completed) {
    try {
        const monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        const monthlyTask = monthlyTasks.find(t => t.id === monthlyTaskId || t.id === 'y2m_'+monthlyTaskId);
        if (monthlyTask) {
            monthlyTask.completed = completed;
            monthlyTask.completedAt = completed ? new Date().toISOString() : null;
            // CRITICAL: Push updated monthly list to cloud
            await SyncManager.saveData('taskflow_monthly_tasks', monthlyTasks);
            
            if (monthlyTask.yearlyTaskId !== undefined) {
                syncCompletionToYearly(monthlyTask.yearlyTaskId, monthlyTask.yearlyMonthIndex, completed);
            }
        }
    } catch(e) { console.error(e); }
}
async function syncCompletionToYearly(yearlyTaskId, monthIndex, completed) {
    try {
        const yearlyData = JSON.parse(localStorage.getItem('taskflow_yearly_data')) || {};
        // If monthIndex is missing, find it
        if (monthIndex === undefined) {
            for (let i = 0; i < 12; i++) {
                if (yearlyData[i]?.find(t => t.id === yearlyTaskId)) {
                    monthIndex = i;
                    break;
                }
            }
        }
        const monthTasks = yearlyData[monthIndex] || [];
        const yearlyTask = monthTasks.find(t => t.id === yearlyTaskId);
        if (yearlyTask) {
            yearlyTask.completed = completed;
            yearlyData[monthIndex] = monthTasks;
            // CRITICAL: Push updated yearly list to cloud
            await SyncManager.saveData('taskflow_yearly_data', yearlyData);
        }
    } catch(e) { console.error(e); }
}
// ── Edit Task ──
function startEdit(id) {
    const task = tasks.find(t => t.id === id);
    if (!task || task.completed) { showToast('Cannot edit completed tasks'); return; }

    const li = document.querySelector(`[data-id="${id}"]`);
    if (!li) return;

    const textEl = li.querySelector('.task-text');
    const actionsEl = li.querySelector('.task-actions');

    // Replace text with input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;
    input.maxLength = 200;
    textEl.replaceWith(input);
    input.focus();
    input.select();

    // Swap edit btn for save btn
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
    if (!newText) { shakeInput(); return; }
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
async function deleteTask(id) {
    const taskToDelete = tasks.find(t => t.id === id);
    if (!taskToDelete) return;

    // 1. If it came from Monthly, tell Monthly to stop syncing it
    if (taskToDelete.monthlyTaskId) {
        let monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        const sourceIndex = monthlyTasks.findIndex(mt => mt.id === taskToDelete.monthlyTaskId);
        if (sourceIndex !== -1) {
            monthlyTasks[sourceIndex].dontSyncToDaily = true;
            await SyncManager.saveData('taskflow_monthly_tasks', monthlyTasks);
        }
    }

    // 2. Remove from local list
    tasks = tasks.filter(t => t.id !== id);
    
    // 3. Save to Cloud
    await SyncManager.saveData(STORAGE_KEY, tasks);
    renderAll();
    showToast("Task deleted ✓");
}

function confirmDelete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    confirmMode = 'delete';
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
    confirmMode = 'clear-completed';
    document.getElementById('confirm-icon').textContent = '🧹';
    document.getElementById('confirm-title').textContent = 'Clear Completed Tasks?';
    document.getElementById('confirm-body').textContent = 'All completed tasks will be removed. This action cannot be undone.';
    document.getElementById('confirm-ok').textContent = 'Clear Completed';
    document.getElementById('confirm-ok').style.borderColor = 'rgba(255,150,80,0.3)';
    document.getElementById('confirm-ok').style.background = 'rgba(255,150,80,0.18)';
    document.getElementById('confirm-ok').style.color = '#ff9d6e';
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
    confirmMode = 'clear-all';
    document.getElementById('confirm-icon').textContent = '⚠️';
    document.getElementById('confirm-title').textContent = 'Clear All Tasks?';
    document.getElementById('confirm-body').textContent = 'All tasks will be permanently removed. This action cannot be undone.';
    document.getElementById('confirm-ok').textContent = 'Clear All';
    document.getElementById('confirm-ok').style.borderColor = 'rgba(255,60,60,0.4)';
    document.getElementById('confirm-ok').style.background = 'rgba(255,60,60,0.25)';
    document.getElementById('confirm-ok').style.color = '#ff4d4d';
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
    // sort
    list.sort((a, b) => {
        if (currentSort === 'newest')     return new Date(b.createdAt) - new Date(a.createdAt);
        if (currentSort === 'oldest')     return new Date(a.createdAt) - new Date(b.createdAt);
        if (currentSort === 'alpha-asc')  return a.text.localeCompare(b.text);
        if (currentSort === 'alpha-desc') return b.text.localeCompare(a.text);
        if (currentSort === 'status')     return (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
        return 0;
    });
    return list;
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

// ── Sort Panel (unused - sort is now in search bar) ──
function toggleSortPanel() {}
function closeSortPanel() {}

// ── Search ──
function toggleSearch() {
    // Make sure 'top-header' matches the ID in your daily.html
    const header = document.getElementById('top-header'); 
    const btn = document.getElementById('search-nav-btn');
    
    if (!header) return; // Safety check

    const isOpen = header.classList.contains('expanded');
    if (isOpen) { 
        closeSearch(); 
    } else {
        header.classList.add('expanded');
        document.body.classList.add('search-open');
        if (btn) btn.classList.add('search-active');
        setTimeout(() => document.getElementById('search-input')?.focus(), 200);
    }
}
function closeSearch() {
    const header = document.getElementById('top-header');
    const btn = document.getElementById('search-nav-btn');
    header.classList.remove('expanded');
    document.body.classList.remove('search-open');
    btn && btn.classList.remove('search-active');
    clearSearch();
}
function clearSearch() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.remove('visible');
    searchQuery = '';
    renderAll();
}

// ── Render ──
function renderAll() {
    const filtered = getFiltered();
    taskList.innerHTML = '';
    const hasCompleted = tasks.some(t => t.completed);
    const clearCompletedBtn = document.getElementById('clear-completed-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    
    if (clearCompletedBtn) clearCompletedBtn.classList.toggle('show', hasCompleted);
    if (clearAllBtn) clearAllBtn.classList.toggle('show', tasks.length > 0);

    if (filtered.length === 0) {
        emptyState.classList.add('show');
    } else {
        emptyState.classList.remove('show');
        filtered.forEach(task => taskList.appendChild(createTaskEl(task)));
    }
    updateProgress();
    updateHeaderStats();
}

function createTaskEl(task) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '') + (task.fromMonthly ? ' imported' : '');
    li.dataset.id = task.id;

    const createdTime = formatTime(task.createdAt);
    const completedTime = task.completedAt ? formatTime(task.completedAt) : '';

    let importBadge = '';
    if (task.fromYearly) {
        importBadge = `<span class="yearly-import-badge">⭐ From Yearly</span>`;
    } else if (task.fromMonthly) {
        importBadge = `<span class="monthly-import-badge">📥 From Monthly</span>`;
    }

    const editBtn = !task.completed
        ? `<button class="action-btn edit" title="Edit" onclick="startEdit('${task.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
           </button>`
        : '';

    li.innerHTML = `
        <label class="task-checkbox">
            <input type="checkbox" ${task.completed ? 'checked disabled' : ''}
                   ${!task.completed ? `onchange="toggleTask('${task.id}')"` : ''}>
            <span class="checkmark ${task.completed ? 'locked' : ''}">
                <svg viewBox="0 0 16 12">
                    <polyline points="1,6 5,10 14,1"/>
                </svg>
            </span>
        </label>
        <div class="task-body">
            <div class="task-text">${escapeHtml(task.text)}</div>
            <div class="task-meta">
                <span class="task-time">Added ${createdTime}</span>
                ${importBadge}
                ${task.completed
                    ? `<span class="completed-badge">✔ Done at ${completedTime}</span>`
                    : ''}
            </div>
        </div>
        <div class="task-actions">
            ${editBtn}
            <button class="action-btn delete" title="Delete" onclick="confirmDelete('${task.id}')">✕</button>
        </div>
    `;
    return li;
}

// ── Progress ──
function updateProgress() {
    const total     = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = pct + '%';
}

// ── Header stats ──
function updateHeaderStats() {
    const total     = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    if (headerStats) {
        headerStats.innerHTML = `
            <span class="stat-badge done">${completed}</span>
            <span class="stat-sep">/</span>
            <span class="stat-badge total">${total}</span>
        `;
    }
}
function updateHeader() { updateHeaderStats(); }

// ── Helpers ──
function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function shakeInput() {
    const wrapper = document.querySelector('.add-task-input-wrapper');
    if (!wrapper) return;
    wrapper.style.animation = 'none';
    wrapper.offsetHeight;
    wrapper.style.animation = 'shake 0.35s ease';
    setTimeout(() => { wrapper.style.animation = ''; }, 400);
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

// ── Confirm Dialog ──
function closeConfirm() {
    const confirmOk = document.getElementById('confirm-ok');
    // Reset to default colors
    confirmOk.style.borderColor = 'rgba(255,80,80,0.3)';
    confirmOk.style.background = 'rgba(255,80,80,0.18)';
    confirmOk.style.color = '#ff6b6b';
    confirmOk.textContent = 'Delete';
    
    document.getElementById('confirm-overlay').classList.remove('open');
    pendingConfirmCallback = null;
    confirmMode = null;
}

// ── Shake keyframe ──
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-6px); }
    40%       { transform: translateX(6px); }
    60%       { transform: translateX(-4px); }
    80%       { transform: translateX(4px); }
}`;
document.head.appendChild(shakeStyle);

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

async function runMonthlyToDailyBridge() {
    if (localStorage.getItem('taskflow_daily_sync_enabled') !== 'true') return;

    const todayDay = new Date().getDate();
    const monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
    let hasNewExport = false;

    const dueToday = monthlyTasks.filter(mt => mt.dueDay === todayDay && !mt.completed);

    dueToday.forEach(mt => {
        const deterministicId = 'm2d_' + mt.id;
        // Check global 'tasks' array instead of re-reading from storage
        if (!tasks.find(t => t.id === deterministicId)) {
            tasks.unshift({
                id: deterministicId, 
                monthlyTaskId: mt.id,
                text: mt.text,
                fromMonthly: true,
                completed: false,
                createdAt: new Date().toISOString()
            });
            hasNewExport = true;
        }
    });

    if (hasNewExport) {
        // This will trigger saveData AND re-render the UI
        await SyncManager.saveData(STORAGE_KEY, tasks);
        renderAll();
    }
}

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Listen to Daily Tasks
        SyncManager.initRealTimeData(user.uid, STORAGE_KEY, (updatedData) => {
            tasks = updatedData;
            renderAll();
        });

        // 2. Listen to Monthly Tasks (This triggers the bridge automatically)
        SyncManager.initRealTimeData(user.uid, 'taskflow_monthly_tasks', () => {
            runMonthlyToDailyBridge();
        });

        // 3. Listen to Yearly Tasks
        SyncManager.initRealTimeData(user.uid, 'taskflow_yearly_data', async () => {
            await runYearlyToMonthlyBridgeLogic(); 
            runMonthlyToDailyBridge();
        });

        SyncManager.watchSettings(user.uid);
        await SyncManager.downloadAllFromCloud();
        runMonthlyToDailyBridge();
    }
});

async function runYearlyToMonthlyBridgeLogic() {
    if (localStorage.getItem('taskflow_yearly_sync_enabled') !== 'true') return;
    const currentMonthIndex = new Date().getMonth();
    const yearlyData = JSON.parse(localStorage.getItem('taskflow_yearly_data')) || {};
    let monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
    const yearlyTasksForThisMonth = yearlyData[currentMonthIndex] || [];
    let hasNewExport = false;

    yearlyTasksForThisMonth.forEach(yt => {
        const isAlreadyExported = monthlyTasks.find(mt => mt.yearlyTaskId === yt.id);
        if (!isAlreadyExported && !yt.completed) {
            monthlyTasks.push({
                id: 'y2m_' + yt.id,
                yearlyTaskId: yt.id,
                text: yt.text,
                dueDay: yt.day,
                fromYearly: true,
                completed: false
            });
            hasNewExport = true;
        }
    });
    if (hasNewExport) {
        await SyncManager.saveData('taskflow_monthly_tasks', monthlyTasks);
    }
}
// Add this to the end of daily.js
window.runMonthlyToDailyBridge = runMonthlyToDailyBridge;
window.addTask = addTask;
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.confirmDelete = confirmDelete;
window.toggleSearch = toggleSearch;
window.closeSearch = closeSearch;
window.clearSearch = clearSearch;
window.focusAddInput = focusAddInput;
window.toggleAddTaskInput = toggleAddTaskInput;
window.refreshDailyTasks = refreshDailyTasks;
window.confirmClearCompleted = confirmClearCompleted;
window.confirmClearAll = confirmClearAll;
window.startEdit = startEdit;
window.goHome = goHome;
window.closeConfirm = closeConfirm; // Critical for the dialog to close
window.runYearlyToMonthlyBridgeLogic = runYearlyToMonthlyBridgeLogic;
