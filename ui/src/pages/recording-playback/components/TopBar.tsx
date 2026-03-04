import { createSignal, createMemo, onCleanup, Show, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ArrowLeftIcon, DownloadIcon, ShareIcon, InfoIcon } from "../../../components/Icons";
import { AuthBadge } from "../../../components/AuthBadge";
import { useEngine } from "../../../hooks/useEngine";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import { SIDE_COLORS_UI } from "../../../config/sideColors";
import type { Side, WorldConfig } from "../../../data/types";
import { basePath } from "../../../data/basePath";
import { ViewSettings } from "./ViewSettings";
import type { TimeMode } from "../../../playback/time";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  missionName: Accessor<string>;
  mapName: Accessor<string>;
  duration: Accessor<string>;
  recordingId: Accessor<string | null>;
  recordingFilename: Accessor<string | null>;
  worldConfig: Accessor<WorldConfig | undefined>;
  timeMode: Accessor<TimeMode>;
  onTimeMode: (mode: TimeMode) => void;
  onInfoClick?: () => void;
  onBack?: () => void;
}

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

const SIDE_LABEL: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
};

/**
 * TopBar for the redesigned playback page.
 *
 * Three-column layout:
 *   Left   - logo mark + mission info
 *   Center - per-side force indicators (alive / total)
 *   Right  - layer toggle, download, share, info buttons
 */
export function TopBar(props: TopBarProps): JSX.Element {
  const engine = useEngine();
  const customize = useCustomize();
  const { t } = useI18n();

  // ── Force stats (center) ──

  const forceStats = createMemo(() => {
    const snaps = engine.entitySnapshots();
    const stats: Array<{ side: Side; alive: number; total: number }> = [];
    for (const side of SIDES) {
      let alive = 0;
      let total = 0;
      for (const [, snap] of snaps) {
        if (snap.side === side) {
          total++;
          if (snap.alive) alive++;
        }
      }
      if (total > 0) stats.push({ side, alive, total });
    }
    return stats;
  });

  // ── Share ──

  const [showCopied, setShowCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const handleShare = () => {
    const id = props.recordingId();
    if (!id) return;
    const name = props.recordingFilename?.() ?? id;
    const url = new URL(window.location.origin);
    url.pathname = `/recording/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
    void navigator.clipboard.writeText(url.toString()).then(() => {
      clearTimeout(copiedTimer);
      setShowCopied(true);
      copiedTimer = setTimeout(() => setShowCopied(false), 2000);
    });
  };

  onCleanup(() => clearTimeout(copiedTimer));

  // ── Download ──

  const downloadHref = () => {
    const filename = props.recordingFilename?.() ?? props.recordingId();
    if (!filename) return "#";
    return `${basePath}data/${encodeURIComponent(filename)}.json.gz`;
  };

  return (
    <div class={styles.topBar}>
      {/* ── Left: back + logo + mission info ── */}
      <div class={styles.left}>
        <button class={styles.backBtn} title={t("back_to_recordings")} onClick={() => props.onBack?.()}>
          <ArrowLeftIcon size={16} />
        </button>
        <Show when={customize().websiteLogo}>
          {(logo) => {
            const img = (
              <img
                class={styles.customizeLogo}
                src={logo()}
                alt=""
                style={{ height: "28px" }}
              />
            );
            return (
              <Show when={customize().websiteURL} fallback={img}>
                {(url) => <a href={url()} target="_blank" rel="noopener noreferrer">{img}</a>}
              </Show>
            );
          }}
        </Show>
        <Show when={customize().headerTitle}>
          {(title) => (
            <div class={styles.branding}>
              <span class={styles.brandTitle}>{title()}</span>
              <Show when={customize().headerSubtitle}>
                {(sub) => <span class={styles.brandSubtitle}>{sub()}</span>}
              </Show>
            </div>
          )}
        </Show>
        <Show when={customize().websiteLogo || customize().headerTitle}>
          <div class={styles.divider} />
        </Show>
        <div class={styles.missionInfo}>
          <span class={styles.missionName}>{props.missionName()}</span>
          <span class={styles.missionSubtitle}>
            {props.mapName()} &middot; {props.duration()}
          </span>
        </div>
      </div>

      {/* ── Center: force indicators ── */}
      <div class={styles.center}>
        <For each={forceStats()}>
          {(stat) => (
            <div class={styles.forceIndicator} title={SIDE_LABEL[stat.side]}>
              <div
                class={styles.forceDot}
                style={{ background: SIDE_COLORS_UI[stat.side] }}
              />
              <span
                class={styles.forceAlive}
                style={{ color: SIDE_COLORS_UI[stat.side] }}
              >
                {stat.alive}
              </span>
              <span class={styles.forceTotal}>/{stat.total}</span>
            </div>
          )}
        </For>
      </div>

      {/* ── Right: actions ── */}
      <div class={styles.right}>
        {/* Auth badge */}
        <AuthBadge />

        <div class={styles.divider} />

        {/* View Settings (layers + time/name/marker modes) */}
        <ViewSettings
          timeMode={props.timeMode}
          onTimeMode={props.onTimeMode}
          worldConfig={props.worldConfig}
        />

        {/* Download */}
        <Show when={props.recordingId()}>
          <a
            class={styles.actionBtn}
            title={t("download")}
            href={downloadHref()}
            download=""
          >
            <DownloadIcon size={16} />
          </a>
        </Show>

        {/* Share */}
        <Show when={props.recordingId()}>
          <div style={{ position: "relative" }}>
            <button class={styles.actionBtn} title={t("share")} onClick={handleShare}>
              <ShareIcon size={16} />
            </button>
            <Show when={showCopied()}>
              <div class={styles.copiedToast}>{t("link_copied")}</div>
            </Show>
          </div>
        </Show>

        {/* Info */}
        <button
          class={styles.actionBtn}
          title={t("info")}
          onClick={() => props.onInfoClick?.()}
        >
          <InfoIcon size={16} />
        </button>
      </div>
    </div>
  );
}
