# YouTube Sync

A real-time synchronized YouTube video player that allows multiple users to watch YouTube videos together with synchronized playback controls.

## Overview

YouTube Sync is a web application that enables multiple users to watch YouTube videos simultaneously with synchronized playback. When one user plays, pauses, or loads a video, all connected users experience the same action in real-time.

## Features

### Real-time Synchronization
- **Synchronized Playback**: When any user presses play, all connected clients start playing at the same time
- **Synchronized Pause**: Pausing the video on one client pauses it for everyone
- **Video Loading**: Load a new YouTube video that automatically syncs across all connected users
- **Seek Synchronization**: Jump to specific timestamps that sync across all viewers

### Core Functionality
- **YouTube Video Embedding**: Integrates YouTube's IFrame API for seamless video playback
- **WebSocket Communication**: Uses Socket.io for real-time bidirectional event-based communication
- **Video URL Parsing**: Automatically extracts video IDs from YouTube URLs (supports both youtube.com and youtu.be formats)
- **Multi-user Support**: Unlimited concurrent users can watch together

## Technology Stack

- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.io
- **Frontend**: Vanilla JavaScript with YouTube IFrame API
- **Package Manager**: Yarn

## Getting Started

### Installation

```bash
yarn install
```

### Running the Server

```bash
node server.js
```

The application will be available at `http://localhost:3000`

## Usage

1. Open the application in multiple browser windows/tabs
2. Enter a YouTube video URL in the input field
3. Click "Load Video" to load the video across all connected clients
4. Use the Play/Pause buttons to control playback
5. All connected users will see synchronized playback

## How It Works

The application uses WebSocket connections to maintain real-time synchronization:

1. **Server** ([server.js](server.js)): Express server with Socket.io listening for events (play, pause, loadVideo, seek) and broadcasting them to all connected clients
2. **Client** ([public/index.html](public/index.html)): Web interface with YouTube player that emits and listens for playback events

### Socket Events

- `play`: Triggered when video playback starts
- `pause`: Triggered when video playback is paused
- `loadVideo`: Triggered when a new video is loaded
- `seek`: Triggered when seeking to a specific timestamp

## License

Atyant Yadav
