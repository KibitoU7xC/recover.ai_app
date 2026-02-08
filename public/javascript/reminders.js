// DOM Elements
const addReminderForm = document.getElementById('addReminderForm');
const addMessage = document.getElementById('addMessage');
const todayRemindersList = document.getElementById('todayRemindersList');
const historyRemindersList = document.getElementById('historyRemindersList');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editForm');
const editMessage = document.getElementById('editMessage');
const closeBtn = document.querySelector('.close-btn');
let currentFilter = 'all';
let allHistoryReminders = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadTodayReminders();
    loadHistoryReminders();
});

// Tab switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.getAttribute('data-tab');
        
        // Remove active class from all tabs
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(tc => tc.classList.remove('active'));
        
        // Add active class to clicked tab
        btn.classList.add('active');
        document.getElementById(tabName).classList.add('active');
        
        // Reload reminders when switching to history
        if (tabName === 'history') {
            loadHistoryReminders();
        }
    });
});

// Add Reminder Form Submit
addReminderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const medicine = document.getElementById('medicineName').value;
    const reminderTime = document.getElementById('reminderTime').value;
    
    try {
        const response = await fetch('/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ medicine, reminderTime })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(addMessage, 'Reminder added successfully! ✓', 'success');
            addReminderForm.reset();
            setTimeout(() => loadTodayReminders(), 500);
        } else {
            showMessage(addMessage, 'Error adding reminder', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showMessage(addMessage, 'Network error occurred', 'error');
    }
});

// Load today's reminders
async function loadTodayReminders() {
    try {
        const response = await fetch('/reminders/today');
        const reminders = await response.json();
        
        if (reminders.length === 0) {
            todayRemindersList.innerHTML = '<div class="empty-state"><p>No reminders for today yet</p></div>';
        } else {
            todayRemindersList.innerHTML = reminders.map(reminder => createReminderCard(reminder)).join('');
            addReminderEventListeners();
        }
    } catch (error) {
        console.error('Error loading reminders:', error);
    }
}

// Load all history reminders
async function loadHistoryReminders() {
    try {
        const response = await fetch('/reminders/history');
        allHistoryReminders = await response.json();
            renderHistoryReminders();
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Render history reminders with filter
function renderHistoryReminders() {
    const filtered = allHistoryReminders; // show all history

    if (filtered.length === 0) {
        historyRemindersList.innerHTML = '<div class="empty-state"><p>No reminder history yet</p></div>';
    } else {
        historyRemindersList.innerHTML = filtered.map(reminder => createReminderCard(reminder, true)).join('');
        addReminderEventListeners();
    }
}

// Create reminder card HTML
function createReminderCard(reminder, isHistory = false) {
    const date = new Date(reminder.createdAt);
    const dateStr = date.toLocaleDateString();
    
    return `
        <div class="reminder-card">
            <div class="reminder-header">
                <div>
                    <h4>${reminder.medicine}</h4>
                    <p class="reminder-time">🕐 ${reminder.reminderTime}</p>
                </div>
                
            </div>
            
            <div class="reminder-info">
                <small>${isHistory ? dateStr : 'Today'}</small>
                <small class="reminder-id">ID: ${reminder._id.slice(0, 8)}...</small>
            </div>
            
            <div class="reminder-actions">
                <button class="btn-action edit-btn" data-id="${reminder._id}" title="Edit reminder">
                    ✎
                </button>
                <button class="btn-action delete-btn" data-id="${reminder._id}" title="Delete reminder">
                    🗑️
                </button>
                
            </div>
        </div>
    `;
}

// Add event listeners for reminder cards
function addReminderEventListeners() {
    // (Removed complete button handlers)
    
    // Edit buttons (use button element dataset to avoid event.target pitfalls)
    document.querySelectorAll('.edit-btn').forEach(btn => {
        const id = btn.getAttribute('data-id');
        btn.addEventListener('click', async () => openEditModal(id));
    });

    // Delete buttons
    document.querySelectorAll('.delete-btn').forEach(btn => {
        const id = btn.getAttribute('data-id');
        btn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete this reminder?')) {
                await deleteReminder(id);
            }
        });
    });
    
    // skip button removed — history only supports edit/delete
}

// completeReminder was removed because the UI no longer exposes a complete button

// updateReminderStatus removed (no status UI)

// Delete reminder
async function deleteReminder(id) {
    try {
        const response = await fetch(`/reminders/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadTodayReminders();
            loadHistoryReminders();
        }
    } catch (error) {
        console.error('Error deleting reminder:', error);
    }
}

// Open edit modal
async function openEditModal(id) {
    try {
        const response = await fetch(`/reminders/history`);
        const reminders = await response.json();
        const reminder = reminders.find(r => r._id === id);
        
        if (reminder) {
            document.getElementById('editId').value = reminder._id;
            document.getElementById('editMedicine').value = reminder.medicine;
            document.getElementById('editTime').value = reminder.reminderTime;
            editModal.style.display = 'block';
        }
    } catch (error) {
        console.error('Error opening modal:', error);
    }
}

// Close modal
closeBtn.addEventListener('click', () => {
    editModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === editModal) {
        editModal.style.display = 'none';
    }
});

// Edit form submit
editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('editId').value;
    const medicine = document.getElementById('editMedicine').value;
    const reminderTime = document.getElementById('editTime').value;
    
    try {
        const response = await fetch(`/reminders/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ medicine, reminderTime })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(editMessage, 'Reminder updated successfully! ✓', 'success');
            setTimeout(() => {
                editModal.style.display = 'none';
                loadTodayReminders();
                loadHistoryReminders();
            }, 500);
        } else {
            showMessage(editMessage, 'Error updating reminder', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showMessage(editMessage, 'Network error occurred', 'error');
    }
});

// no filter buttons (history shows all reminders)

// Show message function
function showMessage(element, message, type) {
    element.textContent = message;
    element.className = `message ${type}`;
    element.style.display = 'block';
    
    setTimeout(() => {
        element.style.display = 'none';
    }, 3000);
}
