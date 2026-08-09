import { useEffect, useRef, useState } from 'react';

// Native <video>/<audio> volume caps at 1.0 (100%). To go louder we route
// the element's audio through a Web Audio GainNode and amplify there.
// gain of 1.0 = 100% (normal), up to maxGain (e.g. 3.0 = 300%).
export function useVolumeBoost(mediaRef, { maxGain = 3 } = {}) {
  const [gain, setGain] = useState(1); // 1 = 100%
  const [muted, setMuted] = useState(false);
  const ctxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceRef = useRef(null);

  // Lazily set up the audio graph once the media element exists and the
  // user has interacted with the page (required for AudioContext).
  const ensureGraph = () => {
    const el = mediaRef.current;
    if (!el || sourceRef.current) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(el);
      const gainNode = ctx.createGain();
      gainNode.gain.value = gain;

      source.connect(gainNode).connect(ctx.destination);

      ctxRef.current = ctx;
      gainNodeRef.current = gainNode;
      sourceRef.current = source;
    } catch (err) {
      // createMediaElementSource can only be called once per element;
      // if a boosted graph already exists this will throw harmlessly.
      console.warn('Volume boost graph setup skipped:', err.message);
    }
  };

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = muted ? 0 : gain;
    }
  }, [gain, muted]);

  useEffect(() => {
    return () => {
      if (ctxRef.current) ctxRef.current.close().catch(() => {});
    };
  }, []);

  return {
    gain, // 1 = 100%, 2 = 200%, 3 = 300%...
    setGain: (v) => setGain(Math.max(0, Math.min(maxGain, v))),
    gainPercent: Math.round(gain * 100),
    maxGain,
    muted,
    toggleMute: () => setMuted((m) => !m),
    ensureGraph, // call this on first user play/click to init AudioContext
  };
}
