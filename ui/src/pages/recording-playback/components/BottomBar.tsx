import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { useRenderer } from "../../../hooks/useRenderer";
import { useI18n } from "../../../hooks/useLocale";
import { formatElapsedTime } from "../../../playback/time";
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

export function BottomBar(props: BottomBarProps): JSX.Element {
  const engine = useEngine();
  const renderer = useRenderer();
  const { t } = useI18n();

  const currentTime = () =>
    formatElapsedTime(engine.currentFrame(), engine.captureDelayMs());

  const totalTime = () =>
    formatElapsedTime(engine.endFrame(), engine.captureDelayMs());

  // ── Names dropdown ──
  const [namesOpen, setNamesOpen] = createSignal(false);
  const [nameMode, setNameMode] = createSignal<NameMode>("all");
  let namesRef: HTMLDivElement | undefined;

  const handleNamesClickOutside = (e: MouseEvent) => {
    if (namesRef && !namesRef.contains(e.target as Node)) {
      setNamesOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener("pointerdown", handleNamesClickOutside);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", handleNamesClickOutside);
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

          <button class={`${styles.speedBtn} ${styles.dropdownWide}`} disabled style={{ opacity: 0.5 }}>
            {t("elapsed")}
            <ChevronDownIcon />
          </button>

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
