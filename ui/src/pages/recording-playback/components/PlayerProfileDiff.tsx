import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { MedicalLogEntry } from "../../../data/types";
import { useI18n } from "../../../hooks/useLocale";
import {
  GEAR_LOCATION_LABEL_KEYS,
  stanceLabelKey,
  type BodyPartDelta,
  type DiffPolarity,
  type EquippedDelta,
  type FieldDelta,
  type GearDiff,
  type ItemDelta,
  type MedicalDiff,
  type MovedItem,
  type RadioDiff,
  type WeaponDelta,
} from "../profileDiff";
import styles from "./PlayerProfileCard.module.css";

const BODY_PART_KEYS: Record<string, string> = {
  head: "profile_part_head",
  body: "profile_part_body",
  leftarm: "profile_part_leftarm",
  rightarm: "profile_part_rightarm",
  leftleg: "profile_part_leftleg",
  rightleg: "profile_part_rightleg",
};
const HEMORRHAGE_KEYS = [
  "profile_hemorrhage_0",
  "profile_hemorrhage_1",
  "profile_hemorrhage_2",
  "profile_hemorrhage_3",
  "profile_hemorrhage_4",
] as const;

export function formatSigned(value: number, digits = 0): string {
  const absolute = digits > 0 ? Math.abs(value).toFixed(digits) : String(Math.abs(Math.round(value)));
  if (value > 0) return `+${absolute}`;
  if (value < 0) return `−${absolute}`;
  return absolute;
}

function polarityClass(polarity: DiffPolarity): string {
  if (polarity === "added") return styles.chipAdded;
  if (polarity === "removed") return styles.chipRemoved;
  return styles.chipChanged;
}

function formatNumber(value: unknown, digits = 0): string {
  return typeof value === "number" ? value.toFixed(digits) : "—";
}

function formatPercent(value: unknown): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function formatBp(value: unknown, noneLabel: string): string {
  if (!Array.isArray(value) || value.length < 2) return "—";
  const diastolic = value[0];
  const systolic = value[1];
  if (typeof systolic !== "number" || typeof diastolic !== "number") return "—";
  if (systolic <= 0 && diastolic <= 0) return noneLabel;
  return `${Math.round(systolic)}/${Math.round(diastolic)}`;
}

function formatField(
  field: FieldDelta,
  t: (key: string, params?: Record<string, string | number>) => string,
): { from: string; to: string } {
  const format = (value: unknown): string => {
    if (value === undefined || value === null || value === "") return t("profile_none");
    switch (field.kind) {
      case "percent":
        return formatPercent(value);
      case "number":
        return `${formatNumber(value, field.digits ?? 0)}${field.suffix ?? ""}`;
      case "bool":
        return value === true ? t("profile_yes") : value === false ? t("profile_no") : String(value);
      case "bp":
        return formatBp(value, t("profile_no_blood_pressure"));
      case "hemorrhage": {
        const index = Number(value ?? 0);
        return HEMORRHAGE_KEYS[index] ? t(HEMORRHAGE_KEYS[index]) : formatNumber(value);
      }
      case "stance": {
        const key = stanceLabelKey(Number(value));
        return key ? t(key) : formatNumber(value);
      }
      default:
        return String(value);
    }
  };
  return { from: format(field.from), to: format(field.to) };
}

function itemLabel(item: ItemDelta, t: (key: string, params?: Record<string, string | number>) => string): string {
  const count =
    item.polarity === "added"
      ? `×${item.toCount}`
      : item.polarity === "removed"
        ? `×${item.fromCount}`
        : `×${item.fromCount} → ×${item.toCount}`;
  const prefix = item.polarity === "added" ? "+ " : item.polarity === "removed" ? "− " : "";
  let rounds = "";
  if (item.fromRounds !== undefined || item.toRounds !== undefined) {
    if (item.polarity === "added" && item.toRounds !== undefined) {
      rounds = ` · ${t("profile_diff_rds", { count: item.toRounds })}`;
    } else if (item.polarity === "removed" && item.fromRounds !== undefined) {
      rounds = ` · ${t("profile_diff_rds", { count: item.fromRounds })}`;
    } else if (item.fromRounds !== item.toRounds) {
      rounds = ` · ${t("profile_diff_rds", { count: `${item.fromRounds ?? "—"} → ${item.toRounds ?? "—"}` })}`;
    }
  }
  return `${prefix}${item.name} ${count}${rounds}`;
}

