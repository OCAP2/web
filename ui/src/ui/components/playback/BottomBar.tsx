import { Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { useEngine } from "../../hooks/useEngine";
import { useRenderer } from "../../hooks/useRenderer";
import { formatElapsedTime } from "../../../playback/time";
import {
  MapIcon,
  SkipBackIcon,
  PlayIcon,
  PauseIcon,
  SkipForwardIcon,
} from "./Icons";
import { TimelineScrubber } from "./TimelineScrubber";
import { SpeedSelector } from "./SpeedSelector";
import styles from "./BottomBar.module.css";

export interface BottomBarProps {
  panelOpen: Accessor<boolean>;
  onTogglePanel: () => void;
}

export function BottomBar(props: BottomBarProps): JSX.Element {
  const engine = useEngine();
  const renderer = useRenderer();

  const currentTime = () =>
    formatElapsedTime(engine.currentFrame(), engine.captureDelayMs());

  const totalTime = () =>
    formatElapsedTime(engine.endFrame(), engine.captureDelayMs());

  return (
    <div class={styles.bottomBar}>
      {/* Row 1: Timeline */}
      <div class={styles.timelineRow}>
        <TimelineScrubber />
      </div>

      {/* Row 2: Controls */}
      <div class={styles.controlsRow}>
        {/* Left: Panel toggle + time display */}
        <div class={styles.controlsLeft}>
          <button
            class={styles.panelToggle}
            classList={{
              [styles.panelToggleActive]: props.panelOpen(),
            }}
            onClick={props.onTogglePanel}
          >
            <MapIcon size={12} />
            Panel
          </button>

          <span class={styles.timeDisplay}>
            {currentTime()}
            <span class={styles.timeSeparator}>/</span>
            <span class={styles.timeDimmed}>{totalTime()}</span>
          </span>
        </div>

        {/* Center: Playback controls */}
        <div class={styles.controlsCenter}>
          <button
            class={styles.skipBtn}
            onClick={() => engine.seekTo(0)}
          >
            <SkipBackIcon size={16} />
          </button>

          <button
            class={styles.playBtn}
            classList={{
              [styles.playBtnPlay]: !engine.isPlaying(),
              [styles.playBtnPause]: engine.isPlaying(),
            }}
            onClick={() => engine.togglePlayPause()}
          >
            <Show when={engine.isPlaying()} fallback={<PlayIcon size={18} />}>
              <PauseIcon size={18} />
            </Show>
          </button>

          <button
            class={styles.skipBtn}
            onClick={() => engine.seekTo(engine.endFrame())}
          >
            <SkipForwardIcon size={16} />
          </button>
        </div>

        {/* Right: Speed, time mode, names */}
        <div class={styles.controlsRight}>
          <SpeedSelector />

          <select class={styles.styledSelect} disabled>
            <option value="elapsed">Elapsed</option>
            <option value="mission">Mission</option>
            <option value="system">System</option>
          </select>

          <select
            class={styles.styledSelect}
            onChange={(e) => {
              const mode = e.currentTarget.value as
                | "all"
                | "players"
                | "none";
              renderer.setNameDisplayMode(mode);
            }}
          >
            <option value="all">All Units</option>
            <option value="players">Players Only</option>
            <option value="none">No Names</option>
          </select>
        </div>
      </div>
    </div>
  );
}
