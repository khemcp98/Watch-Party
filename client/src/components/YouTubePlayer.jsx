import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi } from '../lib/youtubeApi';
import { socket } from '../lib/socket';

const SYNC_TOLERANCE = 1.5; // seconds — YouTube's seek events are less exact than <video>
const RESYNC_INTERVAL = 5000;

// YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued

export default function YouTubePlayer({ roomId, videoId, initialTime, initialPlaying }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const suppressEmit = useRef(false);
  const lastEmittedType = useRef(null);

  // Create the player once per videoId
  useEffect(() => {
    let cancelled = false;
    setReady(false);

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;

      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            suppressEmit.current = true;
            if (initialTime) playerRef.current.seekTo(initialTime, true);
            if (initialPlaying) playerRef.current.playVideo();
            setTimeout(() => (suppressEmit.current = false), 300);
            setReady(true);
          },
          onStateChange: (event) => {
            if (suppressEmit.current) return;
            const player = playerRef.current;
            if (!player) return;

            if (event.data === 1) {
              // playing
              if (lastEmittedType.current !== 'play') {
                socket.emit('playback-event', {
                  roomId,
                  type: 'play',
                  currentTime: player.getCurrentTime(),
                });
                lastEmittedType.current = 'play';
              }
            } else if (event.data === 2) {
              // paused
              socket.emit('playback-event', {
                roomId,
                type: 'pause',
                currentTime: player.getCurrentTime(),
              });
              lastEmittedType.current = 'pause';
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

  // Listen for remote playback + room-state events
  useEffect(() => {
    const applyRemote = (type, currentTime) => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;

      suppressEmit.current = true;
      const drift = Math.abs(player.getCurrentTime() - currentTime);
      if (drift > SYNC_TOLERANCE) {
        player.seekTo(currentTime, true);
      }
      if (type === 'play') player.playVideo();
      if (type === 'pause') player.pauseVideo();
      if (type === 'seek') player.seekTo(currentTime, true);

      setTimeout(() => (suppressEmit.current = false), 400);
    };

    const handlePlaybackEvent = ({ type, currentTime }) => {
      console.log(`[client] YouTube received playback-event: ${type} @ ${currentTime?.toFixed?.(1)}s`);
      applyRemote(type, currentTime);
    };

    const handleRoomState = (state) => {
      if (state.videoType !== 'youtube') return;
      applyRemote(state.playing ? 'play' : 'pause', state.currentTime);
    };

    socket.on('playback-event', handlePlaybackEvent);
    socket.on('room-state', handleRoomState);
    return () => {
      socket.off('playback-event', handlePlaybackEvent);
      socket.off('room-state', handleRoomState);
    };
  }, []);

  // Periodic resync request
  useEffect(() => {
    const interval = setInterval(() => {
      socket.emit('request-sync', { roomId });
    }, RESYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [roomId]);

  return (
    <div className="video-wrap youtube-wrap">
      <div ref={containerRef} className="youtube-iframe-target" />
      {!ready && <p className="video-note">Loading YouTube player...</p>}
      <p className="video-note">
        YouTube playback goes through YouTube's own player — volume boost above 100% isn't
        available for YouTube videos (Google doesn't expose raw audio to embedded players).
        Play/pause/seek stay in sync with everyone in the room.
      </p>
    </div>
  );
}
