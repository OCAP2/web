import { createSignal, createMemo, onCleanup, Show, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ArrowLeftIcon, LayersIcon, DownloadIcon, ShareIcon, InfoIcon } from "./Icons";
import { useEngine } from "../../../hooks/useEngine";
import { useRenderer } from "../../../hooks/useRenderer";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import { SIDE_COLORS_UI } from "../../../config/sideColors";
import type { Side, WorldConfig } from "../../../data/types";
import type { RenderLayer } from "../../../renderers/renderer.types";
import { useClickOutside } from "../../../hooks/useClickOutside";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  missionName: Accessor<string>;
  mapName: Accessor<string>;
  duration: Accessor<string>;
  operationId: Accessor<string | null>;
  operationFilename: Accessor<string | null>;
  worldConfig: Accessor<WorldConfig | undefined>;
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
  const renderer = useRenderer();
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

  // ── Layer control ──

  const [layersOpen, setLayersOpen] = createSignal(false);
  const [layers, setLayers] = createSignal<Record<string, boolean>>({
    entities: true,
    systemMarkers: true,
    briefingMarkers: true,
    projectileMarkers: true,
    grid: false,
    mapIcons: true,
    buildings3D: true,
  });

  let layerRef: HTMLDivElement | undefined;
  useClickOutside(() => layerRef, setLayersOpen);

  const toggleLayer = (key: string) => {
    const current = layers();
    const newValue = !current[key];
    setLayers({ ...current, [key]: newValue });
    renderer.setLayerVisible(key as RenderLayer, newValue);
  };

  const isMapLibre = () => !!props.worldConfig()?.maplibre;

  const layerItems = createMemo(() => {
    const items: Array<{ key: string; label: string }> = [
      { key: "entities", label: t("layer_entities") },
      { key: "systemMarkers", label: t("layer_side_markers") },
      { key: "briefingMarkers", label: t("layer_briefing_markers") },
      { key: "projectileMarkers", label: t("layer_projectiles") },
      { key: "grid", label: t("grid") },
    ];
    if (isMapLibre()) {
      items.push({ key: "mapIcons", label: t("layer_map_icons") });
      items.push({ key: "buildings3D", label: t("layer_buildings_3d") });
    }
    return items;
  });

  // ── Share ──

  const [showCopied, setShowCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const handleShare = () => {
    const id = props.operationId();
    if (!id) return;
    const name = props.operationFilename?.() ?? id;
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
    const filename = props.operationFilename?.() ?? props.operationId();
    if (!filename) return "#";
    return `${import.meta.env.BASE_URL}data/${encodeURIComponent(filename)}.json.gz`;
  };

  return (
    <div class={styles.topBar}>
      {/* ── Left: back + logo + mission info ── */}
      <div class={styles.left}>
        <button class={styles.backBtn} title={t("back_to_missions")} onClick={() => props.onBack?.()}>
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
        {/* Layer toggle */}
        <div ref={layerRef} style={{ position: "relative" }}>
          <button
            class={styles.layerBtn}
            title={t("layers")}
            onClick={() => setLayersOpen((v) => !v)}
          >
            <LayersIcon size={16} />
          </button>
          <Show when={layersOpen()}>
            <div class={styles.layerDropdown}>
              <div class={styles.layerLabel}>{t("layers")}</div>
              <For each={layerItems()}>
                {(item) => {
                  const active = () => !!layers()[item.key];
                  return (
                    <button
                      class={styles.layerItem}
                      onClick={() => toggleLayer(item.key)}
                    >
                      <div
                        class={`${styles.layerCheckbox} ${
                          active()
                            ? styles.layerCheckboxActive
                            : styles.layerCheckboxInactive
                        }`}
                      >
                        <Show when={active()}>
                          <div class={styles.layerCheckboxDot} />
                        </Show>
                      </div>
                      <span
                        class={`${styles.layerItemText} ${
                          active()
                            ? styles.layerItemTextActive
                            : styles.layerItemTextInactive
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>

        {/* Download */}
        <Show when={props.operationId()}>
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
        <Show when={props.operationId()}>
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
