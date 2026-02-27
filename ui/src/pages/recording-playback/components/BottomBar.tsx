import { createSignal, Show } from "solid-js";
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
} from "../../../components/Icons";
import { TimelineScrubber } from "./TimelineScrubber";
import { SelectDropdown } from "../../../components/SelectDropdown";
import styles from "./BottomBar.module.css";

export interface BottomBarProps {
  panelOpen: Accessor<boolean>;
  onTogglePanel: () => void;
}

const SPEEDS = ["1", "2", "5", "10", "20", "30", "60"];

type NameMode = "all" | "players" | "none";
const NAME_MODES: NameMode[] = ["all", "players", "none"];
const NAME_MODE_KEYS: Record<NameMode, string> = {
  all: "names_all",
  players: "names_players",
  none: "names_none",
};

type MarkerMode = "all" | "noLabels" | "none";
const MARKER_MODES: MarkerMode[] = ["all", "noLabels", "none"];
const MARKER_MODE_KEYS: Record<MarkerMode, string> = {
  all: "markers_all",
  noLabels: "markers_no_labels",
  none: "markers_none",
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

  // ── Names / Markers state ──
  const [nameMode, setNameMode] = createSignal<NameMode>("all");
  const [markerMode, setMarkerMode] = createSignal<MarkerMode>("all");

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

        {/* Right: Speed, time mode, names, markers */}
        <div class={styles.controlsRight}>
          <SelectDropdown
            value={() => String(engine.playbackSpeed())}
            options={SPEEDS}
            getLabel={(s) => `${s}x`}
            onSelect={(s) => engine.setSpeed(Number(s))}
          />

          <SelectDropdown<TimeMode>
            value={timeMode}
            options={TIME_MODES}
            getLabel={(m) => t(TIME_MODE_KEYS[m])}
            onSelect={setTimeMode}
            isDisabled={(m) => !isTimeModeAvailable(m)}
            wide
          />

          <SelectDropdown<NameMode>
            value={nameMode}
            options={NAME_MODES}
            getLabel={(m) => t(NAME_MODE_KEYS[m])}
            onSelect={(m) => {
              setNameMode(m);
              renderer.setNameDisplayMode(m);
            }}
            wide
          />

          <SelectDropdown<MarkerMode>
            value={markerMode}
            options={MARKER_MODES}
            getLabel={(m) => t(MARKER_MODE_KEYS[m])}
            onSelect={(m) => {
              setMarkerMode(m);
              renderer.setMarkerDisplayMode(m);
            }}
            wide
          />
        </div>
      </div>
    </div>
  );
}
