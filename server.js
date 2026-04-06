const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.RENDER_EXTERNAL_URL || '*',
        methods: ['GET', 'POST']
    }
});

app.use(express.static('public'));

// Store current video state
let currentVideoState = {
    videoId: null,
    currentTime: 0,
    isPlaying: false
};

// Store connected users
const users = new Map(); // socket.id -> username

// Get user count
function getUserCount() {
    return users.size;
}

// Sanitize input to prevent XSS
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .slice(0, 500); // Limit length
}

// Validate YouTube video ID
function isValidVideoId(videoId) {
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'];
    const systemInfo = extractSystemInfo(userAgent);

    console.log(`\n✓ User connected:`);
    console.log(`  - IP: ${clientIp}`);
    console.log(`  - System: ${systemInfo.os}`);
    console.log(`  - Browser: ${systemInfo.browser}`);
    console.log(`  - Socket ID: ${socket.id}`);
    console.log(`  - Total users: ${getUserCount() + 1}`);

    // Send current state to newly connected user
    if (currentVideoState.videoId) {
        socket.emit('syncResponse', currentVideoState);
        console.log(`  - Synced with current video: ${currentVideoState.videoId}`);
    }

    // Check if username is taken
    function isUsernameTaken(username, excludeSocketId = null) {
        for (const [socketId, existingUsername] of users.entries()) {
            if (socketId !== excludeSocketId && existingUsername.toLowerCase() === username.toLowerCase()) {
                return true;
            }
        }
        return false;
    }

    // Handle username registration and changes
    socket.on('setUsername', (username) => {
        const sanitizedUsername = sanitizeInput(username);

        if (!sanitizedUsername || sanitizedUsername.length < 3) {
            return;
        }

        const oldUsername = users.get(socket.id);

        if (!oldUsername) {
            // New user connecting - check for duplicates
            if (isUsernameTaken(sanitizedUsername)) {
                // Add a number to make it unique
                let uniqueUsername = sanitizedUsername;
                let counter = 1;
                while (isUsernameTaken(uniqueUsername)) {
                    uniqueUsername = `${sanitizedUsername}${counter}`;
                    counter++;
                }
                users.set(socket.id, uniqueUsername);
                socket.emit('usernameAccepted', uniqueUsername);
                console.log(`  - Username set (modified for uniqueness): ${uniqueUsername}`);
            } else {
                users.set(socket.id, sanitizedUsername);
                console.log(`  - Username set: ${sanitizedUsername}`);
            }

            // Notify all OTHER users about new connection
            socket.broadcast.emit('userConnected', {
                username: users.get(socket.id),
                userCount: getUserCount()
            });

            // Send current user count to everyone
            io.emit('userCount', getUserCount());
        }
    });

    // Handle username change requests
    socket.on('requestUsernameChange', (newUsername) => {
        const sanitizedUsername = sanitizeInput(newUsername);

        if (!sanitizedUsername || sanitizedUsername.length < 3) {
            socket.emit('usernameRejected', 'Username must be at least 3 characters long');
            return;
        }

        const oldUsername = users.get(socket.id);

        if (!oldUsername) {
            socket.emit('usernameRejected', 'You must be connected first');
            return;
        }

        if (oldUsername.toLowerCase() === sanitizedUsername.toLowerCase()) {
            socket.emit('usernameRejected', 'This is already your username');
            return;
        }

        // Check if username is taken by someone else
        if (isUsernameTaken(sanitizedUsername, socket.id)) {
            socket.emit('usernameRejected', 'This username is already taken');
            return;
        }

        // Username is valid and available
        users.set(socket.id, sanitizedUsername);
        console.log(`  - Username changed: ${oldUsername} -> ${sanitizedUsername}`);

        // Notify the user
        socket.emit('usernameAccepted', sanitizedUsername);

        // Notify all OTHER users about the username change
        socket.broadcast.emit('usernameChanged', {
            oldUsername: oldUsername,
            newUsername: sanitizedUsername
        });
    });

    socket.on('play', (data) => {
        if (!data || !isValidVideoId(data.videoId)) {
            return;
        }

        console.log(`▶️  Play event from ${socket.id} at ${data.currentTime}s`);
        currentVideoState = {
            videoId: data.videoId,
            currentTime: data.currentTime || 0,
            isPlaying: true
        };
        socket.broadcast.emit('play', data);
    });

    socket.on('pause', () => {
        console.log(`⏸️  Pause event from ${socket.id}`);
        currentVideoState.isPlaying = false;
        socket.broadcast.emit('pause');
    });

    socket.on('loadVideo', (data) => {
        if (!data || !isValidVideoId(data.videoId)) {
            return;
        }

        console.log(`📺 Load video event: ${data.videoId}`);
        currentVideoState = {
            videoId: data.videoId,
            currentTime: data.currentTime || 0,
            isPlaying: false
        };
        socket.broadcast.emit('loadVideo', data);
    });

    socket.on('loadPlaylist', (data) => {
        if (!data || !data.playlistId) {
            return;
        }

        const sanitizedPlaylistId = sanitizeInput(data.playlistId);
        console.log(`📺 Load playlist event: ${sanitizedPlaylistId}`);

        currentVideoState = {
            videoId: `playlist_${sanitizedPlaylistId}`,
            currentTime: 0,
            isPlaying: false
        };

        socket.broadcast.emit('loadPlaylist', {
            playlistId: sanitizedPlaylistId,
            index: data.index || 0
        });
    });

    socket.on('loadMedia', (data) => {
        if (!data || !data.url || !data.mediaId) {
            return;
        }

        const sanitizedUrl = sanitizeInput(data.url);
        const sanitizedMediaId = sanitizeInput(data.mediaId);
        const sanitizedMediaType = sanitizeInput(data.mediaType || 'generic');

        console.log(`🎵 Load media event: ${sanitizedMediaType} - ${sanitizedUrl}`);

        currentVideoState = {
            videoId: sanitizedMediaId,
            currentTime: 0,
            isPlaying: false,
            mediaType: sanitizedMediaType,
            mediaSource: data.mediaSource || 'iframe',
            url: sanitizedUrl
        };

        socket.broadcast.emit('loadMedia', {
            url: sanitizedUrl,
            mediaId: sanitizedMediaId,
            mediaType: sanitizedMediaType,
            mediaSource: data.mediaSource || 'iframe'
        });
    });

    socket.on('seek', (time) => {
        if (typeof time !== 'number' || time < 0) {
            return;
        }

        console.log(`⏩ Seek event to ${time}s`);
        currentVideoState.currentTime = time;
        socket.broadcast.emit('seek', time);
    });

    socket.on('requestSync', () => {
        console.log(`🔄 Sync requested by ${socket.id}`);
        socket.broadcast.emit('syncRequest');
    });

    socket.on('syncResponse', (data) => {
        if (!data || !isValidVideoId(data.videoId)) {
            return;
        }

        console.log(`✅ Sync response received: ${data.videoId} at ${data.currentTime}s`);
        currentVideoState = data;
    });

    socket.on('syncCheck', (data) => {
        if (data && typeof data.currentTime === 'number') {
            // Update current time periodically
            if (currentVideoState.isPlaying) {
                currentVideoState.currentTime = data.currentTime;
            }
        }
    });

    socket.on('chatMessage', (data) => {
        if (!data || !data.username || !data.message) {
            return;
        }

        const sanitizedMessage = sanitizeInput(data.message);
        const sanitizedUsername = sanitizeInput(data.username);

        if (!sanitizedMessage || !sanitizedUsername) {
            return;
        }

        console.log(`💬 Chat from ${sanitizedUsername}: ${sanitizedMessage}`);

        // Broadcast message to all clients including sender
        io.emit('chatMessage', {
            username: sanitizedUsername,
            message: sanitizedMessage
        });
    });

    socket.on('disconnect', () => {
        const username = users.get(socket.id);

        console.log(`\n✗ User disconnected:`);
        console.log(`  - IP: ${clientIp}`);
        console.log(`  - System: ${systemInfo.os}`);
        console.log(`  - Socket ID: ${socket.id}`);
        if (username) {
            console.log(`  - Username: ${username}`);
        }

        // Remove user and notify others
        if (username) {
            users.delete(socket.id);
            io.emit('userDisconnected', {
                username: username,
                userCount: getUserCount()
            });
            console.log(`  - Remaining users: ${getUserCount()}`);
        }
    });
});

