// Global variables
let player;
let currentMediaType = null; // Track current media type
let currentMediaSource = null; // Track current source (youtube, spotify, etc.)
const socket = io();
let wakeLock = null;
let isLocalAction = false;
let userLanguage = localStorage.getItem('userLanguage') || 'en';

// Get or generate username from localStorage
let username = localStorage.getItem('username') || generateUsername();

// Generate random username
function generateUsername() {
    const adjectives = ['Happy', 'Cool', 'Swift', 'Bright', 'Smart', 'Epic', 'Super', 'Mega'];
    const nouns = ['Panda', 'Tiger', 'Eagle', 'Dolphin', 'Lion', 'Wolf', 'Fox', 'Bear'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj}${noun}${num}`;
}

// Save username to localStorage
function saveUsername(name) {
    username = name;
    localStorage.setItem('username', name);
}

// Video state management with localStorage
function saveVideoState(videoId, currentTime, isPlaying) {
    const videoState = {
        videoId,
        currentTime,
        isPlaying,
        timestamp: Date.now()
    };
    localStorage.setItem('videoState', JSON.stringify(videoState));
}

function getVideoState() {
    try {
        const state = localStorage.getItem('videoState');
        if (!state) return null;

        const parsed = JSON.parse(state);
        // Only use cached state if less than 1 hour old
        if (Date.now() - parsed.timestamp < 3600000) {
            return parsed;
        }
        return null;
    } catch (err) {
        console.log('Error reading video state:', err);
        return null;
    }
}

// Status update function
function updateStatus(message, emoji = '🔄') {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.innerHTML = `${emoji} ${escapeHtml(message)}`;
    }
}

// Update user count
function updateUserCount(count) {
    const userCountEl = document.getElementById('userCount');
    if (userCountEl) {
        userCountEl.textContent = `${count} user${count !== 1 ? 's' : ''} online`;
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Translate text using MyMemory Translation API (free, no CORS issues)
async function translateText(text, targetLang, sourceLang = 'auto') {
    if (!text) return text;

    try {
        // Encode text for URL
        const encodedText = encodeURIComponent(text);
        // Use auto-detect for source language
        const langPair = sourceLang === 'auto' ? `autodetect|${targetLang}` : `${sourceLang}|${targetLang}`;
        const response = await fetch(
            `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${langPair}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        const data = await response.json();
        if (data.responseStatus === 200 && data.responseData) {
            return data.responseData.translatedText || text;
        }
        return text;
    } catch (err) {
        console.log('Translation failed:', err);
        return text;
    }
}

// Add chat message to UI
async function addChatMessage(message, type = 'user', sender = null, originalMessage = null) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');

    // Check if this is the current user's message
    const isOwnMessage = (sender === username && type === 'user');
    messageDiv.className = `chat-message ${type} ${isOwnMessage ? 'own-message' : ''}`;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (type === 'system') {
        messageDiv.textContent = message;
    } else {
        // Translate message if it's from another user (auto-detects source language)
        let displayMessage = message;
        if (!isOwnMessage) {
            displayMessage = await translateText(message, userLanguage);
        }

        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'username';
        usernameSpan.textContent = `${sender || 'Anonymous'}${isOwnMessage ? ' (You)' : ''}:`;

        const messageSpan = document.createElement('span');
        messageSpan.textContent = ` ${displayMessage}`;

        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = timestamp;

        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(messageSpan);
        messageDiv.appendChild(timestampSpan);

        // Show original if message was translated
        if (displayMessage !== message) {
            const originalSpan = document.createElement('div');
            originalSpan.style.fontSize = '0.75rem';
            originalSpan.style.color = '#9ca3af';
            originalSpan.style.fontStyle = 'italic';
            originalSpan.style.marginTop = '4px';
            originalSpan.textContent = `Original: ${message}`;
            messageDiv.appendChild(originalSpan);
        }
    }

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send chat message
function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();

    if (message && message.length <= 500) {
        socket.emit('chatMessage', {
            username: username,
            message: message
        });
        chatInput.value = '';
    }
}

// Wake Lock API to keep screen on during playback (mobile)
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock activated');

            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released');
            });
        }
    } catch (err) {
        console.log('Wake Lock not supported or failed:', err);
    }
}

