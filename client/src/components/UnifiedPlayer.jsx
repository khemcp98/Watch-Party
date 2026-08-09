import { useEffect, useRef, useState, useCallback } from 'react';
import { parseVideoUrl } from '../lib/videoUrl';
import { useVolumeBoost } from '../lib/useVolumeBoost';
import { useHtml5Adapter } from '../lib/html5Adapter';
import { useYouTubeAdapter } from '../lib/youtubeAdapter';
import { socket } from '../lib/socket';
import PlayerControls from './PlayerControls';

const SYNC_TOLERANCE = 1; // seconds of drift allowed before force-resync
const RESYNC_INTERVAL = 5000;

export default function UnifiedPlayer({ roomId, videoUrl, videoType, initialTime, initialPlaying }) {
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const suppressEmit = useRef(false);

  const parsed = videoUrl ? parseVideoUrl(videoUrl) : null;
  const source = parsed?.type; // 'youtube' | 'drive' | 'direct'
  const usingIframeFallback = source !== 'youtube' && useIframeFallback && parsed?.type === 'drive';

  // --- Adapters: exactly one is "active" depending on source ---
  const html5 = useHtml5Adapter();

  const handleYouTubeLocalChange = useCallback(
    (type, currentTime) => {
      setIsPlaying(type === 'play');
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

  // Pick the active adapter's uniform interface. The control bar and sync
  // engine only ever talk to `active` — never to a source-specific API.
  const active = source === 'youtube' ? youtube : html5;

  // Volume boost only applies to the html5 <video> path (YouTube/Drive-iframe
  // don't expose raw audio to embedders) — the control bar still renders a
  // volume icon for every source, just non-boosted for YouTube.
  const {
    gain,
    setGain,
    gainPercent,
    muted,
    toggleMute,
    ensureGraph,
    maxGain,
  } = useVolumeBoost(html5.videoRef, { maxGain: 4 });

  // For YouTube we can't boost past 100%, but we still want a working
  // volume control in the same slot in the control bar — map it to
  // YouTube's own 0-100 volume API instead of the Web Audio gain node.
  const setYoutubeVolume = useCallback(
    (v) => {
      // v arrives as a 0..maxGain float from the shared slider; clamp to
      // YouTube's 0-100 range (values above 1x gain have no effect here).
      const pct = Math.min(1, v) * 100;
      youtube.setVolume?.(pct);
    },
    [youtube]
  );

  // Apply initial state once the active player is ready (e.g. joining mid-playback)
  useEffect(() => {
    if (!videoUrl) return;
    let attempts = 0;
    const tryApply = () => {
      if (active.isReady()) {
        suppressEmit.current = true;
        if (initialTime) active.seekTo(initialTime);
        if (initialPlaying) {
          active.play();
          setIsPlaying(true);
        }
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

      if (type === 'play') {
        active.play();
        setIsPlaying(true);
      }
      if (type === 'pause') {
        active.pause();
        setIsPlaying(false);
      }
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

  // html5 <video> native events still fire (element is in the DOM, just
  // stripped of its native chrome) — used to catch play/pause/seek from
  // keyboard shortcuts or programmatic changes, in addition to our buttons.
  const emitHtml5Playback = useCallback(
    (type) => {
      if (suppressEmit.current) return;
      const currentTime = html5.getCurrentTime();
      console.log(`[client] emitting playback-event: ${type} @ ${currentTime?.toFixed?.(1)}s`);
      socket.emit('playback-event', { roomId, type, currentTime });
    },
    [roomId, html5]
  );

  const handleTogglePlay = () => {
    if (isPlaying) {
      active.pause();
      setIsPlaying(false);
      if (source !== 'youtube') emitHtml5Playback('pause');
      else handleYouTubeLocalChange('pause', active.getCurrentTime());
    } else {
      active.play();
      setIsPlaying(true);
      if (source !== 'youtube') emitHtml5Playback('play');
      else handleYouTubeLocalChange('play', active.getCurrentTime());
    }
  };

  const handleSeek = (time) => {
    active.seekTo(time);
    if (source !== 'youtube') {
      emitHtml5Playback('seek');
    } else {
      socket.emit('playback-event', { roomId, type: 'seek', currentTime: time });
    }
  };

  const handleFirstInteraction = () => ensureGraph();

  if (!videoUrl) {
    return (
      <div className="video-empty">
        <p>No video loaded yet. Paste a YouTube link, Google Drive link, or a direct video URL below.</p>
      </div>
    );
  }

  return (
    <div className="player-shell" onClickCapture={handleFirstInteraction}>
      <div className="video-wrap">
        {source === 'youtube' && (
          <div ref={youtube.containerRef} className="youtube-iframe-target" />
        )}

        {usingIframeFallback && (
          <iframe
            src={parsed.previewUrl}
            allow="autoplay"
            allowFullScreen
            className="video-iframe"
            title="Video"
          />
        )}

        {source !== 'youtube' && !usingIframeFallback && (
          <video
            ref={html5.videoRef}
            src={parsed.playableUrl}
            crossOrigin="anonymous"
            className="video-el"
            onPlay={() => {
              setIsPlaying(true);
              emitHtml5Playback('play');
            }}
            onPause={() => {
              setIsPlaying(false);
              emitHtml5Playback('pause');
            }}
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
        )}
      </div>

      {!usingIframeFallback && (
        <PlayerControls
          active={active}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          volumeSlider={{
            gain: source === 'youtube' ? 1 : gain,
            setGain: source === 'youtube' ? setYoutubeVolume : setGain,
            gainPercent: source === 'youtube' ? 100 : gainPercent,
            muted,
            toggleMute,
            maxGain: source === 'youtube' ? 1 : maxGain,
            available: true,
          }}
        />
      )}

      {loadError && <p className="video-error">{loadError}</p>}
      {usingIframeFallback && (
        <p className="video-note">
          Playing via Google Drive preview (direct playback wasn't available for this file —
          make sure it's shared as "Anyone with the link can view"). Sync and volume boost
          aren't available in this fallback mode; use Drive's own controls.
        </p>
      )}
    </div>
  );
}

