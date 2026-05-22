import { SyncManager } from './sync-manager.js';
import { onSnapshot, db, doc, auth } from './firebase-config.js';

const STORAGE_KEY = 'taskflow_yearly_data'

// State Management
const params = new URLSearchParams(window.location.search);
const mIndex = parseInt(params.get('m') || 0);
const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let yearlyData = JSON.parse(localStorage.getItem('taskflow_yearly_data')) || {};
let tasks = yearlyData[mIndex] || [];
let currentFilter = 'all';
let currentSort = 'date-asc';
let searchQuery = '';
let pendingConfirmCallback = null;
let editingTaskId = null;

// DOM Elements
const taskList = document.getElementById('task-list');
const monthTitle = document.getElementById('page-month-name');
const heroLabel = document.getElementById('hero-month-label');
const topHeader = document.getElementById('top-header');
const searchInput = document.getElementById('search-input');
const searchCloseBtn = document.getElementById('search-close-btn');

// Initialize
function init() {
    monthTitle.textContent = months[mIndex];
    heroLabel.textContent = months[mIndex].toUpperCase() + " TODO";
    renderAll();
    setupFilters();
    setupSort();
    setupSearch();
    checkAndInjectToMonthly();
    
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

    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }
}

function renderAll() {
    taskList.innerHTML = '';
    let filtered = tasks.filter(t => {
        if (currentFilter === 'active') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
        return true;
    });

    if (searchQuery) {
        filtered = filtered.filter(t =>
            t.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (t.desc && t.desc.toLowerCase().includes(searchQuery.toLowerCase()))
        );
    }

    // Sort
    filtered.sort((a, b) => {
        if (currentSort === 'date-asc') return a.day - b.day;
        if (currentSort === 'date-desc') return b.day - a.day;
        if (currentSort === 'alpha') return a.text.localeCompare(b.text);
        return 0;
    });

    if (filtered.length === 0) {
        document.getElementById('empty-state').classList.add('show');
    } else {
        document.getElementById('empty-state').classList.remove('show');

        let lastDay = null;
        filtered.forEach((task) => {
            if ((currentSort === 'date-asc' || currentSort === 'date-desc') && task.day !== lastDay) {
                const divider = document.createElement('div');
                divider.className = 'date-divider';
                divider.textContent = `${months[mIndex]} ${task.day}`;
                taskList.appendChild(divider);
                lastDay = task.day;
            }

            const li = document.createElement('li');
            li.className = `task-item ${task.completed ? 'completed' : ''}`;
            li.dataset.id = task.id;
            li.innerHTML = `
                <div class="task-check ${task.completed ? 'locked' : ''}" ${task.completed ? '' : `onclick="toggleTask('${task.id}')"`}>${task.completed ? '✓' : ''}</div>
                <div class="task-body">
                    <span class="task-text">${escapeHtml(task.text)}</span>
                    ${task.desc ? `<span class="task-desc">${escapeHtml(task.desc)}</span>` : ''}
                    <span class="task-time">${task.time || '11:30'}</span>
                </div>
                <div class="task-actions">
                    ${!task.completed ? `<button class="action-btn edit-btn" onclick="editTask('${task.id}')" title="Edit">✎</button>` : ''}
                    <button class="action-btn delete-btn" onclick="confirmDelete('${task.id}')" title="Delete">✕</button>
                </div>
            `;
            taskList.appendChild(li);
        });
    }

    updateStats();
}

function saveTask() {
    const text = document.getElementById('input-text').value.trim();
    const desc = document.getElementById('input-desc').value.trim();
    const day = document.getElementById('input-day').value;
    let time = document.getElementById('input-time').value;

    if (!text) {
        shakeElement(document.getElementById('input-text'));
        showToast('Please enter a task name');
        return;
    }

    if (!day) {
        shakeElement(document.getElementById('input-day'));
        showToast('Please enter a day (1-31)');
        return;
    }

    const dayNum = parseInt(day);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
        shakeElement(document.getElementById('input-day'));
        showToast('Please enter a valid day (1-31)');
        return;
    }

    if (!time) time = '11:30';

    if (editingTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === editingTaskId);
        if (taskIndex !== -1) {
            tasks[taskIndex] = {
                ...tasks[taskIndex],
                text: text,
                desc: desc,
                day: dayNum,
                time: time
            };
            syncEditToMonthlyAndDaily(editingTaskId, text, desc, dayNum, time);
            showToast('Task updated! ✓');
        }
        editingTaskId = null;
    } else {
        const newTask = {
            id: Date.now().toString(),
            text: text,
            desc: desc,
            day: dayNum,
            time: time,
            completed: false
        };
        tasks.push(newTask);
        showToast('Task added! ✓');
    }

    saveData();
    closeModal();
    renderAll();
    performImmediateSync();
}

