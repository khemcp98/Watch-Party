import { useEffect, useState, useRef } from 'react';

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// One control bar, shared by every video source. It only ever talks to the
// uniform adapter interface (play/pause/seekTo/getCurrentTime/getDuration),
// so it looks and behaves identically whether the video underneath is
// YouTube, Google Drive, or a direct file.
export default function PlayerControls({
  active,
  isPlaying,
  onTogglePlay,
  onSeek,
  volumeSlider, // { gain, setGain, gainPercent, muted, toggleMute, maxGain, available }
}) {
  const [displayTime, setDisplayTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      if (!scrubbing && active?.isReady?.()) {
        setDisplayTime(active.getCurrentTime());
        if (active.getDuration) setDuration(active.getDuration() || 0);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, scrubbing]);

  const shownTime = scrubbing ? scrubValue : displayTime;
  const progressPct = duration > 0 ? (shownTime / duration) * 100 : 0;

  return (
    <div className="player-controls">
      <button className="pc-play-btn" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? '❚❚' : '▶'}
      </button>

      <span className="pc-time">{formatTime(shownTime)}</span>

      <input
        type="range"
        className="pc-seek"
        min="0"
        max={duration || 0}
        step="0.1"
        value={shownTime}
        onChange={(e) => {
          setScrubbing(true);
          setScrubValue(parseFloat(e.target.value));
        }}
        onMouseUp={(e) => {
          setScrubbing(false);
          onSeek(parseFloat(e.target.value));
        }}
        onTouchEnd={(e) => {
          setScrubbing(false);
          onSeek(scrubValue);
        }}
        style={{ '--progress': `${progressPct}%` }}
      />

      <span className="pc-time">{formatTime(duration)}</span>

      {volumeSlider.available && (
        <div className="pc-volume">
          <button className="pc-mute-btn" onClick={volumeSlider.toggleMute}>
            {volumeSlider.muted ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            className="pc-volume-slider"
            min="0"
            max={volumeSlider.maxGain}
            step="0.05"
            value={volumeSlider.muted ? 0 : volumeSlider.gain}
            onChange={(e) => volumeSlider.setGain(parseFloat(e.target.value))}
            title={`Volume: ${volumeSlider.gainPercent}%`}
          />
          <span className="pc-volume-pct">{volumeSlider.muted ? '0%' : `${volumeSlider.gainPercent}%`}</span>
        </div>
      )}
    </div>
  );
}
