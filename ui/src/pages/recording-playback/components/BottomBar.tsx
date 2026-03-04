import { For, Show } from "solid-js";
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
  ScissorsIcon,
} from "../../../components/Icons";
import {
  stepBack,
  stepForward,
  seekToPrevKill,
  seekToNextKill,
} from "../shortcuts";
import { TimelineScrubber } from "./TimelineScrubber";
import type { FocusRange } from "./FocusToolbar";
import { FocusToolbar } from "./FocusToolbar";
import styles from "./BottomBar.module.css";

export interface BottomBarProps {
  panelOpen: Accessor<boolean>;
  onTogglePanel: () => void;
  timeMode: Accessor<TimeMode>;
  // Focus range
  focusRange: Accessor<FocusRange | null>;
  editingFocus: Accessor<boolean>;
  focusDraft: Accessor<FocusRange | null>;
  onDraftChange: (draft: FocusRange) => void;
  showFullTimeline: Accessor<boolean>;
  onToggleFullTimeline: () => void;
  constrainToFocus: Accessor<boolean>;
  isAdmin: Accessor<boolean>;
  onStartFocusEdit: () => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onClearFocus: () => void;
  onCancelFocus: () => void;
  onSaveFocus: () => void;
}

const SPEEDS = [1, 2, 5, 10, 20, 60];

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
        <TimelineScrubber
          focusRange={props.showFullTimeline() ? (() => null) : props.focusRange}
          editingFocus={props.editingFocus}
          focusDraft={props.focusDraft}
          onDraftChange={props.onDraftChange}
          constrainToFocus={props.constrainToFocus}
        />
      </div>

      {/* Focus Toolbar (edit mode) */}
      <Show when={props.editingFocus()}>
        <FocusToolbar
          draft={props.focusDraft}
          onSetIn={props.onSetIn}
          onSetOut={props.onSetOut}
          onClear={props.onClearFocus}
          onCancel={props.onCancelFocus}
          onSave={props.onSaveFocus}
        />
      </Show>

      {/* Row 2: Controls */}
      <div class={styles.controlsRow}>
        {/* Left: Time display */}
        <div class={styles.controlsLeft}>
          <span class={styles.timeDisplay}>
            {currentTime()}
            <span class={styles.timeSeparator}>/</span>
            <span class={styles.timeDimmed}>{totalTime()}</span>
          </span>

          <Show when={props.focusRange() && !props.editingFocus()}>
            <button
              class={styles.focusToggle}
              onClick={props.onToggleFullTimeline}
              title={props.showFullTimeline() ? "Show focused range" : "Show full recording"}
            >
              {props.showFullTimeline() ? "FULL" : "FOCUS"}
            </button>
          </Show>
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

        {/* Right: Speed strip + Focus button */}
        <div class={styles.controlsRight}>
          <div class={styles.speedStrip}>
            <For each={SPEEDS}>
              {(s) => (
                <button
                  class={styles.speedBtn}
                  classList={{ [styles.speedBtnActive]: engine.playbackSpeed() === s }}
                  onClick={() => engine.setSpeed(s)}
                >
                  {s}&times;
                </button>
              )}
            </For>
          </div>

          <Show when={props.isAdmin() && !props.editingFocus()}>
            <button
              class={styles.focusBtn}
              classList={{ [styles.focusBtnActive]: !!props.focusRange() }}
              onClick={props.onStartFocusEdit}
              title="Edit focus range"
            >
              <ScissorsIcon size={12} /> Focus
            </button>
          </Show>

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
        </div>
      </div>
    </div>
  );
}