function syncEditToMonthlyAndDaily(yearlyTaskId, text, desc, day, time) {
    const syncEnabled = localStorage.getItem('taskflow_yearly_sync_enabled') === 'true';
    if (!syncEnabled) return;

    try {
        const now = new Date();
        const currentYear = now.getFullYear();

        const monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        let monthlyChanged = false;
        monthlyTasks.forEach(mt => {
            if (mt.yearlyTaskId === yearlyTaskId && mt.yearlyMonthIndex === mIndex) {
                mt.text = text;
                mt.description = desc || '';
                mt.dueDay = day;
                mt.dueTime = time || '11:30';
                const m = String(mIndex + 1).padStart(2, '0');
                const d = String(day).padStart(2, '0');
                mt.dueDate = currentYear + '-' + m + '-' + d;
                monthlyChanged = true;
            }
        });
        if (monthlyChanged) {
            localStorage.setItem('taskflow_monthly_tasks', JSON.stringify(monthlyTasks));
        }

        const dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
        let dailyChanged = false;
        dailyTasks.forEach(dt => {
            if (dt.yearlyTaskId === yearlyTaskId) {
                dt.text = text;
                dailyChanged = true;
            }
        });
        if (dailyChanged) {
            localStorage.setItem('taskflow_daily_tasks', JSON.stringify(dailyTasks));
        }
    } catch (e) {
        console.error('syncEditToMonthlyAndDaily error:', e);
    }
}

function performImmediateSync() {
    if (localStorage.getItem('taskflow_yearly_sync_enabled') !== 'true') return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    if (mIndex !== currentMonth) return;

    try {
        let monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        let dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];

        tasks.forEach(yt => {
            const existingMonthlySync = monthlyTasks.find(mt => mt.yearlyTaskId === yt.id && mt.yearlyMonthIndex === mIndex);
            if (existingMonthlySync) return;
            if (yt.completed) return;

            const m = String(currentMonth + 1).padStart(2, '0');
            const d = String(yt.day).padStart(2, '0');

            const newMonthlyTask = {
                id: 'y2m_' + yt.id + '_' + Date.now(),
                yearlyTaskId: yt.id,
                yearlyMonthIndex: mIndex,
                text: yt.text,
                description: yt.desc || '',
                dueDay: yt.day,
                dueDate: currentYear + '-' + m + '-' + d,
                dueTime: yt.time || '11:30',
                scope: 'month',
                completed: false,
                completedAt: null,
                createdAt: new Date().toISOString(),
                fromYearly: true
            };

            monthlyTasks.push(newMonthlyTask);

            if (yt.day === currentDay) {
                const existingDailySync = dailyTasks.find(dt => dt.yearlyTaskId === yt.id);
                if (!existingDailySync) {
                    dailyTasks.push({
                        id: 'y2d_' + yt.id + '_' + Date.now(),
                        yearlyTaskId: yt.id,
                        yearlyMonthIndex: mIndex,
                        monthlyTaskId: newMonthlyTask.id,
                        text: yt.text,
                        completed: false,
                        createdAt: new Date().toISOString(),
                        completedAt: null,
                        fromMonthly: true,
                        fromYearly: true
                    });
                }
            }
        });

        localStorage.setItem('taskflow_monthly_tasks', JSON.stringify(monthlyTasks));
        localStorage.setItem('taskflow_daily_tasks', JSON.stringify(dailyTasks));
    } catch (e) {
        console.error('performImmediateSync error:', e);
    }
}

function editTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    editingTaskId = id;
    document.getElementById('input-text').value = task.text;
    document.getElementById('input-desc').value = task.desc || '';
    document.getElementById('input-day').value = task.day;
    document.getElementById('input-time').value = task.time || '11:30';

    const modalTitle = document.querySelector('.modal-title');
    if (modalTitle) modalTitle.textContent = 'Edit Task';

    openModal();
}

function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    if (task.completed) {
        showToast('Completed tasks cannot be unchecked');
        renderAll();
        return;
    }
    task.completed = true;
    saveData();
    syncCompletionToMonthlyAndDaily(id);
    renderAll();
    showToast('Task completed! 🎉');
}

function confirmDelete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('confirm-icon').textContent = '🗑';
    document.getElementById('confirm-title').textContent = 'Delete Task?';
    document.getElementById('confirm-body').textContent = `"${task.text}" will be permanently removed.`;
    document.getElementById('confirm-ok').textContent = 'Delete';

    pendingConfirmCallback = () => { deleteTask(id); };
    document.getElementById('confirm-overlay').classList.add('open');
}

function deleteTask(id) {
    try {
        let monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        monthlyTasks = monthlyTasks.filter(mt => !(mt.yearlyTaskId === id && mt.yearlyMonthIndex === mIndex));
        localStorage.setItem('taskflow_monthly_tasks', JSON.stringify(monthlyTasks));
    } catch (e) {}

    try {
        let dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
        dailyTasks = dailyTasks.filter(dt => dt.yearlyTaskId !== id);
        localStorage.setItem('taskflow_daily_tasks', JSON.stringify(dailyTasks));
    } catch (e) {}

    tasks = tasks.filter(t => t.id !== id);
    saveData();
    renderAll();
    showToast('Task removed');
}

function saveData() {
    yearlyData[mIndex] = tasks;
    SyncManager.saveData('taskflow_yearly_data', yearlyData);
}