async function releaseWakeLock() {
    if (wakeLock !== null) {
        try {
            await wakeLock.release();
            wakeLock = null;
            console.log('Wake Lock released manually');
        } catch (err) {
            console.log('Error releasing wake lock:', err);
        }
    }
}

// Request wake lock again when page becomes visible (for mobile)
document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
        await requestWakeLock();
    }
});

// YouTube player initialization
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
            'playsinline': 1,
            'rel': 0,
            'modestbranding': 1,
            'controls': 1,
            'enablejsapi': 1,
            'origin': window.location.origin,
            'fs': 1 // Enable fullscreen
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });

    // Set isLocalAction to true when user interacts with player
    document.addEventListener('click', (e) => {
        if (e.target.closest('#player') || e.target.closest('.player-wrapper')) {
            isLocalAction = true;
        }
    });
}

// Media Session API for background audio control
function updateMediaSession(videoData) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: videoData.title || 'YouTube Sync Video',
            artist: videoData.author || 'YouTube',
            album: 'YouTube Sync',
            artwork: [
                { src: `https://i.ytimg.com/vi/${videoData.video_id}/default.jpg`, sizes: '120x90', type: 'image/jpeg' },
                { src: `https://i.ytimg.com/vi/${videoData.video_id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
                { src: `https://i.ytimg.com/vi/${videoData.video_id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
                { src: `https://i.ytimg.com/vi/${videoData.video_id}/sddefault.jpg`, sizes: '640x480', type: 'image/jpeg' }
            ]
        });

        navigator.mediaSession.setActionHandler('play', () => {
            isLocalAction = true;
            player.playVideo();
            const currentTime = player.getCurrentTime();
            socket.emit('play', {
                videoId: player.getVideoData().video_id,
                currentTime: currentTime
            });
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            isLocalAction = true;
            player.pauseVideo();
            socket.emit('pause');
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            const newTime = Math.max(player.getCurrentTime() - skipTime, 0);
            player.seekTo(newTime, true);
            socket.emit('seek', newTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            const newTime = Math.min(player.getCurrentTime() + skipTime, player.getDuration());
            player.seekTo(newTime, true);
            socket.emit('seek', newTime);
        });

        // Update position state for lock screen
        navigator.mediaSession.setPositionState({
            duration: player.getDuration(),
            playbackRate: player.getPlaybackRate(),
            position: player.getCurrentTime()
        });

        console.log('Media Session API configured');
    }
}

// Update Media Session position periodically
function updateMediaSessionPosition() {
    if ('mediaSession' in navigator && player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
        try {
            navigator.mediaSession.setPositionState({
                duration: player.getDuration(),
                playbackRate: player.getPlaybackRate(),
                position: player.getCurrentTime()
            });
        } catch (err) {
            // Ignore errors
        }
    }
}