function DiffChip(props: { polarity: DiffPolarity; children: JSX.Element; title?: string }): JSX.Element {
  return (
    <span class={`${styles.itemChip} ${polarityClass(props.polarity)}`} title={props.title}>
      {props.children}
    </span>
  );
}

function ItemDeltaList(props: { items: ItemDelta[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.itemList}>
      <For each={props.items}>
        {(item) => (
          <DiffChip polarity={item.polarity} title={item.class}>
            {itemLabel(item, t)}
          </DiffChip>
        )}
      </For>
    </div>
  );
}

function EquippedLine(props: { entry: EquippedDelta }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.equippedDiff}>
      <span class={styles.sectionLabel}>{t(props.entry.slotKey)}</span>
      <DiffChip polarity={props.entry.polarity}>
        {props.entry.fromName || t("profile_none")} → {props.entry.toName || t("profile_none")}
      </DiffChip>
    </div>
  );
}

function WeaponDiff(props: { weapon: WeaponDelta }): JSX.Element {
  const { t } = useI18n();
  const swapped = () => props.weapon.fromName !== props.weapon.toName;
  return (
    <div class={styles.weapon}>
      <b>
        {swapped()
          ? `${props.weapon.fromName || t("profile_none")} → ${props.weapon.toName || t("profile_none")}`
          : props.weapon.toName || props.weapon.fromName}
      </b>
      <small>{props.weapon.slot}</small>
      <Show when={props.weapon.attachments.length}>
        <ItemDeltaList items={props.weapon.attachments} />
      </Show>
    </div>
  );
}

function MovedList(props: { items: MovedItem[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.itemList}>
      <For each={props.items}>
        {(item) => (
          <DiffChip polarity="changed" title={item.class}>
            {item.name}
            {item.count > 1 ? ` ×${item.count}` : ""} ·{" "}
            {t("profile_diff_moved_path", {
              from: t(GEAR_LOCATION_LABEL_KEYS[item.from]),
              to: t(GEAR_LOCATION_LABEL_KEYS[item.to]),
            })}
          </DiffChip>
        )}
      </For>
    </div>
  );
}

export function GearDiffView(props: { diff: GearDiff }): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <Show when={props.diff.net.length}>
        <div class={styles.gearBlock}>
          <div class={styles.blockTitle}>{t("profile_diff_net")}</div>
          <ItemDeltaList items={props.diff.net} />
        </div>
      </Show>
      <Show when={props.diff.moved.length}>
        <div class={styles.gearBlock}>
          <div class={styles.blockTitle}>{t("profile_diff_moved")}</div>
          <MovedList items={props.diff.moved} />
        </div>
      </Show>
      <Show when={props.diff.equipped.length}>
        <div class={styles.gearBlock}>
          <For each={props.diff.equipped}>{(entry) => <EquippedLine entry={entry} />}</For>
        </div>
      </Show>
      <Show when={props.diff.weapons.length}>
        <div class={styles.gearBlock}>
          <div class={styles.blockTitle}>{t("profile_weapons")}</div>
          <For each={props.diff.weapons}>{(weapon) => <WeaponDiff weapon={weapon} />}</For>
        </div>
      </Show>
      <For each={props.diff.locations}>
        {(location) => (
          <Show when={location.container || location.items.length}>
            <div class={styles.gearBlock}>
              <div class={styles.blockTitle}>
                {t(GEAR_LOCATION_LABEL_KEYS[location.location])}
                <Show when={location.container}>
                  {(entry) => (
                    <span>
                      {entry().fromName || t("profile_none")} → {entry().toName || t("profile_none")}
                    </span>
                  )}
                </Show>
              </div>
              <Show when={location.items.length}>
                <ItemDeltaList items={location.items} />
              </Show>
            </div>
          </Show>
        )}
      </For>
    </>
  );
}

