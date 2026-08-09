import { useRef, useCallback } from 'react';

// Wraps a native <video> element ref behind the uniform player interface
// { play, pause, seekTo, getCurrentTime, getDuration, isReady } that
// UnifiedPlayer/PlayerControls expect, regardless of whether the underlying
// source is a direct file or Drive link.
export function useHtml5Adapter() {
  const videoRef = useRef(null);

  const play = useCallback(() => videoRef.current?.play().catch(() => {}), []);
  const pause = useCallback(() => videoRef.current?.pause(), []);
  const seekTo = useCallback((time) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  }, []);
  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);
  const getDuration = useCallback(() => videoRef.current?.duration ?? 0, []);
  const isReady = useCallback(() => !!videoRef.current && videoRef.current.readyState >= 1, []);

  return { videoRef, play, pause, seekTo, getCurrentTime, getDuration, isReady };
}