function onPlayerReady(event) {
    updateStatus('Connected and ready!', '✅');

    // Try to restore video state from localStorage if no server state
    const savedState = getVideoState();
    if (savedState && savedState.videoId) {
        // Wait a bit to see if server sends state
        setTimeout(() => {
            // Only use cached state if player is still empty
            if (!player.getVideoData || !player.getVideoData().video_id) {
                console.log('Restoring video from localStorage:', savedState);
                player.loadVideoById({
                    videoId: savedState.videoId,
                    startSeconds: savedState.currentTime || 0
                });

                if (savedState.isPlaying) {
                    setTimeout(() => player.playVideo(), 500);
                }

                updateStatus('Restored from cache', '💾');
            }
        }, 2000); // Wait 2 seconds for server sync
    }

    // Track last known time for seek detection
    let lastKnownTime = 0;
    let isCheckingSeek = false;

    // Monitor for seek events (when user drags progress bar)
    setInterval(() => {
        if (!player || !player.getCurrentTime || isCheckingSeek) return;

        const currentTime = player.getCurrentTime();
        const timeDiff = Math.abs(currentTime - lastKnownTime);

        // If time jumped more than 2 seconds (not normal playback), it's a seek
        if (timeDiff > 2 && player.getPlayerState() !== YT.PlayerState.BUFFERING) {
            isCheckingSeek = true;
            console.log(`Seek detected: ${lastKnownTime}s -> ${currentTime}s`);
            socket.emit('seek', currentTime);
            updateStatus(`Jumped to ${Math.floor(currentTime)}s`, '⏩');
            setTimeout(() => { isCheckingSeek = false; }, 1000);
        }

        lastKnownTime = currentTime;
    }, 1000);

    document.getElementById('play').addEventListener('click', () => {
        isLocalAction = true;
        player.playVideo();
    });

    document.getElementById('pause').addEventListener('click', () => {
        isLocalAction = true;
        player.pauseVideo();
    });

    document.getElementById('loadVideo').addEventListener('click', () => {
        const videoUrl = document.getElementById('videoUrl').value.trim();

        if (!videoUrl) {
            alert('Please enter a valid URL');
            return;
        }

        // Try YouTube video first
        const videoId = extractVideoId(videoUrl);
        if (videoId) {
            isLocalAction = true;
            player.loadVideoById(videoId);
            socket.emit('loadVideo', { videoId: videoId });
            updateStatus('YouTube video loaded!', '📺');
            document.getElementById('videoUrl').value = '';
            return;
        }

        // Try YouTube playlist
        if (isYouTubePlaylist(videoUrl)) {
            const playlistId = extractPlaylistId(videoUrl);
            if (playlistId) {
                isLocalAction = true;
                player.loadPlaylist({
                    list: playlistId,
                    listType: 'playlist'
                });
                socket.emit('loadPlaylist', { playlistId: playlistId });
                updateStatus('YouTube playlist loaded!', '📺');
                document.getElementById('videoUrl').value = '';
                return;
            }
        }

        // For other media sources, load in iframe
        const mediaId = loadGenericIframe(videoUrl);
        if (mediaId) {
            socket.emit('loadMedia', {
                url: videoUrl,
                mediaId: mediaId,
                mediaType: currentMediaType,
                mediaSource: currentMediaSource
            });
            document.getElementById('videoUrl').value = '';
        } else {
            alert('Unable to load this media. Please check the URL and try again.');
        }
    });

    // Username and language settings
    const settingsBar = document.createElement('div');
    settingsBar.style.cssText = 'padding: 10px; background: #f3f4f6; border-radius: 8px; margin-bottom: 15px;';
    settingsBar.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div style="cursor: pointer;" id="usernameDisplay">
                <span style="color: #6b7280;">Your name: </span>
                <span style="color: #667eea; font-weight: 600;" id="usernameText">${username}</span>
                <span style="color: #9ca3af; margin-left: 8px; font-size: 0.8rem;">(click to change)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #6b7280; font-size: 0.85rem;">Language:</span>
                <select id="languageSelect" style="padding: 5px 10px; border-radius: 6px; border: 2px solid #e5e7eb; background: white; cursor: pointer;">
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="it">Italiano</option>
                    <option value="pt">Português</option>
                    <option value="ru">Русский</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="zh">中文</option>
                    <option value="ar">العربية</option>
                    <option value="hi">हिन्दी</option>
                </select>
            </div>
        </div>
    `;

    const chatContainer = document.querySelector('.chat-container');
    chatContainer.insertBefore(settingsBar, chatContainer.firstChild.nextSibling);

    // Set saved language
    document.getElementById('languageSelect').value = userLanguage;

    // Language change handler
    document.getElementById('languageSelect').addEventListener('change', (e) => {
        userLanguage = e.target.value;
        localStorage.setItem('userLanguage', userLanguage);
        addChatMessage(`Language changed to ${e.target.options[e.target.selectedIndex].text}`, 'system');
    });

    usernameDisplay.addEventListener('click', () => {
        const newUsername = prompt('Enter your new username:', username);
        if (newUsername && newUsername.trim() && newUsername.trim().length >= 3) {
            const trimmedUsername = newUsername.trim();
            // Request username change from server
            socket.emit('requestUsernameChange', trimmedUsername);
        }
    });

    // Chat functionality
    document.getElementById('sendChat').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

    // Request sync on connect
    socket.emit('requestSync');

    // Send username to server
    socket.emit('setUsername', username);
}

function onPlayerStateChange(event) {
    // Update Media Session playback state
    if ('mediaSession' in navigator) {
        if (event.data == YT.PlayerState.PLAYING) {
            navigator.mediaSession.playbackState = 'playing';
            const videoData = player.getVideoData();
            if (videoData.video_id) {
                updateMediaSession(videoData);
            }
        } else if (event.data == YT.PlayerState.PAUSED) {
            navigator.mediaSession.playbackState = 'paused';
        }
    }

    // Always sync player controls (including YouTube's built-in controls)
    if (event.data == YT.PlayerState.PLAYING) {
        const currentTime = player.getCurrentTime();
        if (isLocalAction) {
            socket.emit('play', {
                videoId: player.getVideoData().video_id,
                currentTime: currentTime
            });
            updateStatus('Playing - synced with others', '▶️');
        }
        requestWakeLock();
    } else if (event.data == YT.PlayerState.PAUSED) {
        if (isLocalAction) {
            socket.emit('pause');
            updateStatus('Paused', '⏸️');
        }
        releaseWakeLock();
    }

    isLocalAction = false;
}

function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// Detect if URL is YouTube playlist
function isYouTubePlaylist(url) {
    return url.includes('list=') || url.includes('youtube.com/playlist');
}

// Extract YouTube playlist ID
function extractPlaylistId(url) {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

// Load generic iframe (for non-YouTube content)
function loadGenericIframe(url) {
    const playerWrapper = document.querySelector('.player-wrapper');
    const playerDiv = document.getElementById('player');

    // Detect media type
    let embedUrl = url;
    let mediaType = 'generic';

    // Spotify
    if (url.includes('spotify.com/')) {
        const spotifyMatch = url.match(/spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/);
        if (spotifyMatch) {
            embedUrl = `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}`;
            mediaType = 'spotify';
        }
    }
    // Vimeo
    else if (url.includes('vimeo.com/')) {
        const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
        if (vimeoMatch) {
            embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
            mediaType = 'vimeo';
        }
    }
    // SoundCloud
    else if (url.includes('soundcloud.com/')) {
        embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&show_artwork=true`;
        mediaType = 'soundcloud';
    }
    // Dailymotion
    else if (url.includes('dailymotion.com/')) {
        const dmMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
        if (dmMatch) {
            embedUrl = `https://www.dailymotion.com/embed/video/${dmMatch[1]}`;
            mediaType = 'dailymotion';
        }
    }
    // Twitch
    else if (url.includes('twitch.tv/')) {
        const twitchMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
        if (twitchMatch) {
            embedUrl = `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${window.location.hostname}`;
            mediaType = 'twitch';
        }
    }

    // Create iframe
    playerDiv.innerHTML = `
        <iframe
            src="${embedUrl}"
            width="100%"
            height="100%"
            frameborder="0"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowfullscreen
            style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
        </iframe>
    `;

    currentMediaType = mediaType;
    currentMediaSource = 'iframe';

    // Show info about media type
    const sourceNames = {
        'spotify': 'Spotify',
        'vimeo': 'Vimeo',
        'soundcloud': 'SoundCloud',
        'dailymotion': 'Dailymotion',
        'twitch': 'Twitch',
        'generic': 'External Media'
    };

    updateStatus(`Loaded ${sourceNames[mediaType] || 'media'}`, '🎵');

    return btoa(embedUrl).substring(0, 20); // Return unique ID
}

