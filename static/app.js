// Argoya - Anonymous Nostr Messenger Client

class ArgoyaMessenger {
    constructor() {
        this.crypto = new ArgoyaCrypto();
        this.sessionData = null;
        this.messages = [];
        this.activeUsers = [];
        this.socket = null;
        this.messagePollingInterval = null;
        this.userUpdateInterval = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeDarkMode();
        this.showScreen('login');
    }

    setupEventListeners() {
        // Login form
        document.getElementById('join-btn').addEventListener('click', () => this.joinService());
        document.getElementById('username-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinService();
        });

        // Chat form
        document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Leave button
        document.getElementById('leave-btn').addEventListener('click', () => this.leaveService());

        // Dark mode toggle - use event delegation to handle timing issues
        document.addEventListener('change', (e) => {
            if (e.target.id === 'dark-mode-switch') {
                this.toggleDarkMode(e.target.checked);
            }
        });

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(`${screenName}-screen`).classList.add('active');
    }

    async joinService() {
        const username = document.getElementById('username-input').value.trim();
        
        if (!username) {
            this.showError('Please enter a username');
            return;
        }

        if (username.length < 3 || username.length > 20) {
            this.showError('Username must be 3-20 characters long');
            return;
        }

        this.showScreen('loading');

        try {
            // Generate crypto keys
            const keyGenSuccess = await this.crypto.generateKeyPair();
            if (!keyGenSuccess) {
                throw new Error('Failed to generate encryption keys');
            }

            // Join service
            const response = await fetch('/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to join service');
            }

            this.sessionData = data;
            document.getElementById('username-display').textContent = `Anonymous as: ${username}`;
            
            this.showScreen('chat');
            this.startMessagePolling();
            this.startUserUpdates();
            
            this.showSuccess('Connected anonymously with end-to-end encryption');

        } catch (error) {
            console.error('Join failed:', error);
            this.showError(error.message);
            this.showScreen('login');
        }
    }

    async sendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();

        if (!message || !this.sessionData) {
            return;
        }

        const sendBtn = document.getElementById('send-btn');
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        try {
            // Encrypt message on client side
            const encryptedMessage = await this.crypto.encryptMessage(message);

            const response = await fetch('/send_message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionData.session_id,
                    message: encryptedMessage,
                    recipient: 'all'
                })
            });

            if (!response.ok) {
                throw new Error('Failed to send message');
            }

            // Add message to local display
            this.addMessage({
                sender: this.sessionData.username,
                message: message,
                timestamp: new Date().toISOString(),
                own: true
            });

            messageInput.value = '';
            messageInput.focus();

        } catch (error) {
            console.error('Send failed:', error);
            this.showError('Failed to send message');
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
        }
    }

    async startMessagePolling() {
        // Poll for messages every 2 seconds
        this.messagePollingInterval = setInterval(() => {
            this.fetchMessages();
        }, 2000);
        
        // Fetch initial messages
        this.fetchMessages();
    }

    async fetchMessages() {
        if (!this.sessionData) return;

        try {
            const response = await fetch('/get_messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionData.session_id
                })
            });

            if (!response.ok) return;

            const data = await response.json();
            
            // Process new messages
            for (const message of data.messages) {
                if (!this.messages.find(m => m.id === message.id)) {
                    let decryptedMessage = message.message;
                    
                    // Decrypt message if it's encrypted and not from us
                    if (message.encrypted && message.sender !== this.sessionData.username) {
                        decryptedMessage = await this.crypto.decryptMessage(message.message);
                    }
                    
                    this.addMessage({
                        id: message.id,
                        sender: message.sender,
                        message: decryptedMessage || '[Encrypted Message]',
                        timestamp: message.timestamp,
                        own: message.sender === this.sessionData.username
                    });
                }
            }

        } catch (error) {
            console.error('Message fetch failed:', error);
        }
    }

    async startUserUpdates() {
        // Update active users every 5 seconds
        this.userUpdateInterval = setInterval(() => {
            this.fetchActiveUsers();
        }, 5000);
        
        // Fetch initial users
        this.fetchActiveUsers();
    }

    async fetchActiveUsers() {
        try {
            const response = await fetch('/active_users');
            if (!response.ok) return;

            const data = await response.json();
            this.updateUserList(data.users);

        } catch (error) {
            console.error('User fetch failed:', error);
        }
    }

    updateUserList(users) {
        const userList = document.getElementById('user-list');
        const onlineCount = document.getElementById('online-count');
        
        userList.innerHTML = '';
        
        users.forEach(username => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            
            if (this.sessionData && username === this.sessionData.username) {
                userItem.classList.add('me');
            }
            
            userItem.textContent = username;
            userList.appendChild(userItem);
        });

        onlineCount.textContent = `${users.length} online`;
        this.activeUsers = users;
    }

    addMessage(messageData) {
        const container = document.getElementById('messages-container');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${messageData.own ? 'own' : ''}`;
        
        const time = new Date(messageData.timestamp).toLocaleTimeString();
        
        messageEl.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${messageData.own ? 'You' : messageData.sender}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${this.escapeHtml(messageData.message)}</div>
        `;
        
        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
        
        this.messages.push(messageData);
    }

    async leaveService() {
        if (!this.sessionData) return;

        try {
            await fetch('/leave', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionData.session_id
                })
            });

        } catch (error) {
            console.error('Leave failed:', error);
        }

        this.cleanup();
        this.showScreen('login');
        this.showSuccess('Left service - all data deleted');
    }

    cleanup() {
        // Clear intervals
        if (this.messagePollingInterval) {
            clearInterval(this.messagePollingInterval);
        }
        if (this.userUpdateInterval) {
            clearInterval(this.userUpdateInterval);
        }

        // Clear crypto keys
        this.crypto.cleanup();

        // Clear session data
        this.sessionData = null;
        this.messages = [];
        this.activeUsers = [];

        // Clear UI
        document.getElementById('username-input').value = '';
        document.getElementById('message-input').value = '';
        document.getElementById('messages-container').innerHTML = '';
        document.getElementById('user-list').innerHTML = '';
        document.getElementById('online-count').textContent = '0 online';
    }

    showError(message) {
        alert(`ERROR: ${message}`);
    }

    showSuccess(message) {
        console.log(`SUCCESS: ${message}`);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    initializeDarkMode() {
        // Check for saved theme preference or default to light mode
        const savedTheme = localStorage.getItem('argoya-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
        
        // Ensure theme is set (might already be set by early initialization)
        if (shouldUseDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        
        // Set switch state
        const switchElement = document.getElementById('dark-mode-switch');
        if (switchElement) {
            switchElement.checked = shouldUseDark;
        }
    }

    toggleDarkMode(isDark) {
        console.log('Dark mode toggled:', isDark); // Debug log
        
        if (isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('argoya-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('argoya-theme', 'light');
        }
        
        // Force a repaint to ensure the change is visible
        document.body.offsetHeight;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize dark mode first
    initializeDarkModeEarly();
    
    // Then initialize the messenger
    window.argoyaMessenger = new ArgoyaMessenger();
});

// Early dark mode initialization to prevent flash
function initializeDarkModeEarly() {
    const savedTheme = localStorage.getItem('argoya-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    
    if (shouldUseDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

// Security: Prevent right-click context menu and dev tools
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

document.addEventListener('keydown', (e) => {
    // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
    if (e.keyCode === 123 || 
        (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
        (e.ctrlKey && e.keyCode === 85)) {
        e.preventDefault();
    }
});
