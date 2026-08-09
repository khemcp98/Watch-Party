import { useEffect, useRef, useState, useCallback } from 'react';
import { parseVideoUrl } from '../lib/videoUrl';
import { useVolumeBoost } from '../lib/useVolumeBoost';
import { useHtml5Adapter } from '../lib/html5Adapter';
import { useYouTubeAdapter } from '../lib/youtubeAdapter';
import { socket } from '../lib/socket';

const SYNC_TOLERANCE = 1; // seconds of drift allowed before force-resync
const RESYNC_INTERVAL = 5000;

export default function UnifiedPlayer({ roomId, videoUrl, videoType, initialTime, initialPlaying }) {
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const suppressEmit = useRef(false);

  const parsed = videoUrl ? parseVideoUrl(videoUrl) : null;
  const source = parsed?.type; // 'youtube' | 'drive' | 'direct'

  // --- Adapters: exactly one is "active" depending on source ---
  const html5 = useHtml5Adapter();

  const handleYouTubeLocalChange = useCallback(
    (type, currentTime) => {
      console.log(`[client] emitting playback-event (youtube): ${type} @ ${currentTime?.toFixed?.(1)}s`);
      socket.emit('playback-event', { roomId, type, currentTime });
    },
    [roomId]
  );
  const youtube = useYouTubeAdapter({
    videoId: source === 'youtube' ? parsed.videoId : null,
    onLocalStateChange: handleYouTubeLocalChange,
    suppressRef: suppressEmit,
  });

  // Pick the active adapter's uniform interface. Everything below this
  // point only talks to `active` — it never needs to know the source type.
  const active = source === 'youtube' ? youtube : html5;

  // Volume boost only applies to the html5 <video> path (YouTube/Drive-iframe
  // don't expose raw audio to embedders).
  const {
    gain,
    setGain,
    gainPercent,
    muted,
    toggleMute,
    ensureGraph,
    maxGain,
  } = useVolumeBoost(html5.videoRef, { maxGain: 4 });

  const volumeBoostAvailable = source !== 'youtube' && !useIframeFallback;

  // Apply initial state once the active player is ready (e.g. joining mid-playback)
  useEffect(() => {
    if (!videoUrl) return;
    let attempts = 0;
    const tryApply = () => {
      if (active.isReady()) {
        suppressEmit.current = true;
        if (initialTime) active.seekTo(initialTime);
        if (initialPlaying) active.play();
        setTimeout(() => (suppressEmit.current = false), 300);
      } else if (attempts < 40) {
        attempts += 1;
        setTimeout(tryApply, 150);
      }
    };
    tryApply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, source]);

  // Single sync listener for remote playback events + late-join room state,
  // regardless of which adapter is active.
  useEffect(() => {
    const applyRemote = (type, currentTime) => {
      if (!active.isReady()) return;
      suppressEmit.current = true;

      const drift = Math.abs(active.getCurrentTime() - currentTime);
      if (drift > SYNC_TOLERANCE) active.seekTo(currentTime);

      if (type === 'play') active.play();
      if (type === 'pause') active.pause();
      if (type === 'seek') active.seekTo(currentTime);

      setTimeout(() => (suppressEmit.current = false), 250);
    };

    const handlePlaybackEvent = ({ type, currentTime }) => {
      console.log(`[client] received playback-event: ${type} @ ${currentTime?.toFixed?.(1)}s`);
      applyRemote(type, currentTime);
    };

    const handleRoomState = (state) => {
      if (state.videoUrl == null) return;
      applyRemote(state.playing ? 'play' : 'pause', state.currentTime);
    };

    socket.on('playback-event', handlePlaybackEvent);
    socket.on('room-state', handleRoomState);
    return () => {
      socket.off('playback-event', handlePlaybackEvent);
      socket.off('room-state', handleRoomState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Periodic resync request (covers drift + late joiners)
  useEffect(() => {
    const interval = setInterval(() => {
      socket.emit('request-sync', { roomId });
    }, RESYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [roomId]);

  // Emits from the html5 <video> element's native events (play/pause/seeked).
  // YouTube emits via handleYouTubeLocalChange instead, since it doesn't
  // expose native DOM events.
  const emitHtml5Playback = useCallback(
    (type) => {
      if (suppressEmit.current) return;
      const currentTime = html5.getCurrentTime();
      console.log(`[client] emitting playback-event: ${type} @ ${currentTime?.toFixed?.(1)}s`);
      socket.emit('playback-event', { roomId, type, currentTime });
    },
    [roomId, html5]
  );

  const handleFirstInteraction = () => ensureGraph();

  if (!videoUrl) {
    return (
      <div className="video-empty">
        <p>No video loaded yet. Paste a YouTube link, Google Drive link, or a direct video URL below.</p>
      </div>
    );
  }

  return (
    <div className="player-shell">
      {source === 'youtube' && (
        <div className="video-wrap youtube-wrap">
          <div ref={youtube.containerRef} className="youtube-iframe-target" />
          {!youtube.ready && <p className="video-note">Loading YouTube player...</p>}
        </div>
      )}

      {source !== 'youtube' && useIframeFallback && parsed?.type === 'drive' && (
        <div className="video-wrap">
          <iframe
            src={parsed.previewUrl}
            allow="autoplay"
            allowFullScreen
            className="video-iframe"
            title="Drive video"
          />
        </div>
      )}

      {source !== 'youtube' && !(useIframeFallback && parsed?.type === 'drive') && (
        <div className="video-wrap" onClickCapture={handleFirstInteraction}>
          <video
            ref={html5.videoRef}
            src={parsed.playableUrl}
            controls
            crossOrigin="anonymous"
            className="video-el"
            onPlay={() => emitHtml5Playback('play')}
            onPause={() => emitHtml5Playback('pause')}
            onSeeked={() => emitHtml5Playback('seek')}
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
        </div>
      )}

      {loadError && <p className="video-error">{loadError}</p>}

      {source === 'youtube' && (
        <p className="video-note">
          YouTube playback goes through YouTube's own player — volume boost above 100% isn't
          available here (YouTube doesn't expose raw audio to embedded players). Play, pause,
          and seek stay in sync with everyone in the room.
        </p>
      )}
      {source !== 'youtube' && useIframeFallback && (
        <p className="video-note">
          Playing via Google Drive preview (direct playback wasn't available for this file —
          make sure it's shared as "Anyone with the link can view"). Volume boost and tight sync
          aren't available in this fallback mode.
        </p>
      )}

      {volumeBoostAvailable && (
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
      )}
    </div>
  );
}
