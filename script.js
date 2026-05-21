function addTask() {
    const input = document.getElementById('task-input');
    const list = document.getElementById('task-list');

    if (input.value.trim() === "") {
        alert("Please enter a task!");
        return;
    }

    const li = document.createElement('li');
    li.className = 'task-item';
    li.innerHTML = `
        <span onclick="toggleComplete(this)">${input.value}</span>
        <i class="delete-btn" onclick="deleteTask(this)">Delete</i>
    `;

    list.appendChild(li);
    input.value = "";
}

function toggleComplete(element) {
    element.parentElement.classList.toggle('completed');
}

function deleteTask(element) {
    element.parentElement.remove();
}

// Enter key support
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        addTask();
    }
});