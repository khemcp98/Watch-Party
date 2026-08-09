import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { parseVideoUrl } from '../lib/videoUrl';
import { useVolumeBoost } from '../lib/useVolumeBoost';
import { loadYouTubeApi } from '../lib/youtubeApi';
import { socket } from '../lib/socket';

// ---- Shared sync tuning ----
// Different backends have different seek precision, so tolerance varies,
// but every backend goes through the exact same sync engine below.
const RESYNC_INTERVAL = 5000;
const ECHO_SUPPRESS_MS = 250;

/**
 * Every backend (native <video>, YouTube IFrame API) implements this same
 * tiny interface so the sync engine never needs to know which one it's
 * talking to:
 *   backend.getTime()      -> number (seconds)
 *   backend.play()         -> void
 *   backend.pause()        -> void
 *   backend.seek(seconds)  -> void
 *   backend.isReady()      -> boolean
 */

// ---------------------------------------------------------------------------
// Native <video> backend (direct URLs + Drive direct playback)
// ---------------------------------------------------------------------------
const NativeVideoBackend = forwardRef(function NativeVideoBackend(
  { src, onError, onBackendEvent, tolerance },
  ref
) {
  const videoRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getTime: () => videoRef.current?.currentTime ?? 0,
    play: () => videoRef.current?.play().catch(() => {}),
    pause: () => videoRef.current?.pause(),
    seek: (t) => {
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    isReady: () => !!videoRef.current && videoRef.current.readyState >= 1,
    tolerance,
  }));

  const {
    gain, setGain, gainPercent, muted, toggleMute, ensureGraph, maxGain,
  } = useVolumeBoost(videoRef, { maxGain: 4 });

  return (
    <div className="video-wrap" onClickCapture={() => ensureGraph()}>
      <video
        ref={videoRef}
        src={src}
        controls
        crossOrigin="anonymous"
        className="video-el"
        onPlay={() => onBackendEvent('play')}
        onPause={() => onBackendEvent('pause')}
        onSeeked={() => onBackendEvent('seek')}
        onError={onError}
      />
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
});

