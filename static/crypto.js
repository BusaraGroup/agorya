// Argoya Crypto Module - Client-side encryption utilities

class ArgoyaCrypto {
    constructor() {
        this.keyPair = null;
        this.sessionKey = null;
    }

    // Generate a new keypair for this session
    async generateKeyPair() {
        try {
            this.keyPair = await window.crypto.subtle.generateKey(
                {
                    name: "RSA-OAEP",
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: "SHA-256"
                },
                true,
                ["encrypt", "decrypt"]
            );
            
            // Generate session key for symmetric encryption
            this.sessionKey = await window.crypto.subtle.generateKey(
                {
                    name: "AES-GCM",
                    length: 256
                },
                true,
                ["encrypt", "decrypt"]
            );
            
            return true;
        } catch (error) {
            console.error('Key generation failed:', error);
            return false;
        }
    }

    // Generate anonymous identity hash
    async generateAnonymousHash(username) {
        const timestamp = Date.now();
        const randomBytes = window.crypto.getRandomValues(new Uint8Array(16));
        const data = new TextEncoder().encode(`${username}:${timestamp}:${Array.from(randomBytes).join('')}`);
        
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    }

    // Encrypt message using session key
    async encryptMessage(message) {
        if (!this.sessionKey) {
            throw new Error('Session key not initialized');
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        
        const encrypted = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            this.sessionKey,
            data
        );

        // Combine IV and encrypted data
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        
        return btoa(String.fromCharCode.apply(null, combined));
    }

    // Decrypt message using session key
    async decryptMessage(encryptedData) {
        if (!this.sessionKey) {
            throw new Error('Session key not initialized');
        }

        try {
            const combined = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));
            
            const iv = combined.slice(0, 12);
            const encrypted = combined.slice(12);
            
            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                this.sessionKey,
                encrypted
            );

            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Decryption failed:', error);
            return null;
        }
    }

    // Generate secure random username suffix
    generateSecureId() {
        const randomBytes = window.crypto.getRandomValues(new Uint8Array(8));
        return Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Hash function for data integrity
    async hashData(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Derive key from password (for additional security)
    async deriveKeyFromPassword(password, salt) {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        const saltBuffer = encoder.encode(salt);

        const importedKey = await window.crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits']
        );

        const derivedBits = await window.crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: 100000,
                hash: 'SHA-256'
            },
            importedKey,
            256
        );

        return await window.crypto.subtle.importKey(
            'raw',
            derivedBits,
            'AES-GCM',
            false,
            ['encrypt', 'decrypt']
        );
    }

    // Secure memory cleanup
    cleanup() {
        this.keyPair = null;
        this.sessionKey = null;
        
        // Clear any sensitive data from memory
        if (window.gc) {
            window.gc();
        }
    }
}

// Export for use in main app
window.ArgoyaCrypto = ArgoyaCrypto;
