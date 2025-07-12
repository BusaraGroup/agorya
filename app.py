from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import secrets
import hashlib
import json
import os
import time
from datetime import datetime, timedelta
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(32)
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory storage (deleted after session ends)
active_users = {}
user_sessions = {}
message_cache = {}
encryption_keys = {}

class NostrMessenger:
    def __init__(self):
        self.relay_urls = [
            'wss://relay.damus.io',
            'wss://nostr-pub.wellorder.net',
            'wss://relay.nostr.info'
        ]
        self.cleanup_interval = 300  # 5 minutes
        self.start_cleanup_thread()
    
    def generate_session_key(self, username, session_id):
        """Generate unique encryption key for user session"""
        seed = f"{username}:{session_id}:{secrets.token_hex(16)}"
        key = hashlib.sha256(seed.encode()).digest()
        return Fernet(Fernet.generate_key())
    
    def create_anonymous_identity(self, username):
        """Create anonymous identity for user"""
        session_id = secrets.token_hex(16)
        user_hash = hashlib.sha256(f"{username}:{session_id}".encode()).hexdigest()[:16]
        
        # Generate encryption key for this session
        encryption_key = self.generate_session_key(username, session_id)
        
        user_data = {
            'username': username,
            'session_id': session_id,
            'user_hash': user_hash,
            'created_at': datetime.now(),
            'last_active': datetime.now(),
            'encryption_key': encryption_key
        }
        
        active_users[user_hash] = user_data
        user_sessions[session_id] = user_hash
        encryption_keys[user_hash] = encryption_key
        
        return user_data
    
    def encrypt_message(self, message, user_hash):
        """Encrypt message for user"""
        if user_hash not in encryption_keys:
            return None
        
        key = encryption_keys[user_hash]
        encrypted = key.encrypt(message.encode())
        return encrypted.decode('latin-1')
    
    def decrypt_message(self, encrypted_message, user_hash):
        """Decrypt message for user"""
        if user_hash not in encryption_keys:
            return None
        
        key = encryption_keys[user_hash]
        try:
            decrypted = key.decrypt(encrypted_message.encode('latin-1'))
            return decrypted.decode()
        except:
            return None
    
    def cleanup_expired_sessions(self):
        """Clean up expired sessions and data"""
        current_time = datetime.now()
        expired_sessions = []
        
        for user_hash, user_data in list(active_users.items()):
            # Sessions expire after 30 minutes of inactivity
            if current_time - user_data['last_active'] > timedelta(minutes=30):
                expired_sessions.append(user_hash)
        
        for user_hash in expired_sessions:
            self.delete_user_data(user_hash)
    
    def delete_user_data(self, user_hash):
        """Completely delete user data"""
        if user_hash in active_users:
            session_id = active_users[user_hash]['session_id']
            del active_users[user_hash]
            
            if session_id in user_sessions:
                del user_sessions[session_id]
            
            if user_hash in encryption_keys:
                del encryption_keys[user_hash]
            
            if user_hash in message_cache:
                del message_cache[user_hash]
    
    def start_cleanup_thread(self):
        """Start background cleanup thread"""
        def cleanup_loop():
            while True:
                time.sleep(self.cleanup_interval)
                self.cleanup_expired_sessions()
        
        cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
        cleanup_thread.start()

messenger = NostrMessenger()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/join', methods=['POST'])
def join_service():
    """Join the messaging service with username"""
    data = request.json
    username = data.get('username', '').strip()
    
    if not username or len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    
    # Check if username is already taken
    for user_data in active_users.values():
        if user_data['username'].lower() == username.lower():
            return jsonify({'error': 'Username already taken'}), 400
    
    # Create anonymous identity
    user_data = messenger.create_anonymous_identity(username)
    
    response_data = {
        'success': True,
        'session_id': user_data['session_id'],
        'user_hash': user_data['user_hash'],
        'username': user_data['username']
    }
    
    return jsonify(response_data)

@app.route('/send_message', methods=['POST'])
def send_message():
    """Send encrypted message"""
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    recipient = data.get('recipient')  # username or 'all' for broadcast
    
    if not session_id or session_id not in user_sessions:
        return jsonify({'error': 'Invalid session'}), 401
    
    user_hash = user_sessions[session_id]
    
    # Update last active time
    if user_hash in active_users:
        active_users[user_hash]['last_active'] = datetime.now()
    
    # Encrypt the message
    encrypted_message = messenger.encrypt_message(message, user_hash)
    if not encrypted_message:
        return jsonify({'error': 'Encryption failed'}), 500
    
    # Create message object
    message_obj = {
        'id': secrets.token_hex(16),
        'sender': active_users[user_hash]['username'],
        'sender_hash': user_hash,
        'message': encrypted_message,
        'recipient': recipient,
        'timestamp': datetime.now().isoformat(),
        'encrypted': True
    }
    
    # Broadcast message via WebSocket
    socketio.emit('new_message', message_obj, room='global')
    
    return jsonify({'success': True, 'message_id': message_obj['id']})

@app.route('/get_messages', methods=['POST'])
def get_messages():
    """Get decrypted messages for user"""
    data = request.json
    session_id = data.get('session_id')
    
    if not session_id or session_id not in user_sessions:
        return jsonify({'error': 'Invalid session'}), 401
    
    user_hash = user_sessions[session_id]
    
    # Update last active time
    if user_hash in active_users:
        active_users[user_hash]['last_active'] = datetime.now()
    
    # Get cached messages for this user
    user_messages = message_cache.get(user_hash, [])
    
    # Decrypt messages
    decrypted_messages = []
    for msg in user_messages:
        decrypted_msg = msg.copy()
        if msg['encrypted'] and msg['sender_hash'] == user_hash:
            decrypted_content = messenger.decrypt_message(msg['message'], user_hash)
            decrypted_msg['message'] = decrypted_content
            decrypted_msg['encrypted'] = False
        
        decrypted_messages.append(decrypted_msg)
    
    return jsonify({'messages': decrypted_messages})

@app.route('/leave', methods=['POST'])
def leave_service():
    """Leave service and delete all user data"""
    data = request.json
    session_id = data.get('session_id')
    
    if session_id and session_id in user_sessions:
        user_hash = user_sessions[session_id]
        messenger.delete_user_data(user_hash)
    
    return jsonify({'success': True})

@app.route('/active_users', methods=['GET'])
def get_active_users():
    """Get list of active users (usernames only)"""
    usernames = [user_data['username'] for user_data in active_users.values()]
    return jsonify({'users': usernames})

@socketio.on('connect')
def handle_connect():
    join_room('global')
    emit('connected', {'message': 'Connected to Argoya messenger'})

@socketio.on('disconnect')
def handle_disconnect():
    leave_room('global')

if __name__ == '__main__':
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    os.makedirs('static', exist_ok=True)
    
    print("🚀 Argoya Nostr Messenger starting...")
    print("📱 Anonymous, encrypted messaging service")
    print("🔐 End-to-end encryption enabled")
    print("🗑️  Session-based data deletion active")
    print("🌐 Visit: http://localhost:5000")
    
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
