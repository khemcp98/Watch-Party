import { useState } from 'react';
import Lobby from './components/Lobby';
import Room from './components/Room';
import { socket } from './lib/socket';
import './App.css';

export default function App() {
  const [session, setSession] = useState(null); // { roomId, name }

  const handleJoin = ({ roomId, name }) => {
    const url = new URL(window.location);
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url);
    setSession({ roomId, name });
  };

  const handleLeave = () => {
    socket.disconnect();
    const url = new URL(window.location);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
    setSession(null);
  };

  if (!session) {
    return <Lobby onJoin={handleJoin} />;
  }

  return <Room roomId={session.roomId} name={session.name} onLeave={handleLeave} />;
}
