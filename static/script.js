// API Configuration
const API_BASE_URL = 'http://localhost:5000';

// State
let currentSessionId = null;
let isLoading = false;

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const typingIndicator = document.getElementById('typingIndicator');
const widgetContainer = document.getElementById('widgetContainer');
const widgetButton = document.getElementById('widgetButton');
const closeButton = document.getElementById('closeWidget');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkExistingSession();
    
    // Auto-resize textarea
    messageInput.addEventListener('input', autoResizeTextarea);
    
    // Widget toggle events
    widgetButton.addEventListener('click', toggleWidget);
    closeButton.addEventListener('click', closeWidget);
    
    // Close widget when clicking outside
    document.addEventListener('click', (e) => {
        if (widgetContainer.classList.contains('active') && 
            !widgetContainer.contains(e.target) && 
            !widgetButton.contains(e.target)) {
            closeWidget();
        }
    });
    
    // Prevent clicks inside widget from closing it
    widgetContainer.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});

// Toggle widget
function toggleWidget() {
    widgetContainer.classList.toggle('active');
    if (widgetContainer.classList.contains('active')) {
        messageInput.focus();
        // Scroll to bottom when widget opens
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }
}

// Close widget
function closeWidget() {
    widgetContainer.classList.remove('active');
}

// Auto-resize textarea
function autoResizeTextarea() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
}

// Clear messages container
function clearMessages() {
    messagesContainer.innerHTML = '';
}

// Show welcome message
function showWelcomeMessage() {
    messagesContainer.innerHTML = `
        <div class="welcome-message">
            <i class="fas fa-robot welcome-icon"></i>
            <h4>Hello! I'm your local AI assistant</h4>
            <p>How may I assist you today?</p>
        </div>
    `;
}

// Handle key down in textarea
function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// Format timestamp
function formatTimestamp(date) {
    const now = new Date();
    const messageDate = new Date(date);
    
    // Check if it's today
    if (messageDate.toDateString() === now.toDateString()) {
        return messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Check if it's yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (messageDate.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // For older messages, show date and time
    return messageDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + 
           messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Send message
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading) return;

    // Clear input and reset height
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Remove welcome message if present
    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.remove();
    }

    // Add user message to UI with timestamp
    const userMessageTime = new Date();
    addMessageToUI(message, 'user', [], userMessageTime);

    // Show typing indicator
    setIsLoading(true);

    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                session_id: currentSessionId,
                timestamp: userMessageTime.toISOString()
            })
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();
        
        // Update session ID
        currentSessionId = data.session_id;
        
        // Add assistant response to UI with timestamp
        const assistantTime = new Date(data.timestamp || new Date());
        addMessageToUI(data.message, 'assistant', data.actions, assistantTime);
        
    } catch (error) {
        console.error('Error:', error);
        addMessageToUI('Sorry, I encountered an error. Please try again.', 'assistant', [], new Date());
    } finally {
        setIsLoading(false);
    }
}

// Add message to UI
function addMessageToUI(content, role, actions = [], timestamp = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // Use provided timestamp or current time
    const messageTime = timestamp || new Date();
    const formattedTime = formatTimestamp(messageTime);
    const fullDateTime = messageTime.toLocaleString();
    
    let actionsHtml = '';
    if (actions && actions.length > 0) {
        actionsHtml = `
            <div class="message-actions">
                ${actions.map(action => `
                    <span class="action-item">
                        <i class="fas fa-cog"></i> ${action.type}
                    </span>
                `).join('')}
            </div>
        `;
    }
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>
            ${actionsHtml}
            <div class="message-time" title="${fullDateTime}">
                <i class="far fa-clock"></i> ${formattedTime}
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Set loading state
function setIsLoading(loading) {
    isLoading = loading;
    sendButton.disabled = loading;
    messageInput.disabled = loading;
    
    if (loading) {
        typingIndicator.classList.add('active');
    } else {
        typingIndicator.classList.remove('active');
    }
}

// Check for existing session
function checkExistingSession() {
    // Try to load previous messages from localStorage
    const savedMessages = localStorage.getItem('chat_history');
    if (savedMessages && widgetContainer.classList.contains('active')) {
        try {
            const messages = JSON.parse(savedMessages);
            messages.forEach(msg => {
                addMessageToUI(msg.content, msg.role, msg.actions || [], new Date(msg.timestamp));
            });
        } catch (e) {
            console.error('Error loading saved messages:', e);
            showWelcomeMessage();
        }
    } else {
        showWelcomeMessage();
    }
}

// Save messages to localStorage
function saveMessages() {
    const messages = [];
    document.querySelectorAll('.message').forEach(msgDiv => {
        const role = msgDiv.classList.contains('user') ? 'user' : 'assistant';
        const content = msgDiv.querySelector('.message-content p')?.innerText || '';
        const timeElement = msgDiv.querySelector('.message-time');
        let timestamp = new Date();
        
        if (timeElement && timeElement.getAttribute('title')) {
            timestamp = new Date(timeElement.getAttribute('title'));
        }
        
        messages.push({
            role: role,
            content: content,
            timestamp: timestamp.toISOString(),
            actions: []
        });
    });
    
    // Keep only last 100 messages
    if (messages.length > 100) {
        messages.splice(0, messages.length - 100);
    }
    
    localStorage.setItem('chat_history', JSON.stringify(messages));
}

// Save messages before page unload
window.addEventListener('beforeunload', () => {
    saveMessages();
});

// Clear chat history
function clearChatHistory() {
    if (confirm('Are you sure you want to clear all chat history?')) {
        localStorage.removeItem('chat_history');
        clearMessages();
        showWelcomeMessage();
        currentSessionId = null;
    }
}

// Create new chat
function createNewChat() {
    currentSessionId = null;
    clearMessages();
    showWelcomeMessage();
}