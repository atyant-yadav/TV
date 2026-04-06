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
async function addChatMessage(message, type = 'user', sender = null) {
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

// Media Session API for background audio control (iOS Safari compatible)
function updateMediaSession(videoData) {
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: videoData.title || 'YouTube Sync Video',
                artist: videoData.author || 'YouTube',
                album: 'YouTube Sync - Watch Together',
                artwork: [
                    { src: `https://i.ytimg.com/vi/${videoData.video_id}/default.jpg`, sizes: '120x90', type: 'image/jpeg' },
                    { src: `https://i.ytimg.com/vi/${videoData.video_id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
                    { src: `https://i.ytimg.com/vi/${videoData.video_id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
                    { src: `https://i.ytimg.com/vi/${videoData.video_id}/sddefault.jpg`, sizes: '640x480', type: 'image/jpeg' },
                    { src: `https://i.ytimg.com/vi/${videoData.video_id}/maxresdefault.jpg`, sizes: '1280x720', type: 'image/jpeg' }
                ]
            });

            // iOS Safari requires all action handlers to be set
            navigator.mediaSession.setActionHandler('play', () => {
                console.log('Media Session: Play action');
                isLocalAction = true;
                if (player && player.playVideo) {
                    player.playVideo();
                    const currentTime = player.getCurrentTime();
                    socket.emit('play', {
                        videoId: player.getVideoData().video_id,
                        currentTime: currentTime
                    });
                }
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                console.log('Media Session: Pause action');
                isLocalAction = true;
                if (player && player.pauseVideo) {
                    player.pauseVideo();
                    socket.emit('pause');
                }
            });

            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                console.log('Media Session: Seek backward');
                if (player && player.getCurrentTime) {
                    const skipTime = details.seekOffset || 10;
                    const newTime = Math.max(player.getCurrentTime() - skipTime, 0);
                    player.seekTo(newTime, true);
                    socket.emit('seek', newTime);
                }
            });

            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                console.log('Media Session: Seek forward');
                if (player && player.getCurrentTime) {
                    const skipTime = details.seekOffset || 10;
                    const newTime = Math.min(player.getCurrentTime() + skipTime, player.getDuration());
                    player.seekTo(newTime, true);
                    socket.emit('seek', newTime);
                }
            });

            // Try to set position state (iOS Safari support varies)
            try {
                if (player && player.getDuration && player.getCurrentTime) {
                    const duration = player.getDuration();
                    const position = player.getCurrentTime();
                    if (duration > 0 && position >= 0) {
                        navigator.mediaSession.setPositionState({
                            duration: duration,
                            playbackRate: player.getPlaybackRate ? player.getPlaybackRate() : 1,
                            position: position
                        });
                    }
                }
            } catch (err) {
                console.log('Media Session position state not supported:', err);
            }

            console.log('Media Session API configured for iOS Safari');
        } catch (err) {
            console.error('Media Session API error:', err);
        }
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

function onPlayerReady() {
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

            // Re-enable play/pause buttons for YouTube
            enableYouTubeControls();
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

                // Re-enable play/pause buttons for YouTube
                enableYouTubeControls();
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

// Enable YouTube controls (play/pause buttons)
function enableYouTubeControls() {
    const playBtn = document.getElementById('play');
    const pauseBtn = document.getElementById('pause');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.style.opacity = '1';
        playBtn.title = '';
    }
    if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.style.opacity = '1';
        pauseBtn.title = '';
    }
}

// Show error when iframe fails to load
function showIframeError(mediaType, url) {
    const playerDiv = document.getElementById('player');

    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(220, 38, 38, 0.95);
        color: white;
        padding: 25px;
        border-radius: 12px;
        text-align: center;
        max-width: 80%;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;

    const sourceNames = {
        'spotify': 'Spotify',
        'vimeo': 'Vimeo',
        'soundcloud': 'SoundCloud',
        'dailymotion': 'Dailymotion',
        'twitch': 'Twitch',
        'generic': 'Media'
    };

    errorDiv.innerHTML = `
        <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
        <div style="font-size: 1.2rem; font-weight: 600; margin-bottom: 10px;">
            Failed to Load ${sourceNames[mediaType] || 'Media'}
        </div>
        <div style="font-size: 0.9rem; line-height: 1.5; margin-bottom: 15px;">
            ${mediaType === 'spotify' ?
                'This may be due to browser privacy settings blocking third-party cookies.<br>Try enabling cookies for Spotify or use a different browser.' :
                'This content may be restricted or unavailable.'
            }
        </div>
        <button onclick="this.parentElement.remove()" style="
            background: rgba(255,255,255,0.2);
            border: 1px solid white;
            color: white;
            padding: 8px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
        ">Dismiss</button>
        <div style="margin-top: 15px; font-size: 0.75rem; opacity: 0.8;">
            Firefox users: Storage Access API warnings are normal
        </div>
    `;

    playerDiv.appendChild(errorDiv);

    console.error(`Failed to load ${mediaType} from: ${url}`);
}

