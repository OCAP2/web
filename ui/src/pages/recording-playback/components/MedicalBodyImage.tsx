import { For } from "solid-js";
import type { JSX } from "solid-js";
import type { MedicalBodyPart } from "../../../data/types";
import { useI18n } from "../../../hooks/useLocale";
import { BODY_BACKGROUND, BODY_OVERLAY_ASSETS, BODY_PART_FILLS } from "../medical/bodyAssets";
import {
  BODY_PART_IDS,
  HIT_REGIONS,
  bodyPartFillColor,
  overlaysForMedical,
  type BodyPartId,
} from "../medical/bodyImage";
import styles from "./MedicalBodyImage.module.css";

const PART_LABEL_KEYS: Record<BodyPartId, string> = {
  head: "profile_part_head",
  body: "profile_part_body",
  leftarm: "profile_part_leftarm",
  rightarm: "profile_part_rightarm",
  leftleg: "profile_part_leftleg",
  rightleg: "profile_part_rightleg",
};

interface Props {
  parts: MedicalBodyPart[];
  kat?: Record<string, unknown>;
  vanillaDamage?: number;
  selected: string | null;
  onSelect: (part: BodyPartId) => void;
}

function maskStyle(src: string, tint: string): JSX.CSSProperties {
  return {
    "--src": `url("${src}")`,
    "--tint": tint,
  } as JSX.CSSProperties;
}

export function MedicalBodyImage(props: Props): JSX.Element {
  const { t } = useI18n();
  const overlays = () => overlaysForMedical(props.parts, props.kat, props.selected);

  return (
    <div class={styles.stage} role="group" aria-label={t("profile_body_diagram")}>
      <img class={styles.background} src={BODY_BACKGROUND} alt="" />
      <For each={BODY_PART_IDS}>
        {(partId) => {
          const part = () => props.parts.find((entry) => entry.part === partId);
          return (
            <div
              class={styles.layer}
              data-part-fill={partId}
              style={maskStyle(
                BODY_PART_FILLS[partId],
                bodyPartFillColor(part(), props.vanillaDamage),
              )}
            />
          );
        }}
      </For>
      <For each={overlays()}>
        {(overlay) => {
          const src = BODY_OVERLAY_ASSETS[overlay.asset];
          return src ? (
            <div
              class={styles.layer}
              data-overlay={overlay.id}
              style={maskStyle(src, overlay.tint)}
            />
          ) : null;
        }}
      </For>
      <For each={BODY_PART_IDS}>
        {(partId) => {
          const region = HIT_REGIONS[partId];
          return (
            <button
              type="button"
              class={styles.hit}
              style={{
                left: `${region.left}%`,
                top: `${region.top}%`,
                width: `${region.width}%`,
                height: `${region.height}%`,
              }}
              aria-label={t(PART_LABEL_KEYS[partId])}
              aria-pressed={props.selected === partId}
              onClick={() => props.onSelect(partId)}
            />
          );
        }}
      </For>
    </div>
  );
}
