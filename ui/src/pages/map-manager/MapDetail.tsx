import type { JSX } from "solid-js";
import { Show, For } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS, OUTPUT_FILES, STYLE_VARIANTS } from "./constants";
import { mapHue, formatWorldSize, statusLabel } from "./helpers";
import {
  XIcon,
  TrashIcon,
  CheckIcon,
} from "../../components/Icons";
import styles from "./MapDetail.module.css";

export function MapDetail(props: {
  map: MapInfo;
  baseUrl: string;
  onClose: () => void;
  onDelete: () => void;
}): JSX.Element {
  const hue = () => mapHue(props.map.name);

  return (
    <div class={styles.sidebar}>
      {/* Hero */}
      <div
        class={styles.hero}
        style={{
          background: `linear-gradient(135deg, hsl(${hue()}, 18%, 9%), hsl(${(hue() + 40) % 360}, 13%, 6%))`,
        }}
      >
        <Show when={props.map.hasPreview}>
          <img
            src={`${props.baseUrl}/images/maps/${props.map.name}/preview_256.png`}
            alt={props.map.name}
            class={styles.heroImg}
          />
          <div class={styles.heroOverlay} />
        </Show>
        <div class={styles.heroText}>
          <h2 class={styles.heroTitle}>{props.map.name}</h2>
          <Show when={props.map.worldSize}>
            <div class={styles.heroSubtitle}>
              {formatWorldSize(props.map.worldSize!)}
            </div>
          </Show>
        </div>
        <button class={styles.heroClose} onClick={() => props.onClose()}>
          <XIcon size={14} />
        </button>
      </div>

      {/* Info */}
      <div class={styles.content}>
        <div class={styles.infoGrid}>
          <div class={styles.infoItem}>
            <div class={styles.infoLabel}>STATUS</div>
            <div
              class={styles.infoValue}
              style={{ color: MAP_STATUS_COLORS[props.map.status] }}
            >
              {statusLabel(props.map.status)}
            </div>
          </div>
          <Show when={props.map.worldSize}>
            <div class={styles.infoItem}>
              <div class={styles.infoLabel}>WORLD SIZE</div>
              <div class={styles.infoValue} style={{ color: "var(--text-muted)" }}>
                {props.map.worldSize!.toLocaleString()} m
              </div>
            </div>
          </Show>
          <Show when={props.map.featureLayers?.length}>
            <div class={styles.infoItem}>
              <div class={styles.infoLabel}>LAYERS</div>
              <div class={styles.infoValue} style={{ color: "var(--text-muted)" }}>
                {props.map.featureLayers!.length}
              </div>
            </div>
          </Show>
        </div>

        {/* Elevation */}
        <Show when={props.map.elevation}>
          <div class={styles.section}>
            <h4 class={styles.sectionTitle}>Elevation</h4>
            <div class={styles.elevRow}>
              <For
                each={[
                  { l: "MIN", v: `${props.map.elevation!.min.toFixed(0)}m`, c: "var(--accent-primary)" },
                  { l: "AVG", v: `${props.map.elevation!.avg.toFixed(0)}m`, c: "var(--text-muted)" },
                  { l: "MAX", v: `${props.map.elevation!.max.toFixed(0)}m`, c: "var(--accent-warning)" },
                  { l: "\u03C3", v: `${props.map.elevation!.stddev.toFixed(0)}m`, c: "var(--text-dim)" },
                ]}
              >
                {(e) => (
                  <div class={styles.elevCell}>
                    <div class={styles.elevLabel}>{e.l}</div>
                    <div class={styles.elevValue} style={{ color: e.c }}>
                      {e.v}
                    </div>
                  </div>
                )}
              </For>
            </div>
            {(() => {
              const e = props.map.elevation!;
              const range = e.max - e.min;
              const avgPct = range > 0 ? ((e.avg - e.min) / range) * 100 : 50;
              return (
                <div class={styles.elevBarWrap}>
                  <div class={styles.elevBar}>
                    <div
                      class={styles.elevBarAvg}
                      style={{ left: `${avgPct}%` }}
                    />
                  </div>
                  <div class={styles.elevBarLabels}>
                    <span>{e.min.toFixed(0)}m</span>
                    <span>{e.max.toFixed(0)}m</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </Show>

        {/* Feature layers */}
        <Show when={props.map.featureLayers?.length}>
          <div class={styles.section}>
            <h4 class={styles.sectionTitle}>Feature Layers</h4>
            <div class={styles.layerTags}>
              <For each={props.map.featureLayers}>
                {(layer) => <span class={styles.layerTag}>{layer}</span>}
              </For>
            </div>
          </div>
        </Show>

        {/* Tile files */}
        <div class={styles.section}>
          <h4 class={styles.sectionTitle}>Tile Files</h4>
          <div class={styles.fileList}>
            <For each={OUTPUT_FILES}>
              {(f) => {
                const exists = () =>
                  props.map.files
                    ? Object.keys(props.map.files).includes(f.name)
                    : false;
                return (
                  <div class={styles.fileItem}>
                    <span
                      class={styles.fileIcon}
                      classList={{
                        [styles.fileIconFound]: exists(),
                        [styles.fileIconMissing]: !exists(),
                      }}
                    >
                      <CheckIcon size={12} />
                    </span>
                    <span
                      class={styles.fileName}
                      classList={{
                        [styles.fileNameFound]: exists(),
                        [styles.fileNameMissing]: !exists(),
                      }}
                    >
                      {f.name}
                    </span>
                    <Show when={exists() && props.map.files?.[f.name]}>
                      <span class={styles.fileSize}>
                        {props.map.files![f.name]} MB
                      </span>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Style variants */}
        <div class={styles.section}>
          <h4 class={styles.sectionTitle}>Styles</h4>
          <div class={styles.variantList}>
            <For each={STYLE_VARIANTS}>
              {(v) => (
                <div class={styles.variantCard}>
                  <div class={styles.variantLabel}>{v.label}</div>
                  <div class={styles.variantDesc}>{v.desc}</div>
                  <div class={styles.variantFile}>{v.file}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div class={styles.actions}>
        <button class={styles.deleteBtn} onClick={() => props.onDelete()}>
          <TrashIcon size={12} /> Delete Map
        </button>
      </div>
    </div>
  );
}