// Load generic iframe (for non-YouTube content)
function loadGenericIframe(url) {
    const playerDiv = document.getElementById('player');

    // Stop YouTube player if it's active
    if (player && player.stopVideo) {
        try {
            player.stopVideo();
        } catch (e) {
            console.log('Could not stop YouTube player:', e);
        }
    }

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

    // Destroy existing YouTube player and create iframe
    playerDiv.innerHTML = '';

    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
    iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';

    // Handle iframe load errors
    iframe.addEventListener('error', () => {
        console.error('Failed to load media iframe');
        showIframeError(mediaType, url);
    });

    // Log successful load
    iframe.addEventListener('load', () => {
        console.log(`${mediaType} iframe loaded successfully`);
    });

    playerDiv.appendChild(iframe);

    currentMediaType = mediaType;
    currentMediaSource = 'iframe';

    // Disable play/pause buttons for iframe content (they won't work)
    const playBtn = document.getElementById('play');
    const pauseBtn = document.getElementById('pause');
    if (playBtn) {
        playBtn.disabled = true;
        playBtn.style.opacity = '0.5';
        playBtn.title = 'Play/pause controls not available for this media type';
    }
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.style.opacity = '0.5';
        pauseBtn.title = 'Play/pause controls not available for this media type';
    }

    // Show info about media type
    const sourceNames = {
        'spotify': 'Spotify',
        'vimeo': 'Vimeo',
        'soundcloud': 'SoundCloud',
        'dailymotion': 'Dailymotion',
        'twitch': 'Twitch',
        'generic': 'External Media'
    };

    updateStatus(`${sourceNames[mediaType] || 'Media'} loaded!`, '🎵');

    console.log(`Loaded ${mediaType} media: ${embedUrl}`);

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

        // Re-enable YouTube controls
        enableYouTubeControls();
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

        // Re-enable YouTube controls
        enableYouTubeControls();
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
    // Handle YouTube content
    if (player && data.videoId && !data.mediaSource) {
        player.loadVideoById({
            videoId: data.videoId,
            startSeconds: data.currentTime || 0
        });

        if (data.isPlaying) {
            // Strategy: Try muted autoplay first, then show unmute prompt
            setTimeout(async () => {
                try {
                    // Mute first for autoplay compatibility
                    player.mute();
                    await player.playVideo();
                    requestWakeLock();

                    // Show unmute button overlay
                    showUnmutePrompt();
                    updateStatus('Playing (muted - click to unmute)', '🔇');
                } catch (error) {
                    console.log('Autoplay blocked:', error);
                    showPlayPrompt();
                }
            }, 1000);
        } else {
            updateStatus('Synced (paused)', '⏸️');
        }

        // Save synced state to localStorage
        saveVideoState(data.videoId, data.currentTime || 0, data.isPlaying || false);
    }
    // Handle non-YouTube media (Spotify, Vimeo, etc.)
    else if (data.mediaSource === 'iframe' && data.url) {
        loadGenericIframe(data.url);
        updateStatus(`Synced with ${data.mediaType || 'media'}`, '✅');
    }
});

// Show unmute button overlay
function showUnmutePrompt() {
    // Remove any existing prompt
    const existing = document.getElementById('autoplayPrompt');
    if (existing) existing.remove();

    const unmutePrompt = document.createElement('div');
    unmutePrompt.id = 'autoplayPrompt';
    unmutePrompt.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        z-index: 1000;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
    `;
    unmutePrompt.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.5rem;">🔇</span>
            <span style="font-size: 1rem; font-weight: 600;">Click to unmute</span>
        </div>
    `;

    unmutePrompt.addEventListener('mouseenter', () => {
        unmutePrompt.style.background = 'rgba(102, 126, 234, 0.9)';
    });

    unmutePrompt.addEventListener('mouseleave', () => {
        unmutePrompt.style.background = 'rgba(0, 0, 0, 0.85)';
    });

    unmutePrompt.addEventListener('click', () => {
        if (player && player.unMute) {
            player.unMute();
            unmutePrompt.remove();
            updateStatus('Playing', '▶️');
        }
    });

    const playerWrapper = document.querySelector('.player-wrapper');
    playerWrapper.appendChild(unmutePrompt);

    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (unmutePrompt.parentElement) {
            unmutePrompt.remove();
        }
    }, 10000);
}

