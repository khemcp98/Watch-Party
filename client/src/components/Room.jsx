import { useEffect, useState } from 'react';
import { socket, connectSocket } from '../lib/socket';
import VideoPlayer from './VideoPlayer';
import Chat from './Chat';
import CallPanel from './CallPanel';
import { detectVideoType } from '../lib/videoUrl';

export default function Room({ roomId, name, onLeave }) {
  const [videoState, setVideoState] = useState({
    videoUrl: null,
    videoType: null,
    currentTime: 0,
    playing: false,
  });
  const [users, setUsers] = useState([]);
  const [urlInput, setUrlInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState('chat'); // 'chat' | 'call'
  const [connected, setConnected] = useState(socket.connected);
  const [joinError, setJoinError] = useState(null);

  useEffect(() => {
    connectSocket();

    const doJoin = () => {
      console.log(`[client] joining room "${roomId}" as "${name}"`);
      socket.emit('join-room', { roomId, name });
    };

    if (socket.connected) doJoin();

    const handleConnect = () => {
      setConnected(true);
      doJoin(); // re-join on reconnect (e.g. after a network blip)
    };
    const handleDisconnect = () => setConnected(false);
    const handleJoinError = ({ message }) => setJoinError(message);

    const handleRoomState = (state) => {
      console.log('[client] received room-state', state);
      setVideoState({
        videoUrl: state.videoUrl,
        videoType: state.videoType,
        currentTime: state.currentTime,
        playing: state.playing,
      });
      setUsers(state.users);
    };
    const handleVideoChanged = ({ videoUrl, videoType }) => {
      setVideoState((prev) => ({ ...prev, videoUrl, videoType, currentTime: 0, playing: false }));
    };
    const handleUserList = (list) => setUsers(list);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('join-error', handleJoinError);
    socket.on('room-state', handleRoomState);
    socket.on('video-changed', handleVideoChanged);
    socket.on('user-list', handleUserList);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('join-error', handleJoinError);
      socket.off('room-state', handleRoomState);
      socket.off('video-changed', handleVideoChanged);
      socket.off('user-list', handleUserList);
    };
  }, [roomId, name]);

  const loadVideo = (e) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    const videoType = detectVideoType(urlInput.trim());
    socket.emit('set-video', { roomId, videoUrl: urlInput.trim(), videoType });
    setUrlInput('');
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <h2>Room: {roomId}</h2>
          <span className="user-count">
            <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
            {connected ? `${users.length} watching` : 'Reconnecting...'}
          </span>
        </div>
        <div className="room-header-actions">
          <button onClick={copyInviteLink}>{copied ? 'Copied!' : 'Copy Invite Link'}</button>
          <button onClick={onLeave} className="leave-btn">Leave</button>
        </div>
      </header>

      {joinError && <div className="join-error-banner">{joinError}</div>}

      <div className="room-body">
        <main className="room-main">
          <VideoPlayer
            roomId={roomId}
            videoUrl={videoState.videoUrl}
            videoType={videoState.videoType}
            initialTime={videoState.currentTime}
            initialPlaying={videoState.playing}
          />
          <form onSubmit={loadVideo} className="url-form">
            <input
              placeholder="Paste YouTube link, Google Drive link, or direct video URL..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <button type="submit">Load Video</button>
          </form>
          {users.length > 0 && (
            <div className="user-chips">
              {users.map((u) => (
                <span key={u.id} className="user-chip">
                  {u.name}
                  {u.id === socket.id ? ' (you)' : ''}
                </span>
              ))}
            </div>
          )}
        </main>

        <aside className="room-sidebar">
          <div className="sidebar-tabs">
            <button
              className={mobileTab === 'chat' ? 'active' : ''}
              onClick={() => setMobileTab('chat')}
            >
              Chat
            </button>
            <button
              className={mobileTab === 'call' ? 'active' : ''}
              onClick={() => setMobileTab('call')}
            >
              Call
            </button>
          </div>
          <div className={`sidebar-section ${mobileTab === 'chat' ? 'mobile-visible' : 'mobile-hidden'}`}>
            <Chat roomId={roomId} name={name} />
          </div>
          <div className={`sidebar-section call-section ${mobileTab === 'call' ? 'mobile-visible' : 'mobile-hidden'}`}>
            <CallPanel roomId={roomId} name={name} />
          </div>
        </aside>
      </div>
    </div>
  );
}