function syncCompletionToMonthlyAndDaily(yearlyTaskId) {
    try {
        const monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        let monthlyChanged = false;
        monthlyTasks.forEach(mt => {
            if (mt.yearlyTaskId === yearlyTaskId && mt.yearlyMonthIndex === mIndex) {
                mt.completed = true;
                mt.completedAt = new Date().toISOString();
                monthlyChanged = true;
            }
        });
        if (monthlyChanged) {
            localStorage.setItem('taskflow_monthly_tasks', JSON.stringify(monthlyTasks));
        }

        const dailyTasks = JSON.parse(localStorage.getItem('taskflow_daily_tasks')) || [];
        let dailyChanged = false;
        dailyTasks.forEach(dt => {
            if (dt.yearlyTaskId === yearlyTaskId) {
                dt.completed = true;
                dt.completedAt = new Date().toISOString();
                dailyChanged = true;
            }
        });
        if (dailyChanged) {
            localStorage.setItem('taskflow_daily_tasks', JSON.stringify(dailyTasks));
        }
    } catch (e) {}
}

function checkAndInjectToMonthly() {
    if (localStorage.getItem('taskflow_yearly_sync_enabled') !== 'true') return;

    const injectedKey = 'taskflow_yearly_injected_' + mIndex + '_' + new Date().getFullYear();
    if (localStorage.getItem(injectedKey) === 'true') return;

    if (mIndex !== new Date().getMonth()) return;

    try {
        let monthlyTasks = JSON.parse(localStorage.getItem('taskflow_monthly_tasks')) || [];
        const existingIds = new Set(monthlyTasks.filter(mt => mt.yearlyTaskId).map(mt => mt.yearlyTaskId));

        tasks.forEach(yt => {
            if (existingIds.has(yt.id)) return;

            const now = new Date();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(yt.day).padStart(2, '0');

            monthlyTasks.push({
                id: 'y2m_' + yt.id + '_' + Date.now(),
                yearlyTaskId: yt.id,
                yearlyMonthIndex: mIndex,
                text: yt.text,
                description: yt.desc || '',
                dueDay: yt.day,
                dueDate: now.getFullYear() + '-' + m + '-' + d,
                dueTime: yt.time || '11:30',
                scope: 'month',
                completed: yt.completed,
                completedAt: yt.completed ? new Date().toISOString() : null,
                createdAt: new Date().toISOString(),
                fromYearly: true
            });
        });

        localStorage.setItem('taskflow_monthly_tasks', JSON.stringify(monthlyTasks));
        localStorage.setItem(injectedKey, 'true');
    } catch (e) {}
}

function updateStats() {
    const done = tasks.filter(t => t.completed).length;
    const total = tasks.length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    document.querySelector('.stat-badge.done').textContent = done;
    document.querySelector('.stat-badge.total').textContent = total;
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-fill').style.width = pct + '%';
}

// UI Helpers
function openModal() {
    document.getElementById('modal-overlay').classList.add('open');
    setTimeout(() => document.getElementById('input-text').focus(), 300);
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('input-text').value = '';
    document.getElementById('input-desc').value = '';
    document.getElementById('input-day').value = '';
    document.getElementById('input-time').value = '';

    const modalTitle = document.querySelector('.modal-title');
    if (modalTitle) modalTitle.textContent = 'New Yearly Task';

    editingTaskId = null;
}

function toggleSearch() {
    topHeader.classList.add('expanded');
    document.getElementById('search-nav-btn').classList.add('search-active');
    setTimeout(() => searchInput.focus(), 300);
}

function closeSearch() {
    topHeader.classList.remove('expanded');
    document.getElementById('search-nav-btn').classList.remove('search-active');
    searchInput.value = '';
    searchQuery = '';
    searchCloseBtn.classList.remove('visible');
    renderAll();
}

function setupFilters() {
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderAll();
        };
    });
}

function setupSort() {
    document.querySelectorAll('.sort-pill').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.sort-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSort = btn.dataset.sort;
            renderAll();
        };
    });
}

function setupSearch() {
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        searchCloseBtn.classList.toggle('visible', searchQuery.length > 0);
        renderAll();
    });
}

function refreshPage() {
    window.location.reload();
}

function shakeElement(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake 0.35s ease';
    setTimeout(() => el.style.animation = '', 400);
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}

function closeConfirm() {
    document.getElementById('confirm-overlay').classList.remove('open');
    pendingConfirmCallback = null;
}

// Shake animation
const style = document.createElement('style');
style.textContent = `
@keyframes shake {
    0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}
}`;
document.head.appendChild(style);

init();

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

// This tells the page: "As soon as we know who the user is, get their data."
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

window.openModal = openModal;
window.closeModal = closeModal;
window.saveTask = saveTask;
window.toggleTask = toggleTask;
window.confirmDelete = confirmDelete;
window.editTask = editTask;
window.toggleSearch = toggleSearch;
window.closeSearch = closeSearch;
window.refreshPage = refreshPage;
window.closeConfirm = closeConfirm;
