import { useEffect, useRef, useState, useCallback } from 'react';
import Peer from 'peerjs';
import { socket } from '../lib/socket';

export default function CallPanel({ roomId, name }) {
  const [remoteStreams, setRemoteStreams] = useState({}); // socketId -> MediaStream
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peerReady, setPeerReady] = useState(false);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const callsRef = useRef({}); // theirPeerId -> MediaConnection
  const screenCallsRef = useRef({}); // theirPeerId -> MediaConnection
  const knownPeers = useRef({}); // theirPeerId -> socketId (everyone we've heard about in this room)

  // Init PeerJS (uses PeerJS public cloud broker - fine to start, self-host later).
  // ICE servers include Google's public STUN plus optional TURN creds from env
  // (set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL for reliable
  // connections across restrictive networks — see README "Scaling up").
  useEffect(() => {
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turnUrl = import.meta.env.VITE_TURN_URL;
    if (turnUrl) {
      iceServers.push({
        urls: turnUrl,
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL,
      });
    }

    const peer = new Peer(undefined, {
      debug: 1,
      config: { iceServers },
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerReady(true);
      socket.emit('webrtc-ready', { roomId, peerId: id });
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
    });

    // Someone is calling us — answer with whatever stream we currently have
    // (camera/mic stream, or empty if we haven't turned anything on yet).
    peer.on('call', (call) => {
      const isScreenShareCall = call.metadata?.type === 'screen';
      const stream = isScreenShareCall ? null : localStreamRef.current;
      call.answer(stream || new MediaStream());
      call.on('stream', (remoteStream) => {
        const socketId = knownPeers.current[call.peer] || call.peer;
        setRemoteStreams((prev) => ({ ...prev, [socketId]: remoteStream }));
      });
      if (isScreenShareCall) {
        screenCallsRef.current[call.peer] = call;
      } else {
        callsRef.current[call.peer] = call;
      }
    });

    return () => {
      peer.destroy();
    };
  }, [roomId]);

  const callPeer = useCallback((theirPeerId, socketId, stream) => {
    const peer = peerRef.current;
    if (!peer) return;
    callsRef.current[theirPeerId]?.close();
    const call = peer.call(theirPeerId, stream || new MediaStream());
    call.on('stream', (remoteStream) => {
      setRemoteStreams((prev) => ({ ...prev, [socketId]: remoteStream }));
    });
    callsRef.current[theirPeerId] = call;
  }, []);

  // Call everyone we currently know about, using whatever local stream we have.
  const callAllKnownPeers = useCallback(() => {
    const stream = localStreamRef.current;
    Object.entries(knownPeers.current).forEach(([theirPeerId, socketId]) => {
      callPeer(theirPeerId, socketId, stream);
    });
  }, [callPeer]);

  // Track every peer that announces readiness (existing members AND new joiners),
  // and immediately call them if we already have an active stream.
  useEffect(() => {
    const handlePeerReady = ({ socketId, peerId: theirPeerId }) => {
      knownPeers.current[theirPeerId] = socketId;
      if (localStreamRef.current) {
        callPeer(theirPeerId, socketId, localStreamRef.current);
      }
      if (screenStreamRef.current) {
        const peer = peerRef.current;
        const call = peer.call(theirPeerId, screenStreamRef.current, { metadata: { type: 'screen' } });
        screenCallsRef.current[theirPeerId] = call;
      }
    };

    socket.on('webrtc-peer-ready', handlePeerReady);
    return () => socket.off('webrtc-peer-ready', handlePeerReady);
  }, [callPeer]);

  // user-list includes peerId for anyone who already set one up (covers
  // late joiners learning about existing members, not just new-joiner announces)
  useEffect(() => {
    const handleUserList = (list) => {
      list.forEach((u) => {
        if (u.peerId && u.id !== socket.id) {
          knownPeers.current[u.peerId] = u.id;
        }
      });
    };
    socket.on('user-list', handleUserList);
    return () => socket.off('user-list', handleUserList);
  }, []);

  useEffect(() => {
    const handleUserLeft = ({ id }) => {
      setRemoteStreams((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      Object.entries(knownPeers.current).forEach(([peerId, socketId]) => {
        if (socketId === id) {
          callsRef.current[peerId]?.close();
          delete callsRef.current[peerId];
          screenCallsRef.current[peerId]?.close();
          delete screenCallsRef.current[peerId];
          delete knownPeers.current[peerId];
        }
      });
    };
    socket.on('user-left', handleUserLeft);
    return () => socket.off('user-left', handleUserLeft);
  }, []);

  const getOrCreateLocalStream = async ({ video, audio }) => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  };

  const toggleCam = async () => {
    try {
      if (!camOn) {
        const stream = await getOrCreateLocalStream({ video: true, audio: micOn });
        if (stream.getVideoTracks().length === 0) {
          const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
          camStream.getVideoTracks().forEach((t) => stream.addTrack(t));
        }
        stream.getVideoTracks().forEach((t) => (t.enabled = true));
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setCamOn(true);
        callAllKnownPeers();
      } else {
        localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = false));
        setCamOn(false);
      }
    } catch (err) {
      alert('Could not access camera: ' + err.message);
    }
  };

  const toggleMic = async () => {
    try {
      if (!micOn) {
        const stream = await getOrCreateLocalStream({ video: camOn, audio: true });
        if (stream.getAudioTracks().length === 0) {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStream.getAudioTracks().forEach((t) => stream.addTrack(t));
        }
        stream.getAudioTracks().forEach((t) => (t.enabled = true));
        setMicOn(true);
        callAllKnownPeers();
      } else {
        localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
        setMicOn(false);
      }
    } catch (err) {
      alert('Could not access microphone: ' + err.message);
    }
  };

  const toggleScreenShare = async () => {
    const peer = peerRef.current;
    if (!screenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = screenStream;
        setScreenSharing(true);

        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
          setScreenSharing(false);
          screenStreamRef.current = null;
          Object.values(screenCallsRef.current).forEach((c) => c.close());
          screenCallsRef.current = {};
        });

        Object.keys(knownPeers.current).forEach((theirPeerId) => {
          if (!peer) return;
          const call = peer.call(theirPeerId, screenStream, { metadata: { type: 'screen' } });
          screenCallsRef.current[theirPeerId] = call;
        });
      } catch (err) {
        if (err.name !== 'NotAllowedError') alert('Screen share failed: ' + err.message);
      }
    } else {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      Object.values(screenCallsRef.current).forEach((c) => c.close());
      screenCallsRef.current = {};
      setScreenSharing(false);
    }
  };

  return (
    <div className="call-panel">
      {!peerReady && <p className="call-status">Connecting call service...</p>}
      <div className="call-controls">
        <button onClick={toggleMic} className={micOn ? 'active' : ''} disabled={!peerReady}>
          {micOn ? '🎤 Mic On' : '🎤 Mic Off'}
        </button>
        <button onClick={toggleCam} className={camOn ? 'active' : ''} disabled={!peerReady}>
          {camOn ? '📹 Cam On' : '📹 Cam Off'}
        </button>
        <button onClick={toggleScreenShare} className={screenSharing ? 'active' : ''} disabled={!peerReady}>
          {screenSharing ? '🖥️ Sharing...' : '🖥️ Share Screen'}
        </button>
      </div>

      <div className="video-grid">
        {(camOn || micOn) && (
          <div className="video-tile local">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <span className="tile-label">You</span>
          </div>
        )}
        {Object.entries(remoteStreams).map(([socketId, stream]) => (
          <RemoteVideoTile key={socketId} stream={stream} />
        ))}
      </div>
    </div>
  );
}

function RemoteVideoTile({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="video-tile">
      <video ref={ref} autoPlay playsInline />
    </div>
  );
}
