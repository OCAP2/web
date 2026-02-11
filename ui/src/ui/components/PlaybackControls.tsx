import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { formatElapsedTime } from "../../playback/time";
import styles from "./BottomPanel.module.css";

/**
 * Play/pause button and timecode display.
 *
 * Left side of the controls row: play button + current/total time.
 */
export function PlaybackControls(): JSX.Element {
  const engine = useEngine();

  return (
    <div data-testid="playback-controls" class={styles.playbackControls}>
      <div
        data-testid="play-pause-button"
        class={`${styles.playPauseBtn} ${engine.isPlaying() ? styles.playing : ""}`}
        data-playing={engine.isPlaying()}
        onClick={() => engine.togglePlayPause()}
      >
        {engine.isPlaying() ? "⏸" : "▶"}
      </div>
      <div data-testid="timecode-container" class={styles.timecodeContainer}>
        <span data-testid="timeline-current-time" class={styles.timecode}>
          {formatElapsedTime(engine.currentFrame(), engine.captureDelayMs())}
        </span>
        <span class={styles.timecodeSeparator}> / </span>
        <span data-testid="timeline-end-time" class={styles.timecode}>
          {formatElapsedTime(engine.endFrame(), engine.captureDelayMs())}
        </span>
      </div>
    </div>
  );
}
