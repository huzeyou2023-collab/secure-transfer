<p align="center">
  <img src="resources/icon.png" alt="Sync Share" width="80" />
</p>
<h1 align="center">Sync Share</h1>
<p align="center">Cross-platform file sharing & chat for local networks — no cloud, no accounts, no setup.</p>

---

## The Problem

Peer discovery on a local network sounds simple. It's not.

- **UDP broadcast (255.255.255.255)?** macOS silently drops it on Wi-Fi.
- **Subnet-directed broadcast?** Corporate APs and guest networks often strip it.
- **Bonjour / mDNS?** Great on Apple devices, flaky on Windows — ghost services linger after restart, peers vanish mid-transfer.
- **Single ping health checks?** One dropped packet and the peer disappears from the UI.

## The Solution

A dual-channel discovery engine inspired by how AirDrop, LocalSend, and KDE Connect handle it:

1. **UDP Multicast** (`239.255.70.83`) as primary — joins the group on every NIC. Unlike broadcast, multicast is designed for group communication and every OS honours it.
2. **Subnet-directed broadcast** as fallback — for networks that strip multicast. Computed per-interface using actual subnet masks.
3. **Startup burst** — 5 rapid packets in 1.5 seconds so peers find each other almost instantly after launch.
4. **Resilient health checks** — HTTP `/ping` every 5 seconds, peers only removed after 3 consecutive failures. One dropped packet doesn't kill the connection.
5. **Persistent peer identity** — peer ID written to disk on first launch. Same device across restarts, no ghost entries.

## Features

- **Instant discovery** — Devices found in under 2 seconds via multicast + broadcast
- **File sharing** — Drag & drop onto chat or use the attachment button
- **Real-time chat** — Direct messaging between peers, no accept/reject needed
- **Accept / Reject** — Receiver gets a prompt before any file is saved
- **Transfer progress** — Real-time progress bar with "From sender to receiver" labels
- **System notifications** — Native OS notifications for incoming files and messages
- **Background mode** — App lives in system tray, receives files and chats when minimized
- **Light / Dark theme** — Toggle in the header, persisted across sessions
- **Cross-platform** — macOS, Windows, and Linux

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Language | TypeScript |
| Frontend | React 18 + Bootstrap 5 |
| Bundler | Vite |
| Peer discovery | UDP Multicast + Broadcast (custom) |
| Health checks | HTTP `/ping` with retry threshold |
| Signaling | HTTP (accept/reject + chat) |
| File transfer | Raw TCP streams |
| Packaging | electron-builder |

## How It Works

1. **Discovery** — Each instance announces itself via UDP multicast + broadcast every 2 seconds. A startup burst of 5 packets ensures near-instant detection.
2. **Health** — Peers are HTTP-pinged every 5 seconds. Only removed after 3 consecutive failures.
3. **Select a device** — Click a device to open the chat & share view.
4. **Send a file** — Drag & drop onto the chat window or click the attachment icon. Receiver sees an accept/reject prompt.
5. **Chat** — Type a message and hit Enter. Delivered directly, no approval needed. Long messages collapse with "Show more / Show less".
6. **Transfer** — On accept, a TCP connection streams the file with real-time progress.
7. **Notifications** — Incoming files and messages trigger native OS notifications. Clicking them brings the app to focus.
8. **Background** — Closing the window hides to system tray. The app keeps running until you quit from the tray menu.

## Project Structure

```
sync-share/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry, window, system tray
│   │   ├── ipc-handlers.ts      # IPC bridge to renderer
│   │   ├── discovery/           # UDP multicast/broadcast discovery
│   │   ├── signaling/           # HTTP signaling (transfer + chat)
│   │   ├── transfer/            # TCP file sender/receiver
│   │   └── utils/               # Network & platform helpers
│   ├── preload/                 # Context bridge (preload script)
│   │   └── index.ts
│   └── renderer/                # React frontend
│       ├── App.tsx              # Root component
│       ├── components/          # ChatBox, TransferList, IncomingAlert, etc.
│       ├── pages/               # DeviceGrid, ShareView
│       ├── hooks/               # useDevices, useTransfers, useChat, useTheme
│       └── services/            # Device helpers (initials, gradients)
├── resources/                   # App icons (png, icns, ico)
└── package.json
```

## Received Files Location

| OS | Path |
|---|---|
| macOS | `~/Downloads/sync-share/` |
| Windows | `C:\Users\<user>\Downloads\sync-share\` |
| Linux | `~/Downloads/sync-share/` |

Duplicate file names are handled automatically (e.g. `file (1).txt`).

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9

## Setup

```bash
git clone <repo-url> sync-share
cd sync-share
npm install
```

## Development

```bash
npm run dev
```

Starts Vite dev server (hot-reload) + Electron main process.

## Production

```bash
npm start
```

## Packaging

```bash
npm run dist          # All platforms
npm run dist:mac      # macOS (.dmg)
npm run dist:win      # Windows (.exe)
npm run dist:linux    # Linux (.AppImage + .deb)
```

## License

MIT