// ---------------------------------------------------------------------------
// YouTube backend
// ---------------------------------------------------------------------------
const YouTubeBackend = forwardRef(function YouTubeBackend(
  { videoId, onBackendEvent, onReadyChange, tolerance },
  ref
) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const lastEmittedState = useRef(null);
  const suppressStateEmit = useRef(false);

  useImperativeHandle(ref, () => ({
    getTime: () => {
      const p = playerRef.current;
      return p && typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0;
    },
    play: () => playerRef.current?.playVideo?.(),
    pause: () => playerRef.current?.pauseVideo?.(),
    seek: (t) => playerRef.current?.seekTo?.(t, true),
    isReady: () => !!playerRef.current && typeof playerRef.current.getCurrentTime === 'function',
    // suppress the player's own onStateChange->emit for a beat after we
    // programmatically drive it, so remote corrections don't bounce back out
    suppressNextEmit: () => {
      suppressStateEmit.current = true;
      setTimeout(() => (suppressStateEmit.current = false), 400);
    },
    tolerance,
  }));

  useEffect(() => {
    let cancelled = false;
    onReadyChange(false);

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            if (cancelled) return;
            onReadyChange(true);
          },
          onStateChange: (event) => {
            if (suppressStateEmit.current) return;
            // 1 = playing, 2 = paused
            if (event.data === 1 && lastEmittedState.current !== 'play') {
              lastEmittedState.current = 'play';
              onBackendEvent('play');
            } else if (event.data === 2) {
              lastEmittedState.current = 'pause';
              onBackendEvent('pause');
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="youtube-iframe-target" />;
});

// ---------------------------------------------------------------------------
// Unified sync engine + backend switcher
// ---------------------------------------------------------------------------
export default function UnifiedPlayer({ roomId, videoUrl, videoType, initialTime, initialPlaying }) {
  const backendRef = useRef(null);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [ytReady, setYtReady] = useState(false);
  const suppressEmit = useRef(false);

  const parsed = videoUrl ? parseVideoUrl(videoUrl) : null;
  const backendKind = useIframeFallback ? 'drive-iframe' : parsed?.type; // 'youtube' | 'drive' | 'direct' | 'drive-iframe'
  const tolerance = backendKind === 'youtube' ? 1.5 : 0.75;

  const applyRemote = useCallback((type, targetTime) => {
    const b = backendRef.current;
    if (!b || !b.isReady?.()) return;

    suppressEmit.current = true;
    if (b.suppressNextEmit) b.suppressNextEmit();

    const drift = Math.abs(b.getTime() - targetTime);
    if (drift > (b.tolerance ?? tolerance)) {
      b.seek(targetTime);
    }
    if (type === 'play') b.play();
    if (type === 'pause') b.pause();
    if (type === 'seek') b.seek(targetTime);

    setTimeout(() => (suppressEmit.current = false), ECHO_SUPPRESS_MS);
  }, [tolerance]);

  // Apply initial state once the backend signals it's ready (native video
  // fires this via isReady() polling on mount; YouTube via onReadyChange)
  useEffect(() => {
    if (backendKind === 'youtube' && !ytReady) return;
    const b = backendRef.current;
    if (!b) return;
    // small delay lets native <video> reach readyState after src swap
    const t = setTimeout(() => {
      if (!b.isReady?.()) return;
      suppressEmit.current = true;
      if (b.suppressNextEmit) b.suppressNextEmit();
      b.seek(initialTime || 0);
      if (initialPlaying) b.play();
      setTimeout(() => (suppressEmit.current = false), ECHO_SUPPRESS_MS);
    }, 50);
    return () => clearTimeout(t);
  }, [videoUrl, backendKind, ytReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // One listener path for remote events, regardless of backend
  useEffect(() => {
    const handlePlaybackEvent = ({ type, currentTime, serverTime }) => {
      // Compensate for time spent in transit since the server stamped this
      const latencyMs = serverTime ? Date.now() - serverTime : 0;
      const compensated = type === 'pause' ? currentTime : currentTime + Math.max(0, latencyMs) / 1000;
      console.log(`[client] received playback-event: ${type} @ ${compensated.toFixed(1)}s (latency ${latencyMs}ms)`);
      applyRemote(type, compensated);
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
  }, [applyRemote]);

  // Periodic resync
  useEffect(() => {
    const interval = setInterval(() => socket.emit('request-sync', { roomId }), RESYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [roomId]);

  const emitPlayback = useCallback((type) => {
    const b = backendRef.current;
    if (!b || suppressEmit.current || !b.isReady?.()) return;
    const currentTime = b.getTime();
    console.log(`[client] emitting playback-event: ${type} @ ${currentTime.toFixed(1)}s`);
    socket.emit('playback-event', { roomId, type, currentTime });
  }, [roomId]);

  if (!videoUrl) {
    return (
      <div className="video-empty">
        <p>No video loaded yet. Paste a YouTube link, Google Drive link, or a direct video URL below.</p>
      </div>
    );
  }

  if (backendKind === 'drive-iframe') {
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
          make sure it's shared as "Anyone with the link can view"). Volume boost and sync
          aren't available in this fallback mode.
        </p>
      </div>
    );
  }

  return (
    <>
      {backendKind === 'youtube' && (
        <div className="video-wrap youtube-wrap">
          <YouTubeBackend
            ref={backendRef}
            videoId={parsed.videoId}
            tolerance={tolerance}
            onReadyChange={setYtReady}
            onBackendEvent={emitPlayback}
          />
          {!ytReady && <p className="video-note">Loading YouTube player...</p>}
          <p className="video-note">
            Volume boost above 100% isn't available for YouTube (Google doesn't expose raw
            audio to embedded players). Play/pause/seek stay in sync with everyone.
          </p>
        </div>
      )}

      {(backendKind === 'direct' || backendKind === 'drive') && (
        <NativeVideoBackend
          ref={backendRef}
          src={parsed.playableUrl}
          tolerance={tolerance}
          onBackendEvent={emitPlayback}
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
      )}

      {loadError && <p className="video-error">{loadError}</p>}
    </>
  );
}
