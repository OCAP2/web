import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { useRenderer } from "../../../hooks/useRenderer";
import { useI18n } from "../../../hooks/useLocale";
import { formatTime } from "../../../playback/time";
import type { TimeMode } from "../../../playback/time";
import {
  MapIcon,
  SkipBackIcon,
  PlayIcon,
  PauseIcon,
  SkipForwardIcon,
  ChevronDownIcon,
} from "./Icons";
import { TimelineScrubber } from "./TimelineScrubber";
import { SpeedSelector } from "./SpeedSelector";
import styles from "./BottomBar.module.css";

export interface BottomBarProps {
  panelOpen: Accessor<boolean>;
  onTogglePanel: () => void;
}

type NameMode = "all" | "players" | "none";
const NAME_MODES: NameMode[] = ["all", "players", "none"];
const NAME_MODE_KEYS: Record<NameMode, string> = {
  all: "names_all",
  players: "names_players",
  none: "names_none",
};

const TIME_MODES: TimeMode[] = ["elapsed", "mission", "system"];
const TIME_MODE_KEYS: Record<TimeMode, string> = {
  elapsed: "time_elapsed",
  mission: "time_mission",
  system: "time_system",
};

export function BottomBar(props: BottomBarProps): JSX.Element {
  const engine = useEngine();
  const renderer = useRenderer();
  const { t } = useI18n();

  // ── Time display ──
  const [timeMode, setTimeMode] = createSignal<TimeMode>("elapsed");

  const currentTime = () =>
    formatTime(engine.currentFrame(), timeMode(), engine.timeConfig);

  const totalTime = () =>
    formatTime(engine.endFrame(), timeMode(), engine.timeConfig);

  const isTimeModeAvailable = (mode: TimeMode): boolean => {
    if (mode === "elapsed") return true;
    if (mode === "system") {
      const times = engine.timeConfig.times;
      return !!times && times.length > 0;
    }
    if (mode === "mission") {
      return !!engine.timeConfig.missionDate;
    }
    return false;
  };

  // ── Time mode dropdown ──
  const [timeModeOpen, setTimeModeOpen] = createSignal(false);
  let timeModeRef: HTMLDivElement | undefined;

  // ── Names dropdown ──
  const [namesOpen, setNamesOpen] = createSignal(false);
  const [nameMode, setNameMode] = createSignal<NameMode>("all");
  let namesRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (timeModeRef && !timeModeRef.contains(e.target as Node)) {
      setTimeModeOpen(false);
    }
    if (namesRef && !namesRef.contains(e.target as Node)) {
      setNamesOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener("pointerdown", handleClickOutside);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", handleClickOutside);
  });

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
            {t("panel")}
            <kbd>E</kbd>
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

          <div ref={timeModeRef} style={{ position: "relative" }}>
            <button
              class={`${styles.speedBtn} ${styles.dropdownWide}`}
              onClick={() => setTimeModeOpen((v) => !v)}
            >
              {t(TIME_MODE_KEYS[timeMode()])}
              <ChevronDownIcon />
            </button>
            <Show when={timeModeOpen()}>
              <div class={`${styles.speedPopup} ${styles.dropdownPopupWide}`}>
                <For each={TIME_MODES}>
                  {(mode) => {
                    const available = () => isTimeModeAvailable(mode);
                    return (
                      <button
                        class={styles.speedOption}
                        classList={{
                          [styles.speedOptionActive]: timeMode() === mode,
                          [styles.speedOptionDisabled]: !available(),
                        }}
                        disabled={!available()}
                        onClick={() => {
                          setTimeMode(mode);
                          setTimeModeOpen(false);
                        }}
                      >
                        {t(TIME_MODE_KEYS[mode])}
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>

          <div ref={namesRef} style={{ position: "relative" }}>
            <button
              class={`${styles.speedBtn} ${styles.dropdownWide}`}
              onClick={() => setNamesOpen((v) => !v)}
            >
              {t(NAME_MODE_KEYS[nameMode()])}
              <ChevronDownIcon />
            </button>
            <Show when={namesOpen()}>
              <div class={`${styles.speedPopup} ${styles.dropdownPopupWide}`}>
                <For each={NAME_MODES}>
                  {(mode) => (
                    <button
                      class={styles.speedOption}
                      classList={{
                        [styles.speedOptionActive]: nameMode() === mode,
                      }}
                      onClick={() => {
                        setNameMode(mode);
                        renderer.setNameDisplayMode(mode);
                        setNamesOpen(false);
                      }}
                    >
                      {t(NAME_MODE_KEYS[mode])}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
