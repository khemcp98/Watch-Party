import { useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export default function Lobby({ onJoin }) {
  const roomFromUrl = new URLSearchParams(window.location.search).get('room') || '';
  const [name, setName] = useState('');
  const [roomInput, setRoomInput] = useState(roomFromUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createRoom = async () => {
    if (!name.trim()) return setError('Enter your name first');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
      const data = await res.json();
      onJoin({ roomId: data.roomId, name: name.trim() });
    } catch (err) {
      setError('Could not reach server. Check the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = () => {
    if (!name.trim()) return setError('Enter your name first');
    if (!roomInput.trim()) return setError('Enter a room code or link');
    // Accept either a raw code or a full URL with ?room=CODE
    let code = roomInput.trim();
    try {
      const url = new URL(code);
      code = url.searchParams.get('room') || code;
    } catch {
      // not a URL, treat as raw code
    }
    onJoin({ roomId: code, name: name.trim() });
  };

  return (
    <div className="lobby">
      <h1>Watch Party</h1>
      <p className="lobby-subtitle">Watch videos together, in sync, with chat and calls.</p>

      <input
        className="lobby-input"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {!roomFromUrl && (
        <>
          <button className="primary-btn" onClick={createRoom} disabled={loading}>
            {loading ? 'Creating...' : 'Create a New Room'}
          </button>
          <div className="lobby-divider">or</div>
        </>
      )}

      {roomFromUrl && <p className="lobby-hint">You're joining room {roomFromUrl}</p>}

      <input
        className="lobby-input"
        placeholder="Room code or invite link"
        value={roomInput}
        onChange={(e) => setRoomInput(e.target.value)}
      />
      <button className="secondary-btn" onClick={joinRoom}>
        Join Room
      </button>

      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