// Show play button overlay when autoplay is completely blocked
function showPlayPrompt() {
    const playPrompt = document.createElement('div');
    playPrompt.id = 'autoplayPrompt';
    playPrompt.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 25px 45px;
        border-radius: 12px;
        z-index: 1000;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    `;
    playPrompt.innerHTML = `
        <div style="font-size: 1.3rem; margin-bottom: 15px;">▶️ Click to start playback</div>
        <button id="manualPlayBtn" style="
            background: #667eea;
            color: white;
            border: none;
            padding: 14px 35px;
            border-radius: 8px;
            font-size: 1.1rem;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.3s ease;
        ">Play Video</button>
    `;

    const playerWrapper = document.querySelector('.player-wrapper');
    playerWrapper.appendChild(playPrompt);

    const playBtn = document.getElementById('manualPlayBtn');
    playBtn.addEventListener('mouseenter', () => {
        playBtn.style.background = '#5568d3';
    });
    playBtn.addEventListener('mouseleave', () => {
        playBtn.style.background = '#667eea';
    });

    playBtn.addEventListener('click', async () => {
        try {
            await player.playVideo();
            requestWakeLock();
            playPrompt.remove();
            updateStatus('Playing', '▶️');
        } catch (e) {
            console.error('Failed to play:', e);
            alert('Unable to start playback. Please try using the play button below.');
        }
    });

    updateStatus('Click to start playback', '⏸️');
}

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

// ============================================
// iOS Safari Background Audio Fix
// ============================================

// Detect iOS Safari
const isIOSSafari = () => {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua);
    const webkit = /WebKit/.test(ua);
    const notChrome = !ua.match(/CriOS/i);
    return iOS && webkit && notChrome;
};

// Handle visibility change - useful for resuming playback when returning to page
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && player && player.getPlayerState) {
        const playerState = player.getPlayerState();
        if (playerState === YT.PlayerState.PLAYING) {
            updateMediaSessionPosition();
        }
    }
});

// iOS Safari - Be honest about limitations
if (isIOSSafari()) {
    console.log('iOS Safari detected - Background audio NOT supported when screen locks');

    // Show honest iOS warning
    const showIOSWarning = () => {
        const warningDiv = document.createElement('div');
        warningDiv.id = 'iosWarning';
        warningDiv.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #f59e0b 0%, #dc2626 100%);
            color: white;
            padding: 15px 25px;
            border-radius: 12px;
            z-index: 999;
            max-width: 90%;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            font-size: 0.9rem;
            animation: slideUp 0.3s ease-out;
        `;
        warningDiv.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px;">⚠️ iOS Limitation</div>
            <div style="font-size: 0.85rem; line-height: 1.5;">
                Audio WILL STOP when you lock the screen.<br>
                This is an iOS Safari restriction.<br>
                <strong>Keep your screen ON while watching.</strong>
            </div>
            <button id="dismissIOSWarning" style="
                margin-top: 10px;
                background: rgba(255,255,255,0.25);
                border: none;
                color: white;
                padding: 6px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.8rem;
            ">I Understand</button>
        `;

        document.body.appendChild(warningDiv);

        document.getElementById('dismissIOSWarning').addEventListener('click', () => {
            warningDiv.remove();
            localStorage.setItem('iosWarningSeen', 'true');
        });

        // Auto-dismiss after 20 seconds
        setTimeout(() => {
            if (warningDiv.parentElement) {
                warningDiv.remove();
            }
        }, 20000);
    };

    // Show warning once per session
    if (!localStorage.getItem('iosWarningSeen')) {
        setTimeout(showIOSWarning, 3000);
    }

    // Update Media Session for quick resume when unlocking
    setInterval(() => {
        if (player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
            const videoData = player.getVideoData();
            if (videoData && videoData.video_id) {
                updateMediaSession(videoData);
                updateMediaSessionPosition();
            }
        }
    }, 3000);
}

console.log('iOS Background Audio: ' + (isIOSSafari() ? 'NOT SUPPORTED' : 'Supported'));
