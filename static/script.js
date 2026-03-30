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
    messageInput.addEventListener('input', autoResizeTextarea);
    widgetButton.addEventListener('click', toggleWidget);
    closeButton.addEventListener('click', closeWidget);
    
    widgetContainer.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});

function toggleWidget() {
    widgetContainer.classList.toggle('active');
    if (widgetContainer.classList.contains('active')) {
        messageInput.focus();
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }
}

function closeWidget() {
    widgetContainer.classList.remove('active');
}

function autoResizeTextarea() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
}

function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function formatTimestamp(date) {
    const now = new Date();
    const msgDate = new Date(date);
    if (msgDate.toDateString() === now.toDateString()) {
        return msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + 
           msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';

    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) welcomeMessage.remove();

    addMessageToUI(message, 'user', [], new Date());

    // Create Assistant bubble for streaming
    const botMsgDiv = document.createElement('div');
    botMsgDiv.className = 'message assistant';
    botMsgDiv.innerHTML = `
        <div class="message-content">
            <p></p>
            <div class="message-actions" style="display:none;">
                <button class="action-item copy-btn" onclick="copyText(this)">
                    <i class="far fa-copy"></i> Copy
                </button>
            </div>
            <div class="message-time">
                <i class="far fa-clock"></i> ${formatTimestamp(new Date())}
            </div>
        </div>
    `;
    messagesContainer.appendChild(botMsgDiv);
    const botContent = botMsgDiv.querySelector('.message-content p');
    const botActions = botMsgDiv.querySelector('.message-actions');

    setIsLoading(true);

    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        typingIndicator.classList.remove('active');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            lines.forEach(line => {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        if (data && data.message) {
                            botContent.innerHTML += data.message.replace(/\n/g, '<br>');
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        }
                    } catch (e) {}
                }
            });
        }
        botActions.style.display = 'block';
    } catch (error) {
        botContent.innerText = "Connection error.";
    } finally {
        setIsLoading(false);
    }
}

function addMessageToUI(content, role, actions = [], timestamp = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    const messageTime = timestamp || new Date();
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <p>${content.replace(/\n/g, '<br>')}</p>
            <div class="message-time">
                <i class="far fa-clock"></i> ${formatTimestamp(messageTime)}
            </div>
        </div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setIsLoading(loading) {
    isLoading = loading;
    sendButton.disabled = loading;
    messageInput.disabled = loading;
    if (loading) typingIndicator.classList.add('active');
    else typingIndicator.classList.remove('active');
}

function checkExistingSession() {
    const savedMessages = localStorage.getItem('chat_history');
    if (savedMessages) {
        try {
            const messages = JSON.parse(savedMessages);
            messages.forEach(msg => addMessageToUI(msg.content, msg.role, [], new Date(msg.timestamp)));
        } catch (e) { showWelcomeMessage(); }
    } else { showWelcomeMessage(); }
}

function showWelcomeMessage() {
    messagesContainer.innerHTML = `
        <div class="welcome-message">
            <i class="fas fa-robot welcome-icon"></i>
            <h4>Hello! I'm your assistant</h4>
            <p>How may I be of service?</p>
        </div>  
    `;
}