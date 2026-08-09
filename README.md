# Watch Party

Watch videos together in sync with friends — Google Drive links or any direct
video URL, live chat, webcam/mic calls, screen sharing, and volume boost past
100%. Works on desktop and mobile browsers.

## Project structure

```
watchparty/
  server/   Node.js + Express + Socket.io backend (rooms, sync, chat, call signaling)
  client/   React + Vite frontend
```

## How it works

- **Sync**: the backend tracks each room's video URL, play/pause state, and
  timestamp. Every play/pause/seek event broadcasts to everyone else in the
  room, who snap to the same timestamp. Clients also poll a resync every 5s
  to correct drift.
- **Drive videos**: paste a Drive share link. The file must be shared as
  "Anyone with the link can view." We convert it to a direct-download style
  URL and load it in a real `<video>` element (needed for volume boost and
  tight sync). If that fails (private file, Drive blocking direct access),
  it falls back to Drive's embedded preview player — sync and boosted volume
  won't work in that fallback mode, only regular playback controls.
- **Direct URLs**: any publicly reachable `.mp4`/`.webm`/etc. link plays
  directly.
- **Volume boost**: the video's audio is routed through a Web Audio
  `GainNode`, letting you push volume up to 400% (configurable), well past
  the browser's normal 100% ceiling.
- **Calls**: WebRTC via PeerJS (using their free public signaling broker to
  start — see "Scaling up" below to self-host it).
- **Screen share**: standard `getDisplayMedia()`, broadcast the same way as
  webcam video.

## Debugging sync/call issues

Both server and client now log key events to the console:
- **Server terminal**: `[join]` when someone joins a room, `[playback-event]` showing what broadcast happened and to how many other clients.
- **Browser console** (F12): `[client] emitting playback-event` when you play/pause/seek, `[client] received playback-event` when a remote event arrives.

If sync breaks again, check these logs first — a `0 other client(s)` in the server log means the other person isn't actually in the same room (usually a stale/mistyped room code), not a sync bug.

**Everyone has equal control** — there's no host-only lock on play/pause/seek. Any member's action broadcasts to the whole room.

## Local development

### 1. Backend

```bash
cd server
npm install
cp .env.example .env
npm start   # or: node index.js
```

Runs on `http://localhost:4000` by default.

### 2. Frontend

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

Runs on `http://localhost:5173`. Open it in two browser tabs (or two
devices on the same network) to test a watch party with yourself.

## Deploying live

### Backend → Render (or Railway)

Both support long-lived WebSocket connections, which Vercel's serverless
functions don't handle well — Socket.io needs a persistent process.

1. Push this repo to GitHub.
2. On Render: New → Web Service → point at your repo, root directory
   `server`.
   - Build command: `npm install`
   - Start command: `node index.js`
3. Add environment variable `CLIENT_ORIGIN` = your deployed frontend URL
   (e.g. `https://your-app.vercel.app`) — this is required for CORS to
   allow the frontend to connect.
4. Deploy. Note the resulting backend URL (e.g.
   `https://watchparty-server.onrender.com`).

### Frontend → Vercel (or Netlify)

1. Import the repo on Vercel, set root directory to `client`.
2. Add environment variable `VITE_SERVER_URL` = your Render backend URL from
   above.
3. Deploy.

### After both are live

Update the backend's `CLIENT_ORIGIN` env var to match your final Vercel
frontend URL exactly (including `https://`), then redeploy the backend so
CORS allows it.

## Scaling up / known limitations

- **PeerJS public broker**: fine for testing and small groups, but it's a
  shared free service — for reliability at scale, self-host a PeerServer
  (`npm install peer` — a few lines) and point the frontend's `Peer(...)`
  config at it.
- **TURN server**: WebRTC calls between people on restrictive networks
  (corporate NAT, some mobile carriers) may fail to connect peer-to-peer
  without a TURN relay. For production reliability, add a TURN server
  (e.g. via Twilio's Network Traversal Service, or self-hosted coturn) to
  the PeerJS/ICE config in `CallPanel.jsx`.
- **Room state is in-memory**: if the backend restarts, active rooms are
  lost. Fine for a friends app; for persistence across restarts you'd add
  Redis or a small DB.
- **Drive direct playback**: only works for files shared as "Anyone with
  the link." Very large files or Drive's own throttling can still force the
  iframe fallback — that's expected, not a bug.
- **Call video quality/bandwidth**: with several people on cam simultaneously,
  consider adding simulcast or a media server (mediasoup/LiveKit) if group
  size grows past ~4-6 people — pure mesh WebRTC (what's built here) gets
  bandwidth-heavy beyond that.
