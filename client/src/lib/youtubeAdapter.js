import { useRef, useState, useEffect, useCallback } from 'react';
import { loadYouTubeApi } from './youtubeApi';

// Wraps the YouTube IFrame Player behind the same uniform interface as the
// html5 adapter: { play, pause, seekTo, getCurrentTime, isReady }.
// onLocalStateChange(type) fires when the user (not a remote sync event)
// actually presses play/pause inside the YouTube player itself.
export function useYouTubeAdapter({ videoId, onLocalStateChange, suppressRef }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);

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
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onStateChange: (event) => {
            if (suppressRef.current) return;
            const player = playerRef.current;
            if (!player) return;
            if (event.data === 1) onLocalStateChange('play', player.getCurrentTime());
            if (event.data === 2) onLocalStateChange('pause', player.getCurrentTime());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const play = useCallback(() => playerRef.current?.playVideo?.(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo?.(), []);
  const seekTo = useCallback((time) => playerRef.current?.seekTo?.(time, true), []);
  const getCurrentTime = useCallback(() => playerRef.current?.getCurrentTime?.() ?? 0, []);
  const isReady = useCallback(() => ready && typeof playerRef.current?.getCurrentTime === 'function', [ready]);

  return { containerRef, play, pause, seekTo, getCurrentTime, isReady, ready };
}
