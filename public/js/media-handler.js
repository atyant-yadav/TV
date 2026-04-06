// Media Handler - Support for multiple video/audio sources

// Detect media type from URL
function detectMediaType(url) {
    const urlLower = url.toLowerCase();

    // YouTube Video
    if (urlLower.includes('youtube.com/watch') || urlLower.includes('youtu.be/')) {
        return { type: 'youtube-video', source: 'youtube' };
    }

    // YouTube Playlist
    if (urlLower.includes('youtube.com/playlist') || urlLower.includes('list=')) {
        return { type: 'youtube-playlist', source: 'youtube' };
    }

    // Spotify Track
    if (urlLower.includes('spotify.com/track')) {
        return { type: 'spotify-track', source: 'spotify' };
    }

    // Spotify Playlist
    if (urlLower.includes('spotify.com/playlist')) {
        return { type: 'spotify-playlist', source: 'spotify' };
    }

    // Spotify Album
    if (urlLower.includes('spotify.com/album')) {
        return { type: 'spotify-album', source: 'spotify' };
    }

    // Vimeo
    if (urlLower.includes('vimeo.com/')) {
        return { type: 'vimeo-video', source: 'vimeo' };
    }

    // Dailymotion
    if (urlLower.includes('dailymotion.com/')) {
        return { type: 'dailymotion-video', source: 'dailymotion' };
    }

    // Twitch
    if (urlLower.includes('twitch.tv/')) {
        return { type: 'twitch-stream', source: 'twitch' };
    }

    // SoundCloud
    if (urlLower.includes('soundcloud.com/')) {
        return { type: 'soundcloud-track', source: 'soundcloud' };
    }

    // Generic iframe (last resort)
    return { type: 'generic-iframe', source: 'generic' };
}

// Extract YouTube video ID
function extractYouTubeVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Extract YouTube playlist ID
function extractYouTubePlaylistId(url) {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

// Extract Spotify ID
function extractSpotifyId(url) {
    const match = url.match(/spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/);
    return match ? { type: match[1], id: match[2] } : null;
}

// Extract Vimeo ID
function extractVimeoId(url) {
    const match = url.match(/vimeo\.com\/(\d+)/);
    return match ? match[1] : null;
}

// Extract Dailymotion ID
function extractDailymotionId(url) {
    const match = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

// Extract Twitch channel
function extractTwitchChannel(url) {
    const match = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    return match ? match[1] : null;
}

// Generate embed URL for different sources
function generateEmbedUrl(url, mediaInfo) {
    switch (mediaInfo.source) {
        case 'youtube':
            const videoId = extractYouTubeVideoId(url);
            const playlistId = extractYouTubePlaylistId(url);

            if (playlistId && videoId) {
                return `https://www.youtube.com/embed/${videoId}?list=${playlistId}&enablejsapi=1&origin=${window.location.origin}`;
            } else if (playlistId) {
                return `https://www.youtube.com/embed/videoseries?list=${playlistId}&enablejsapi=1&origin=${window.location.origin}`;
            } else if (videoId) {
                return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${window.location.origin}`;
            }
            return null;

        case 'spotify':
            const spotifyData = extractSpotifyId(url);
            if (spotifyData) {
                return `https://open.spotify.com/embed/${spotifyData.type}/${spotifyData.id}`;
            }
            return null;

        case 'vimeo':
            const vimeoId = extractVimeoId(url);
            return vimeoId ? `https://player.vimeo.com/video/${vimeoId}` : null;

        case 'dailymotion':
            const dailymotionId = extractDailymotionId(url);
            return dailymotionId ? `https://www.dailymotion.com/embed/video/${dailymotionId}` : null;

        case 'twitch':
            const twitchChannel = extractTwitchChannel(url);
            return twitchChannel ? `https://player.twitch.tv/?channel=${twitchChannel}&parent=${window.location.hostname}` : null;

        case 'soundcloud':
            return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false`;

        case 'generic':
            // Try to use the URL as-is for iframe
            return url;

        default:
            return null;
    }
}

// Check if source supports JavaScript API
function supportsAPI(source) {
    return source === 'youtube';
}

// Get media ID for state management
function getMediaId(url, mediaInfo) {
    switch (mediaInfo.source) {
        case 'youtube':
            const videoId = extractYouTubeVideoId(url);
            const playlistId = extractYouTubePlaylistId(url);
            return playlistId ? `playlist_${playlistId}` : videoId;

        case 'spotify':
            const spotifyData = extractSpotifyId(url);
            return spotifyData ? `${spotifyData.type}_${spotifyData.id}` : null;

        case 'vimeo':
            return extractVimeoId(url);

        case 'dailymotion':
            return extractDailymotionId(url);

        case 'twitch':
            return extractTwitchChannel(url);

        default:
            // Use hash of URL for generic content
            return btoa(url).substring(0, 20);
    }
}

// Check if media is audio-only
function isAudioOnly(mediaInfo) {
    return mediaInfo.source === 'spotify' || mediaInfo.source === 'soundcloud';
}

// Get friendly name for media source
function getSourceName(source) {
    const names = {
        'youtube': 'YouTube',
        'spotify': 'Spotify',
        'vimeo': 'Vimeo',
        'dailymotion': 'Dailymotion',
        'twitch': 'Twitch',
        'soundcloud': 'SoundCloud',
        'generic': 'External Media'
    };
    return names[source] || 'Unknown';
}
