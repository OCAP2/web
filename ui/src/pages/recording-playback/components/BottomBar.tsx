import { Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { formatTime } from "../../../playback/time";
import type { TimeMode } from "../../../playback/time";
import {
  MapIcon,
  PlayIcon,
  PauseIcon,
  StepBackIcon,
  StepForwardIcon,
  SkipToKillBackIcon,
  SkipToKillIcon,
} from "../../../components/Icons";
import {
  stepBack,
  stepForward,
  seekToPrevKill,
  seekToNextKill,
} from "../shortcuts";
import { TimelineScrubber } from "./TimelineScrubber";
import { SelectDropdown } from "../../../components/SelectDropdown";
import styles from "./BottomBar.module.css";

export interface BottomBarProps {
  panelOpen: Accessor<boolean>;
  onTogglePanel: () => void;
  timeMode: Accessor<TimeMode>;
}

const SPEEDS = ["1", "2", "5", "10", "20", "30", "60"];

export function BottomBar(props: BottomBarProps): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();

  const currentTime = () =>
    formatTime(engine.currentFrame(), props.timeMode(), engine.timeConfig);

  const totalTime = () =>
    formatTime(engine.endFrame(), props.timeMode(), engine.timeConfig);

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
            onClick={() => props.onTogglePanel()}
          >
            <MapIcon size={12} />
            {t("panel")}
            <kbd>E</kbd>
          </button>

          <span class={styles.timeDisplay}>
            {currentTime()}
            <span class={styles.timeSeparator}>/</span>
            <span class={styles.timeDimmed}>{totalTime()}</span>
          </span>
        </div>

        {/* Center: Transport controls */}
        <div class={styles.controlsCenter}>
          <button
            class={styles.skipBtn}
            title={t("prev_kill") + "  [ , ]"}
            onClick={() => seekToPrevKill(engine)}
          >
            <SkipToKillBackIcon size={16} />
          </button>

          <button
            class={styles.skipBtn}
            title={t("step_back") + "  [ \u2190 ]"}
            onClick={() => stepBack(engine)}
          >
            <StepBackIcon size={16} />
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
            title={t("step_forward") + "  [ \u2192 ]"}
            onClick={() => stepForward(engine)}
          >
            <StepForwardIcon size={16} />
          </button>

          <button
            class={styles.skipBtn}
            title={t("next_kill") + "  [ . ]"}
            onClick={() => seekToNextKill(engine)}
          >
            <SkipToKillIcon size={16} />
          </button>
        </div>

        {/* Right: Speed */}
        <div class={styles.controlsRight}>
          <SelectDropdown
            value={() => String(engine.playbackSpeed())}
            options={SPEEDS}
            getLabel={(s) => `${s}x`}
            onSelect={(s) => engine.setSpeed(Number(s))}
          />
        </div>
      </div>
    </div>
  );
}