function FieldDiffGrid(props: { fields: FieldDelta[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.dataGrid}>
      <For each={props.fields}>
        {(entry) => {
          const formatted = () => formatField(entry, t);
          return (
            <span>
              {t(entry.labelKey)}
              <b class={styles.fieldDelta}>
                {formatted().from} → {formatted().to}
              </b>
            </span>
          );
        }}
      </For>
    </div>
  );
}

function BodyPartDiff(props: { part: BodyPartDelta }): JSX.Element {
  const { t } = useI18n();
  const label = () => (BODY_PART_KEYS[props.part.part] ? t(BODY_PART_KEYS[props.part.part]) : props.part.part);
  const damage = () => (props.part.damage ? formatField(props.part.damage, t) : undefined);
  return (
    <div>
      <b>{label()}</b>
      <Show when={damage()}>
        {(pair) => <span>{t("profile_dmg", { value: `${pair().from} → ${pair().to}` })}</span>}
      </Show>
      <Show when={props.part.items.length}>
        <ItemDeltaList items={props.part.items} />
      </Show>
    </div>
  );
}

function LogDiff(props: { titleKey: string; entries: MedicalLogEntry[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.medicalLog}>
      <div class={styles.medicalLogHeader}>{t(props.titleKey)}</div>
      <For each={props.entries}>
        {(entry) => (
          <div class={styles.medicalLogEntry}>
            <time>{entry.time}</time>
            <span>{entry.text}</span>
          </div>
        )}
      </For>
    </div>
  );
}

export function MedicalDiffView(props: { diff: MedicalDiff }): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <Show when={props.diff.fields.length}>
        <FieldDiffGrid fields={props.diff.fields} />
      </Show>
      <Show when={props.diff.bodyParts.length}>
        <div class={styles.subheading}>{t("profile_body_parts")}</div>
        <div class={styles.bodyParts}>
          <For each={props.diff.bodyParts}>{(part) => <BodyPartDiff part={part} />}</For>
        </div>
      </Show>
      <Show when={props.diff.treatments.length}>
        <div class={styles.gearBlock}>
          <div class={styles.blockTitle}>{t("profile_in_system")}</div>
          <ItemDeltaList items={props.diff.treatments} />
        </div>
      </Show>
      <Show when={props.diff.activity.length || props.diff.quickView.length}>
        <div class={styles.medicalLogs}>
          <Show when={props.diff.activity.length}>
            <LogDiff titleKey="profile_diff_new_log" entries={props.diff.activity} />
          </Show>
          <Show when={props.diff.quickView.length}>
            <LogDiff titleKey="profile_quick_view" entries={props.diff.quickView} />
          </Show>
        </div>
      </Show>
    </>
  );
}

export function StaminaDiffView(props: { fields: FieldDelta[] }): JSX.Element {
  return <FieldDiffGrid fields={props.fields} />;
}

export function RadioDiffView(props: { diff: RadioDiff }): JSX.Element {
  return (
    <For each={props.diff.radios}>
      {(radio) => (
        <div
          class={styles.radioRow}
          classList={{
            [styles.diffAdded]: radio.polarity === "added",
            [styles.diffRemoved]: radio.polarity === "removed",
            [styles.diffChanged]: radio.polarity === "changed",
          }}
        >
          <div>
            <b>{radio.name}</b>
          </div>
          <Show when={radio.fields.length}>
            <FieldDiffGrid fields={radio.fields} />
          </Show>
        </div>
      )}
    </For>
  );
}

export function DiffEmpty(props: { sameFrame: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.noData}>{props.sameFrame ? t("profile_diff_same") : t("profile_diff_none")}</div>
  );
}
