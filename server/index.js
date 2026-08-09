require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// ---- In-memory room state ----
// rooms[roomId] = {
//   videoUrl, videoType, playing, currentTime, lastUpdate,
//   users: { socketId: { name, peerId } },
//   host: socketId
// }
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      videoUrl: null,
      videoType: null, // 'drive' | 'direct'
      playing: false,
      currentTime: 0,
      lastUpdate: Date.now(),
      users: {},
      host: null,
    };
  }
  return rooms[roomId];
}

function publicRoomState(room) {
  return {
    videoUrl: room.videoUrl,
    videoType: room.videoType,
    playing: room.playing,
    currentTime: room.playing
      ? room.currentTime + (Date.now() - room.lastUpdate) / 1000
      : room.currentTime,
    host: room.host,
    users: Object.entries(room.users).map(([id, u]) => ({ id, ...u })),
  };
}

// REST: create a room
app.post('/api/rooms', (req, res) => {
  const roomId = nanoid(8);
  getOrCreateRoom(roomId);
  res.json({ roomId });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

function normalizeRoomId(id) {
  return (id || '').trim();
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId: rawRoomId, name, peerId }) => {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      socket.emit('join-error', { message: 'No room code provided.' });
      return;
    }
    const isNewRoom = !rooms[roomId];
    const room = getOrCreateRoom(roomId);
    currentRoom = roomId;
    socket.join(roomId);

    room.users[socket.id] = { name: name || 'Guest', peerId: peerId || null };
    if (!room.host) room.host = socket.id;

    console.log(`[join] ${name || 'Guest'} (${socket.id}) joined room "${roomId}"${isNewRoom ? ' (new room)' : ''} — ${Object.keys(room.users).length} in room`);

    socket.emit('room-state', { ...publicRoomState(room), isNewRoom });
    socket.to(roomId).emit('user-joined', { id: socket.id, name, peerId });
    io.to(roomId).emit('user-list', publicRoomState(room).users);
  });

  socket.on('set-video', ({ roomId: rawRoomId, videoUrl, videoType }) => {
    const roomId = currentRoom || normalizeRoomId(rawRoomId);
    const room = rooms[roomId];
    if (!room) return;
    room.videoUrl = videoUrl;
    room.videoType = videoType;
    room.playing = false;
    room.currentTime = 0;
    room.lastUpdate = Date.now();
    io.to(roomId).emit('video-changed', { videoUrl, videoType });
  });

  // Playback sync: play, pause, seek
  socket.on('playback-event', ({ roomId: rawRoomId, type, currentTime }) => {
    const roomId = currentRoom || normalizeRoomId(rawRoomId);
    const room = rooms[roomId];
    if (!room) {
      console.log(`[playback-event] ignored — no room "${roomId}" for socket ${socket.id}`);
      return;
    }

    room.currentTime = currentTime;
    room.lastUpdate = Date.now();
    room.playing = type === 'play';

    const recipients = io.sockets.adapter.rooms.get(roomId);
    console.log(`[playback-event] ${type} @ ${currentTime?.toFixed?.(1)}s in "${roomId}" from ${socket.id} -> broadcasting to ${(recipients?.size || 1) - 1} other client(s)`);

    socket.to(roomId).emit('playback-event', {
      type,
      currentTime,
      from: socket.id,
      serverTime: Date.now(),
    });
  });

  // Periodic resync ping from host (or any client requesting current state)
  socket.on('request-sync', () => {
    const room = rooms[currentRoom];
    if (!room) return;
    socket.emit('room-state', publicRoomState(room));
  });

  // Chat
  socket.on('chat-message', ({ message, name }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chat-message', {
      id: nanoid(6),
      name,
      message,
      at: Date.now(),
    });
  });

  // WebRTC signaling relay (peerId based, for call setup metadata like "who to call")
  socket.on('webrtc-ready', ({ peerId }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    if (room.users[socket.id]) room.users[socket.id].peerId = peerId;
    socket.to(currentRoom).emit('webrtc-peer-ready', { socketId: socket.id, peerId });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;
    delete room.users[socket.id];

    if (room.host === socket.id) {
      const remaining = Object.keys(room.users);
      room.host = remaining[0] || null;
    }

    io.to(currentRoom).emit('user-left', { id: socket.id });
    io.to(currentRoom).emit('user-list', publicRoomState(room).users);

    // Clean up empty rooms after a delay
    if (Object.keys(room.users).length === 0) {
      setTimeout(() => {
        if (rooms[currentRoom] && Object.keys(rooms[currentRoom].users).length === 0) {
          delete rooms[currentRoom];
        }
      }, 5 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Watch party server running on port ${PORT}`);
});
