import { useEffect, useRef, useState, useCallback } from 'react';
import { parseVideoUrl } from '../lib/videoUrl';
import { useVolumeBoost } from '../lib/useVolumeBoost';
import { socket } from '../lib/socket';
import YouTubePlayer from './YouTubePlayer';

const SYNC_TOLERANCE = 0.75; // seconds of drift allowed before force-resync
const RESYNC_INTERVAL = 5000;

export default function VideoPlayer({ roomId, videoUrl, videoType, initialTime, initialPlaying }) {
  const videoRef = useRef(null);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const suppressEmit = useRef(false);

  const {
    gain,
    setGain,
    gainPercent,
    muted,
    toggleMute,
    ensureGraph,
    maxGain,
  } = useVolumeBoost(videoRef, { maxGain: 4 });

  const parsed = videoUrl ? parseVideoUrl(videoUrl) : null;

  // Apply initial state (e.g. when joining a room mid-playback)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || useIframeFallback) return;
    const applyInitial = () => {
      suppressEmit.current = true;
      el.currentTime = initialTime || 0;
      if (initialPlaying) el.play().catch(() => {});
      suppressEmit.current = false;
    };
    if (el.readyState >= 1) applyInitial();
    else el.addEventListener('loadedmetadata', applyInitial, { once: true });
  }, [videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for remote playback events
  useEffect(() => {
    const handlePlaybackEvent = ({ type, currentTime }) => {
      console.log(`[client] received playback-event: ${type} @ ${currentTime?.toFixed?.(1)}s`);
      const el = videoRef.current;
      if (!el) {
        console.warn('[client] no video element to apply playback-event to');
        return;
      }
      suppressEmit.current = true;

      if (Math.abs(el.currentTime - currentTime) > SYNC_TOLERANCE) {
        el.currentTime = currentTime;
      }
      if (type === 'play') el.play().catch(() => {});
      if (type === 'pause') el.pause();
      if (type === 'seek') el.currentTime = currentTime;

      setTimeout(() => (suppressEmit.current = false), 150);
    };

    const handleRoomState = (state) => {
      const el = videoRef.current;
      if (!el || state.videoUrl == null) return;
      suppressEmit.current = true;
      el.currentTime = state.currentTime;
      if (state.playing) el.play().catch(() => {});
      else el.pause();
      setTimeout(() => (suppressEmit.current = false), 150);
    };

    socket.on('playback-event', handlePlaybackEvent);
    socket.on('room-state', handleRoomState);
    return () => {
      socket.off('playback-event', handlePlaybackEvent);
      socket.off('room-state', handleRoomState);
    };
  }, []);

  // Periodic resync request (in case of drift/late join)
  useEffect(() => {
    const interval = setInterval(() => {
      socket.emit('request-sync', { roomId });
    }, RESYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [roomId]);

  const emitPlayback = useCallback(
    (type) => {
      const el = videoRef.current;
      if (!el || suppressEmit.current) return;
      console.log(`[client] emitting playback-event: ${type} @ ${el.currentTime?.toFixed?.(1)}s`);
      socket.emit('playback-event', {
        roomId,
        type,
        currentTime: el.currentTime,
      });
    },
    [roomId]
  );

  const handleFirstInteraction = () => {
    ensureGraph();
  };

  if (!videoUrl) {
    return (
      <div className="video-empty">
        <p>No video loaded yet. Paste a YouTube link, Google Drive link, or a direct video URL below.</p>
      </div>
    );
  }

  if (parsed?.type === 'youtube') {
    return (
      <YouTubePlayer
        roomId={roomId}
        videoId={parsed.videoId}
        initialTime={initialTime}
        initialPlaying={initialPlaying}
      />
    );
  }

  if (useIframeFallback && parsed?.type === 'drive') {
    return (
      <div className="video-wrap">
        <iframe
          src={parsed.previewUrl}
          allow="autoplay"
          allowFullScreen
          className="video-iframe"
          title="Drive video"
        />
        <p className="video-note">
          Playing via Google Drive preview (direct playback wasn't available for this file —
          make sure it's shared as "Anyone with the link can view"). Volume boost and tight sync
          aren't available in this fallback mode.
        </p>
      </div>
    );
  }

  return (
    <div className="video-wrap" onClickCapture={handleFirstInteraction}>
      <video
        ref={videoRef}
        src={parsed.playableUrl}
        controls
        crossOrigin="anonymous"
        className="video-el"
        onPlay={() => emitPlayback('play')}
        onPause={() => emitPlayback('pause')}
        onSeeked={() => emitPlayback('seek')}
        onError={() => {
          if (parsed.type === 'drive') {
            setUseIframeFallback(true);
          } else {
            setLoadError(
              'Could not load this video directly. Check the URL is a direct, publicly accessible video file.'
            );
          }
        }}
      />
      {loadError && <p className="video-error">{loadError}</p>}

      <div className="volume-boost-panel">
        <label>
          Volume: {muted ? 'Muted' : `${gainPercent}%`}
          <input
            type="range"
            min="0"
            max={maxGain}
            step="0.05"
            value={muted ? 0 : gain}
            onChange={(e) => setGain(parseFloat(e.target.value))}
          />
        </label>
        <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
        <span className="boost-hint">Drag past 100% to boost above normal max volume</span>
      </div>
    </div>
  );
}