// Socket event handlers with timestamp sync
socket.on('play', (data) => {
    isLocalAction = false;

    if (player && player.getVideoData) {
        const currentVideoId = player.getVideoData().video_id;

        if (currentVideoId !== data.videoId) {
            player.loadVideoById({
                videoId: data.videoId,
                startSeconds: data.currentTime || 0
            });
        } else if (data.currentTime !== undefined) {
            const playerTime = player.getCurrentTime();
            const timeDiff = Math.abs(playerTime - data.currentTime);

            // Sync if difference is more than 2 seconds
            if (timeDiff > 2) {
                player.seekTo(data.currentTime, true);
                updateStatus(`Synced to ${Math.floor(data.currentTime)}s`, '🔄');
            }
        }

        player.playVideo();
        updateStatus('Playing - synced', '▶️');
        requestWakeLock();

        // Save state to localStorage
        saveVideoState(data.videoId, data.currentTime || 0, true);
    }
});

socket.on('pause', () => {
    isLocalAction = false;
    if (player && player.pauseVideo) {
        player.pauseVideo();
        updateStatus('Paused', '⏸️');
        releaseWakeLock();

        // Save paused state
        if (player.getVideoData && player.getVideoData().video_id) {
            saveVideoState(player.getVideoData().video_id, player.getCurrentTime(), false);
        }
    }
});