function extractSystemInfo(userAgent) {
    let os = 'Unknown OS';
    let browser = 'Unknown Browser';

    if (!userAgent) {
        return { os, browser };
    }

    // Detect OS
    if (userAgent.includes('Windows NT 10.0')) os = 'Windows 10/11';
    else if (userAgent.includes('Windows NT 6.3')) os = 'Windows 8.1';
    else if (userAgent.includes('Windows NT 6.2')) os = 'Windows 8';
    else if (userAgent.includes('Windows NT 6.1')) os = 'Windows 7';
    else if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac OS X')) {
        const match = userAgent.match(/Mac OS X ([\d_]+)/);
        os = match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS';
    }
    else if (userAgent.includes('Android')) {
        const match = userAgent.match(/Android ([\d.]+)/);
        os = match ? `Android ${match[1]}` : 'Android';
    }
    else if (userAgent.includes('iPhone')) os = 'iOS (iPhone)';
    else if (userAgent.includes('iPad')) os = 'iOS (iPad)';
    else if (userAgent.includes('Linux')) os = 'Linux';

    // Detect Browser
    if (userAgent.includes('Edg/')) browser = 'Edge';
    else if (userAgent.includes('Chrome/')) browser = 'Chrome';
    else if (userAgent.includes('Firefox/')) browser = 'Firefox';
    else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) browser = 'Safari';
    else if (userAgent.includes('Opera') || userAgent.includes('OPR/')) browser = 'Opera';

    return { os, browser };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on:`);
    console.log(`  - Local:   http://localhost:${PORT}`);
    console.log(`  - Network: http://10.49.192.69:${PORT}`);

    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`  - Render:  ${process.env.RENDER_EXTERNAL_URL}`);
    }
});
