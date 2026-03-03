import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS } from "./constants";
import { mapHue, formatWorldSize, formatFileSize, totalDiskMB, statusLabelKey } from "./helpers";
import { useI18n } from "../../hooks/useLocale";
import { LayersIcon } from "../../components/Icons";
import styles from "./MapManager.module.css";

export function MapCard(props: {
  map: MapInfo;
  selected: boolean;
  baseUrl: string;
  onSelect: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const hue = () => mapHue(props.map.name);
  const statusColor = () => MAP_STATUS_COLORS[props.map.status] ?? "var(--text-dimmer)";
  const disk = () => totalDiskMB(props.map.files);

  return (
    <div
      class={styles.card}
      classList={{ [styles.cardSelected]: props.selected }}
      onClick={() => props.onSelect()}
    >
      <div
        class={styles.cardPreview}
        style={{
          background: `linear-gradient(135deg, hsl(${hue()}, 22%, 11%), hsl(${(hue() + 40) % 360}, 18%, 7%))`,
        }}
      >
        <Show
          when={props.map.hasPreview}
          fallback={
            <>
              <svg width="100%" height="100%" class={styles.cardPattern}>
                <defs>
                  <pattern
                    id={`g-${props.map.name}`}
                    width="18"
                    height="18"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 18 0 L 0 0 0 18"
                      fill="none"
                      stroke={`hsl(${hue()},35%,45%)`}
                      stroke-width="0.4"
                    />
                  </pattern>
                </defs>
                <rect
                  width="100%"
                  height="100%"
                  fill={`url(#g-${props.map.name})`}
                />
              </svg>
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 200 100"
                preserveAspectRatio="none"
                class={styles.cardBlobs}
              >
                <ellipse
                  cx={55 + (hue() % 45)}
                  cy={48 + (hue() % 18)}
                  rx={38 + (hue() % 28)}
                  ry={22 + (hue() % 14)}
                  fill={`hsl(${hue()},28%,35%)`}
                />
                <ellipse
                  cx={145 - (hue() % 35)}
                  cy={38 + (hue() % 22)}
                  rx={28 + (hue() % 18)}
                  ry={18 + (hue() % 10)}
                  fill={`hsl(${(hue() + 60) % 360},22%,30%)`}
                />
              </svg>
              <span class={styles.cardNoPreview}>{t("mm_no_preview")}</span>
            </>
          }
        >
          <img
            src={`${props.baseUrl}/images/maps/${props.map.name}/preview_256.png`}
            alt={props.map.name}
            class={styles.cardImg}
            loading="lazy"
          />
        </Show>
        <span
          class={styles.cardStatusBadge}
          style={{
            background: `color-mix(in srgb, ${statusColor()} 20%, rgba(0,0,0,0.6))`,
            color: statusColor(),
            border: `1px solid color-mix(in srgb, ${statusColor()} 25%, transparent)`,
          }}
        >
          {t(statusLabelKey(props.map.status))}
        </span>
      </div>
      <div class={styles.cardBody}>
        <span class={styles.cardName}>{props.map.name}</span>
        <Show when={props.map.lastError}>
          <div class={styles.cardError} title={props.map.lastError}>
            {t("mm_pipeline_failed")}
          </div>
        </Show>
        <div class={styles.cardMeta}>
          <Show when={props.map.worldSize}>
            <span class={styles.cardMetaItem}>
              {formatWorldSize(props.map.worldSize!)}
            </span>
          </Show>
          <Show when={props.map.featureLayers?.length}>
            <span class={styles.cardMetaSep}>&middot;</span>
            <span class={styles.cardLayers}>
              <LayersIcon size={10} /> {props.map.featureLayers!.length}
            </span>
          </Show>
          <Show when={disk() > 0}>
            <span class={styles.cardMetaSep}>&middot;</span>
            <span class={styles.cardMetaItem}>
              {formatFileSize(disk() * 1_048_576)}
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