socket.on('loadVideo', (data) => {
    isLocalAction = false;
    if (player && player.loadVideoById) {
        player.loadVideoById({
            videoId: data.videoId,
            startSeconds: data.currentTime || 0
        });
        updateStatus('New video loaded', '📺');

        // Save loaded video state
        saveVideoState(data.videoId, data.currentTime || 0, false);
    }
});

socket.on('loadPlaylist', (data) => {
    isLocalAction = false;
    if (player && player.loadPlaylist) {
        player.loadPlaylist({
            list: data.playlistId,
            listType: 'playlist',
            index: data.index || 0
        });
        updateStatus('New playlist loaded', '📺');
    }
});

socket.on('loadMedia', (data) => {
    isLocalAction = false;
    loadGenericIframe(data.url);
    updateStatus(`${data.mediaType || 'Media'} loaded`, '🎵');
});

socket.on('seek', (time) => {
    isLocalAction = false;
    if (player && player.seekTo) {
        player.seekTo(time, true);
        updateStatus(`Jumped to ${Math.floor(time)}s`, '⏩');
    }
});

// Request current state from other clients
socket.on('syncRequest', () => {
    if (player && player.getVideoData && player.getVideoData().video_id) {
        const currentTime = player.getCurrentTime();
        const videoId = player.getVideoData().video_id;
        const playerState = player.getPlayerState();

        socket.emit('syncResponse', {
            videoId: videoId,
            currentTime: currentTime,
            isPlaying: playerState === YT.PlayerState.PLAYING
        });
    }
});

socket.on('syncResponse', (data) => {
    if (player && data.videoId) {
        player.loadVideoById({
            videoId: data.videoId,
            startSeconds: data.currentTime || 0
        });

        if (data.isPlaying) {
            setTimeout(() => {
                player.playVideo();
                requestWakeLock();
            }, 500);
        }

        updateStatus('Synced with existing session', '✅');

        // Save synced state to localStorage
        saveVideoState(data.videoId, data.currentTime || 0, data.isPlaying || false);
    }
});

// Chat event handlers
socket.on('chatMessage', (data) => {
    addChatMessage(data.message, 'user', data.username);
});

socket.on('userConnected', (data) => {
    addChatMessage(`${data.username} joined the room`, 'system');
    updateUserCount(data.userCount);
});

socket.on('userDisconnected', (data) => {
    addChatMessage(`${data.username} left the room`, 'system');
    updateUserCount(data.userCount);
});

socket.on('userCount', (count) => {
    updateUserCount(count);
});

socket.on('usernameChanged', (data) => {
    addChatMessage(`${data.oldUsername} changed their name to ${data.newUsername}`, 'system');
});

socket.on('usernameAccepted', (newUsername) => {
    saveUsername(newUsername);
    document.getElementById('usernameText').textContent = newUsername;
    addChatMessage(`You changed your name to ${newUsername}`, 'system');
});

socket.on('usernameRejected', (reason) => {
    alert(`Username change failed: ${reason}`);
});

// Connection status
socket.on('connect', () => {
    updateStatus('Connected', '✅');
    socket.emit('setUsername', username);
});

socket.on('disconnect', () => {
    updateStatus('Disconnected - reconnecting...', '⚠️');
    releaseWakeLock();
});

// Periodic sync check (every 10 seconds)
setInterval(() => {
    if (player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
        const currentTime = player.getCurrentTime();
        socket.emit('syncCheck', { currentTime: currentTime });

        // Update Media Session position
        updateMediaSessionPosition();
    }
}, 10000);

// Update Media Session position more frequently (every 5 seconds)
setInterval(() => {
    updateMediaSessionPosition();
}, 5000);
