import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { CopyIcon } from "../../../components/Icons";
import type {
  GearContainer,
  GearItem,
  InventorySnapshot,
  MedicalBodyPart,
  MedicalLogEntry,
  MedicalSnapshot,
  PlayerSnapshotType,
  RadioSnapshot,
  RadioSnapshotEntry,
  StaminaSnapshot,
  TreatmentItem,
} from "../../../data/types";
import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { useRenderer } from "../../../hooks/useRenderer";
import { Unit } from "../../../playback/entities/unit";
import { PlayerSnapshotEvent } from "../../../playback/events/playerSnapshotEvent";
import { formatTime } from "../../../playback/time";
import { formatUnitTypeLabel } from "../../../playback/zeus";
import type { BriefingMarkerHandle } from "../../../renderers/renderer.types";
import { SIDE_COLORS_BRIGHT, SIDE_COLORS_UI } from "../../../config/sideColors";
import { BODY_PART_IDS, type BodyPartId } from "../medical/bodyImage";
import { loadWorldDem, worldHasElevation, type DemGrid } from "../../../playback/radioRange/demGrid";
import { marchAcreCoverage } from "../../../playback/radioRange/acreCoverage";
import { marchCoverage } from "../../../playback/radioRange/tfarCoverage";
import { MedicalBodyImage } from "./MedicalBodyImage";
import { showHint } from "./Hint";
import {
  DiffEmpty,
  formatSigned,
  GearDiffView,
  MedicalDiffView,
  RadioDiffView,
  StaminaDiffView,
} from "./PlayerProfileDiff";
import {
  categorizeGearItems,
  filledGearCategories,
  GEAR_CATEGORY_LABEL_KEYS,
  magazinesNotInContainers,
  carriedMagazineRounds,
  shouldLabelGearCategory,
  weaponsInSlotOrder,
  type GearCategory,
} from "../gearCategories";
import { gearItemName } from "../../../data/gearDisplayName";
import {
  diffGear,
  diffMedical,
  diffRadios,
  diffStamina,
  gearDiffIsEmpty,
  medicalDiffIsEmpty,
  radioDiffIsEmpty,
  staminaReserve as reserveAt,
  stanceLabelKey,
} from "../profileDiff";
import styles from "./PlayerProfileCard.module.css";
import { exportAceArsenal, exportVanillaArsenal } from "../arsenalExport";
import { diffTraits, formatMultiplier, traitGroups, traitLevelKey, type TraitField } from "../traits";

type RangeMode = "simple" | "approx";

interface Props {
  unit: Unit;
  kills: number;
  deaths: number;
  markerCount: number;
  isBlacklisted: boolean;
  isFollowed: boolean;
  isAdmin: boolean;
  showKillCount: boolean;
  onClose: () => void;
  onToggleFollow: (id: number) => void;
  onToggleBlacklist?: (id: number) => void;
}

const percent = (value: unknown): string =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
const number = (value: unknown, digits = 0): string =>
  typeof value === "number" ? value.toFixed(digits) : "—";

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

const TAB_DEFS = [
  { id: "gear", type: "inventorySnapshot", labelKey: "profile_tab_gear", missingKey: "profile_label_gear" },
  { id: "medical", type: "medicalSnapshot", labelKey: "profile_tab_medical", missingKey: "profile_label_medical" },
  { id: "stamina", type: "staminaSnapshot", labelKey: "profile_tab_stamina", missingKey: "profile_label_stamina" },
  { id: "radio", type: "radioSnapshot", labelKey: "profile_tab_radios", missingKey: "profile_label_radio" },
  // Traits ride inside the inventory snapshot; the tab is offered only when the
  // recording actually carries a trait block (see availableTabs).
  { id: "traits", type: "inventorySnapshot", labelKey: "profile_tab_traits", missingKey: "profile_label_gear" },
] as const;
type TabId = (typeof TAB_DEFS)[number]["id"];

/** One Arma mass unit is a tenth of a pound. */
const MASS_UNIT_KG = 0.0453592;
/** Engine sprint duration for an unloaded soldier, used when staminaMax is absent. */
const STAMINA_DURATION = 60;

function pickVital(...layers: unknown[]): number | undefined {
  let picked: number | undefined;
  for (const layer of layers) {
    if (typeof layer === "number") picked = layer;
  }
  return picked;
}

/** ACE stores [diastolic, systolic]. Display as the clinical 120/80. */
function formatBloodPressure(value: unknown, noneLabel: string): string {
  if (!Array.isArray(value) || value.length < 2) return "—";
  const diastolic = value[0];
  const systolic = value[1];
  if (typeof systolic !== "number" || typeof diastolic !== "number") return "—";
  // Cardiac arrest zeros cardiac output, so ACE writes [0, 0]. That is not a reading.
  if (systolic <= 0 && diastolic <= 0) return noneLabel;
  return `${Math.round(systolic)}/${Math.round(diastolic)}`;
}

/** ACE bodyPartDamage is additive trauma, not 0–1. Cap the label at 100%. */
function formatBodyPartDamage(damage: unknown): string {
  if (typeof damage !== "number") return "—";
  return `${Math.round(Math.min(1, Math.max(0, damage)) * 100)}%`;
}

function displayedBodyParts(parts: MedicalBodyPart[]): MedicalBodyPart[] {
  const byId = new Map(parts.map((part) => [part.part, part]));
  return BODY_PART_IDS.map(
    (id) => byId.get(id) ?? { part: id, damage: 0, items: [] },
  );
}

function carriedWeightKg(source?: { massUnits?: number }): number | undefined {
  if (typeof source?.massUnits === "number") return source.massUnits * MASS_UNIT_KG;
  return undefined;
}

function snapshotReasonKey(reason: string): string {
  return `profile_reason_${reason}`;
}

function SnapshotMeta(props: { event?: PlayerSnapshotEvent; extra?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <Show when={props.event}>
      {(event) => {
        const reason =
          "reason" in event().payload ? (event().payload as InventorySnapshot).reason : undefined;
        const reasonKey = reason ? snapshotReasonKey(reason) : "";
        const reasonLabel = reasonKey ? t(reasonKey) : "";
        return (
          <div class={styles.snapshotMeta}>
            {t("profile_frame", { frame: event().frameNum })}
            <Show when={reason && reasonLabel !== reasonKey}>{` · ${reasonLabel}`}</Show>
            <Show when={props.extra}>{` · ${props.extra}`}</Show>
          </div>
        );
      }}
    </Show>
  );
}

function ItemList(props: { items?: GearItem[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.itemList}>
      <For each={props.items ?? []}>
        {(item) => (
          <span class={styles.itemChip} title={item.class}>
            {gearItemName(item)}
            <Show when={(item.count ?? 1) > 1}> ×{item.count}</Show>
          </span>
        )}
      </For>
      <Show when={!props.items?.length}>
        <span class={styles.empty}>{t("profile_empty")}</span>
      </Show>
    </div>
  );
}

function TreatmentList(props: { items?: TreatmentItem[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.itemList}>
      <For each={props.items ?? []}>
        {(item) => (
          <span class={styles.itemChip} title={item.detail ? `${item.kind} · ${item.detail}` : item.kind}>
            {item.name}
            <Show when={(item.count ?? 1) > 1}> ×{item.count}</Show>
            <Show when={item.detail}> ({item.detail})</Show>
          </span>
        )}
      </For>
      <Show when={!props.items?.length}>
        <span class={styles.empty}>{t("profile_none")}</span>
      </Show>
    </div>
  );
}

function MedicalLogList(props: { titleKey: string; entries?: MedicalLogEntry[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class={styles.medicalLog}>
      <div class={styles.medicalLogHeader}>{t(props.titleKey)}</div>
      <For each={props.entries ?? []}>
        {(entry) => (
          <div class={styles.medicalLogEntry}>
            <time>{entry.time}</time>
            <span>{entry.text}</span>
          </div>
        )}
      </For>
      <Show when={!props.entries?.length}>
        <span class={styles.empty}>{t("profile_log_empty")}</span>
      </Show>
    </div>
  );
}

function ContainerSection(props: { label?: string; items: GearItem[] }): JSX.Element {
  return (
    <div class={styles.containerSection}>
      <Show when={props.label}>
        <div class={styles.sectionLabel}>{props.label}</div>
      </Show>
      <ItemList items={props.items} />
    </div>
  );
}

function CategorizedItemSections(props: {
  items?: GearItem[];
  alwaysLabel?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const groups = () => categorizeGearItems(props.items);
  const filled = () => filledGearCategories(groups());
  return (
    <For each={filled()}>
      {(key: GearCategory) => (
        <ContainerSection
          label={
            shouldLabelGearCategory(key, filled(), props.alwaysLabel)
              ? t(GEAR_CATEGORY_LABEL_KEYS[key])
              : undefined
          }
          items={groups()[key]}
        />
      )}
    </For>
  );
}

function Container(props: {
  label: string;
  container?: GearContainer;
}): JSX.Element {
  const { t } = useI18n();
  const groups = () => categorizeGearItems(props.container?.items);
  return (
    <div class={styles.gearBlock}>
      <div class={styles.blockTitle}>
        {props.label}
        <span>{gearItemName(props.container) || t("profile_none")}</span>
      </div>
      <Show
        when={filledGearCategories(groups()).length}
        fallback={<span class={styles.empty}>{t("profile_empty")}</span>}
      >
        <CategorizedItemSections items={props.container?.items} />
      </Show>
    </div>
  );
}

export function PlayerProfileCard(props: Props): JSX.Element {
  const engine = useEngine();
  const renderer = useRenderer();
  const { t } = useI18n();
  const [rangeRadio, setRangeRadio] = createSignal<string | null>(null);
  const [rangeMode, setRangeMode] = createSignal<RangeMode>("simple");
  const [demGrid, setDemGrid] = createSignal<DemGrid | undefined>();
  const [demFailed, setDemFailed] = createSignal(false);
  const [tab, setTab] = createSignal<TabId>("gear");
  const [selectedPart, setSelectedPart] = createSignal<string | null>(null);
  const [diffing, setDiffing] = createSignal(false);
  const [fromFrame, setFromFrame] = createSignal(0);
  const [toPinned, setToPinned] = createSignal<number | null>(null);

  const approxAvailable = createMemo(() => {
    if (demFailed()) return false;
    if (demGrid()) return true;
    return worldHasElevation(engine.worldConfig);
  });

  const selectRange = (key: string, mode: RangeMode) => {
    if (rangeRadio() === key && rangeMode() === mode) {
      setRangeRadio(null);
      return;
    }
    if (mode === "approx") {
      if (!approxAvailable()) return;
      const world = engine.worldConfig;
      if (world && !demGrid() && !demFailed()) {
        void loadWorldDem({
          tileBaseUrl: world.tileBaseUrl,
          worldName: world.worldName,
          worldSize: world.worldSize,
          hasDem: world.hasDem,
          hasHeightmap: world.hasHeightmap,
        }).then((grid) => {
          if (grid) setDemGrid(grid);
          else {
            setDemFailed(true);
            setRangeMode((current) => (current === "approx" ? "simple" : current));
          }
        });
      }
    }
    setRangeRadio(key);
    setRangeMode(mode);
  };

  // A chunked recording keeps player snapshots in a per-unit sidecar rather than
  // the manifest, so opening the card is what fetches them. Everywhere else this
  // resolves immediately against data that is already loaded.
  const [snapshotsLoading, setSnapshotsLoading] = createSignal(false);

  const snapshotUnitId = createMemo(() => {
    engine.currentFrame();
    if (props.unit.type !== "zeus") return props.unit.id;
    return (
      engine.eventManager.getZeusState(props.unit.id, engine.currentFrame())
        ?.controllingUnitId ?? props.unit.id
    );
  });
  const controllingHost = createMemo(() => {
    const unitId = engine.entitySnapshots().get(props.unit.id)?.controllingUnitId;
    if (unitId == null) return null;
    const host = engine.entityManager.getEntity(unitId);
    if (!(host instanceof Unit)) return null;
    return {
      name: host.name || String(unitId),
      type: formatUnitTypeLabel(host.roleAtFrame(engine.currentFrame())),
    };
  });

  createEffect(() => {
    const unitId = snapshotUnitId();
    setSelectedPart(null);
    setRangeRadio(null);
    setDiffing(false);
    setToPinned(null);

    setSnapshotsLoading(true);
    void engine.ensurePlayerSnapshots(unitId).finally(() => {
      // Ignore a load that finished after the user moved to another player.
      if (snapshotUnitId() === unitId) setSnapshotsLoading(false);
    });
  });

  const trackedKinds = createMemo(() => {
    engine.endFrame();
    engine.playerSnapshotsVersion();
    const kinds = new Set<PlayerSnapshotType>();
    for (const entry of TAB_DEFS) {
      if (engine.eventManager.getFirstPlayerSnapshotFrame(snapshotUnitId(), entry.type) !== undefined) {
        kinds.add(entry.type);
      }
    }
    return kinds;
  });
  const snapshots = createMemo(() => {
    engine.currentFrame();
    engine.playerSnapshotsVersion();
    return engine.eventManager.getPlayerSnapshots(snapshotUnitId(), engine.currentFrame());
  });
  const toFrame = () => toPinned() ?? engine.currentFrame();
  const snapshotsAt = (frame: number) => engine.eventManager.getPlayerSnapshots(snapshotUnitId(), frame);
  const snapshotEvent = (type: PlayerSnapshotType): PlayerSnapshotEvent | undefined =>
    snapshots().get(type);
  const payload = <T,>(type: PlayerSnapshotType): T | undefined =>
    snapshotEvent(type)?.payload as T | undefined;
  const payloadAt = <T,>(frame: number, type: PlayerSnapshotType): T | undefined =>
    snapshotsAt(frame).get(type)?.payload as T | undefined;
  const inventory = () => payload<InventorySnapshot>("inventorySnapshot");
  const medical = () => payload<MedicalSnapshot>("medicalSnapshot");
  const stamina = () => payload<StaminaSnapshot>("staminaSnapshot");
  const radio = () => payload<RadioSnapshot>("radioSnapshot");
  const fromInventory = () => payloadAt<InventorySnapshot>(fromFrame(), "inventorySnapshot");
  const toInventory = () => payloadAt<InventorySnapshot>(toFrame(), "inventorySnapshot");
  // The trait block is optional inside the inventory snapshot, so the Traits tab
  // is keyed on the snapshot in view, falling back to the last one of the
  // recording so it does not flicker while scrubbing before the first sample.
  const traitsTracked = () =>
    (inventory() ?? payloadAt<InventorySnapshot>(engine.endFrame(), "inventorySnapshot"))?.traits !== undefined;
  const availableTabs = createMemo(() =>
    TAB_DEFS.filter((entry) => trackedKinds().has(entry.type) && (entry.id !== "traits" || traitsTracked())),
  );
  const tabIsTracked = (id: TabId) => availableTabs().some((entry) => entry.id === id);

  createEffect(() => {
    const tabs = availableTabs();
    if (tabs.length === 0) return;
    if (!tabs.some((entry) => entry.id === tab())) {
      setTab(tabs[0].id);
    }
  });

  const fromMedical = () => payloadAt<MedicalSnapshot>(fromFrame(), "medicalSnapshot");
  const toMedical = () => payloadAt<MedicalSnapshot>(toFrame(), "medicalSnapshot");
  const fromStamina = () => payloadAt<StaminaSnapshot>(fromFrame(), "staminaSnapshot");
  const toStamina = () => payloadAt<StaminaSnapshot>(toFrame(), "staminaSnapshot");
  const fromRadio = () => payloadAt<RadioSnapshot>(fromFrame(), "radioSnapshot");
  const toRadio = () => payloadAt<RadioSnapshot>(toFrame(), "radioSnapshot");
  const sameDiffFrame = () => diffing() && fromFrame() === toFrame();
  const gearChanges = createMemo(() => diffGear(fromInventory(), toInventory()));
  const medicalChanges = createMemo(() => diffMedical(fromMedical(), toMedical()));
  const staminaChanges = createMemo(() =>
    diffStamina(fromStamina(), toStamina(), fromInventory(), toInventory()),
  );
  const radioChanges = createMemo(() => diffRadios(fromRadio(), toRadio()));
  const copyGear = (format: "vanilla" | "ace") => {
    const gear = diffing() ? toInventory() : inventory();
    if (!gear || !navigator.clipboard?.writeText) {
      showHint(t("profile_export_failed"));
      return;
    }
    const exported = format === "ace" ? exportAceArsenal(gear) : exportVanillaArsenal(gear);
    void navigator.clipboard.writeText(exported).then(
      () => showHint(t(format === "ace" ? "profile_exported_ace" : "profile_exported_vanilla")),
      () => showHint(t("profile_export_failed")),
    );
  };
  const frameLabel = (frame: number) => formatTime(frame, "elapsed", engine.timeConfig);
  const toggleDiff = () => {
    if (diffing()) {
      setDiffing(false);
      setToPinned(null);
      return;
    }
    setFromFrame(engine.currentFrame());
    setToPinned(null);
    setDiffing(true);
  };
  const swapDiff = () => {
    const from = fromFrame();
    const to = toFrame();
    setFromFrame(to);
    setToPinned(from);
  };

  const radioKey = (entry: RadioSnapshotEntry, index: number) =>
    `${index}:${entry.type}:${entry.frequency}:${entry.additional}`;

  let simpleHandle: BriefingMarkerHandle | undefined;
  let approxHandle: BriefingMarkerHandle | undefined;
  let simpleSignature = "";
  let lastMarchOrigin: [number, number] | undefined;
  let lastMarchKey = "";
  let lastMarchVerts: [number, number][] | undefined;

  const clearRangeOverlays = () => {
    if (simpleHandle) renderer.removeBriefingMarker(simpleHandle);
    if (approxHandle) renderer.removeBriefingMarker(approxHandle);
    simpleHandle = undefined;
    approxHandle = undefined;
    simpleSignature = "";
    lastMarchOrigin = undefined;
    lastMarchKey = "";
    lastMarchVerts = undefined;
  };

  createEffect(() => {
    const selected = rangeRadio();
    const mode = rangeMode();
    const entries = radio()?.radios ?? [];
    const index = entries.findIndex((entry, i) => radioKey(entry, i) === selected);
    const entry = index >= 0 ? entries[index] : undefined;
    const snapshot = engine.entitySnapshots().get(snapshotUnitId())
      ?? engine.entitySnapshots().get(props.unit.id);
    const grid = demGrid();

    if (!entry || !snapshot || !selected) {
      clearRangeOverlays();
      return;
    }

    const color = SIDE_COLORS_BRIGHT[props.unit.side].replace("#", "");
    const dashed = mode === "approx";
    const signature = `${mode}:${entry.rangeMeters}:${entry.type}:${color}`;

    if (!simpleHandle || simpleSignature !== signature) {
      if (simpleHandle) renderer.removeBriefingMarker(simpleHandle);
      simpleHandle = renderer.createBriefingMarker({
        shape: "ELLIPSE",
        type: "ocap_radio_range",
        color,
        side: props.unit.side,
        size: [entry.rangeMeters, entry.rangeMeters],
        brush: dashed ? "Border" : "SolidBorder",
        dashArray: dashed ? "8 8" : undefined,
        layer: "systemMarkers",
      });
      simpleSignature = signature;
    }
    renderer.updateBriefingMarker(simpleHandle, {
      position: snapshot.position,
      direction: 0,
      alpha: dashed ? 0.55 : 0.25,
    });

    if (mode !== "approx" || !grid) {
      if (approxHandle) {
        renderer.removeBriefingMarker(approxHandle);
        approxHandle = undefined;
      }
      return;
    }

    const pos = snapshot.position;
    const origin: [number, number, number?] = [
      pos[0],
      pos[1],
      pos.length > 2 ? pos[2] : undefined,
    ];
    const isAcre = entry.mod === "ACRE";
    const tfarPropagation = engine.radioPropagation;
    const acrePropagation = engine.acrePropagation;
    const marchKey = isAcre
      ? `acre:${selected}:${entry.rangeMeters}:${entry.frequency}:${acrePropagation.terrainLoss}:${acrePropagation.signalModel}`
      : `tfar:${selected}:${entry.rangeMeters}:${tfarPropagation.terrainInterceptionCoefficient}:${tfarPropagation.globalRadioRangeCoef}`;
    const moved =
      !lastMarchOrigin ||
      Math.hypot(pos[0] - lastMarchOrigin[0], pos[1] - lastMarchOrigin[1]) >= 5;
    if (!lastMarchVerts || lastMarchKey !== marchKey || moved) {
      lastMarchVerts = isAcre
        ? marchAcreCoverage(grid, origin, {
            rangeMeters: entry.rangeMeters,
            frequencyMHz: entry.frequency,
            propagation: acrePropagation,
          })
        : marchCoverage(grid, origin, {
            rangeMeters: entry.rangeMeters,
            propagation: tfarPropagation,
          });
      lastMarchOrigin = [pos[0], pos[1]];
      lastMarchKey = marchKey;
    }

    if (!approxHandle) {
      approxHandle = renderer.createBriefingMarker({
        shape: "POLYGON",
        type: "ocap_radio_coverage",
        color,
        side: props.unit.side,
        brush: "SolidBorder",
        layer: "systemMarkers",
      });
    }
    renderer.updateBriefingMarker(approxHandle, {
      position: snapshot.position,
      direction: 0,
      alpha: 0.28,
      points: lastMarchVerts,
    });
  });
  onCleanup(clearRangeOverlays);

  const vanillaMedical = () => medical()?.vanilla ?? {};
  const aceMedical = () => medical()?.ace;
  const katMedical = () => medical()?.kat;
  const vanillaStamina = () => stamina()?.vanilla ?? {};
  const aceFatigue = () => stamina()?.ace;
  // The stamina snapshot is sampled far more often than the inventory one, so it wins.
  const weightKg = () => carriedWeightKg(vanillaStamina()) ?? carriedWeightKg(inventory());
  const loadFraction = () => vanillaStamina().load ?? inventory()?.load;
  const sprintSecondsMax = () => {
    const max = vanillaStamina().staminaMax;
    if (typeof max === "number" && max > 0) return max;
    const load = loadFraction();
    return typeof load === "number" ? STAMINA_DURATION * Math.max(0, 1 - load) : undefined;
  };
  const sprintReserve = () => {
    const seconds = vanillaStamina().stamina;
    const max = sprintSecondsMax();
    if (typeof seconds !== "number" || !max) return undefined;
    return Math.min(1, seconds / max);
  };
  // ACE Advanced Fatigue turns the vanilla stamina pool off, which freezes getStamina above
  // the load-adjusted ceiling it should never exceed. Reading it then is meaningless.
  const vanillaStaminaSimulated = () => {
    if (aceFatigue()) return false;
    const seconds = vanillaStamina().stamina;
    const max = sprintSecondsMax();
    return typeof seconds === "number" && !!max && seconds <= max + 0.5;
  };
  const staminaReserve = () =>
    aceFatigue()?.anaerobicReserve ?? (vanillaStaminaSimulated() ? sprintReserve() : undefined);
  const staminaSource = () =>
    aceFatigue() ? t("profile_stamina_source_ace") : t("profile_stamina_source_vanilla");
  const bodyParts = (): MedicalBodyPart[] => displayedBodyParts(medical()?.bodyParts ?? []);
  const treatments = (): TreatmentItem[] => medical()?.treatments ?? [];
  const activityLog = (): MedicalLogEntry[] => medical()?.activity ?? [];
  const quickView = (): MedicalLogEntry[] => medical()?.quickView ?? [];
  // ACE and KAT describe the same body far better than the engine does, so when they
  // are loaded their readings replace the vanilla hit point list instead of joining it.
  // Later medical mods replace earlier ones: vanilla → ACE → KAT.
  const spo2 = () => pickVital(vanillaMedical().spo2, aceMedical()?.spo2, katMedical()?.spo2);
  const openWoundParts = () =>
    bodyParts().filter((part) => part.items.some((item) => item.kind === "wound")).length;
  const vanillaHitPoints = () => {
    const names = vanillaMedical().hitPointNames;
    const damages = vanillaMedical().hitPointDamage;
    if (!Array.isArray(names) || !Array.isArray(damages)) return [];
    return names
      .map((name, i) => ({ name: String(name), damage: Number(damages[i] ?? 0) }))
      .filter((entry) => entry.damage > 0);
  };
  const yesNo = (value: unknown): string =>
    value === true ? t("profile_yes") : value === false ? t("profile_no") : String(value ?? "—");
  const missingSnapshotNote = (type: PlayerSnapshotType, labelKey: string): string => {
    const first = engine.eventManager.getFirstPlayerSnapshotFrame(snapshotUnitId(), type);
    if (first === undefined) return t("profile_missing", { label: t(labelKey) });
    return t("profile_first_at", { label: t(labelKey), frame: first });
  };
  const cardLabel = () =>
    props.unit.name
      ? t("profile_aria_named", { name: props.unit.name })
      : t("profile_aria", { id: props.unit.id });
  const traitSections = createMemo(() => traitGroups((diffing() ? toInventory() : inventory())?.traits));
  const traitChanges = createMemo(() => diffTraits(fromInventory()?.traits, toInventory()?.traits));
  const traitValue = (field: TraitField, value: unknown): string => {
    if (value === undefined || value === null || value === "") return t("profile_none");
    switch (field.kind) {
      case "bool":
        return value === true ? t("profile_yes") : value === false ? t("profile_no") : String(value);
      case "level": {
        const key = traitLevelKey(field, value);
        return key ? t(key) : String(value);
      }
      case "number":
        return field.multiplier ? formatMultiplier(value) : String(value);
      default:
        return String(value);
    }
  };

  const killsAt = (frame: number) =>
    engine.eventManager.getKillDeathCounts(frame).kills.get(props.unit.id) ?? 0;
  const deathsAt = (frame: number) =>
    engine.eventManager.getKillDeathCounts(frame).deaths.get(props.unit.id) ?? 0;
  const metricNumber = (
    fromValue: number | undefined,
    toValue: number | undefined,
    digits = 0,
    asPercent = false,
  ): JSX.Element => {
    const fmt = (value: number | undefined) => {
      if (value === undefined) return "—";
      return asPercent ? percent(value) : number(value, digits);
    };
    if (!diffing()) return <>{fmt(toValue)}</>;
    const fromShown = fmt(fromValue);
    const toShown = fmt(toValue);
    if (fromShown === toShown) return <>{toShown}</>;
    if (fromValue === undefined || toValue === undefined) {
      return (
        <span class={styles.metricPair}>
          {fromShown} → {toShown}
        </span>
      );
    }
    const delta = toValue - fromValue;
    const deltaLabel = asPercent
      ? `${formatSigned(Math.round(delta * 100))}%`
      : formatSigned(delta, digits);
    return (
      <>
        <span class={styles.metricPair}>
          {fromShown} → {toShown}
        </span>
        <span
          classList={{
            [styles.metricDelta]: true,
            [styles.metricAdded]: delta > 0,
            [styles.metricRemoved]: delta < 0,
          }}
        >
          {deltaLabel}
        </span>
      </>
    );
  };

  return (
    <aside class={styles.card} aria-label={cardLabel()}>
      <header class={styles.header} style={{ "border-top-color": SIDE_COLORS_UI[engine.entitySnapshots().get(props.unit.id)?.side ?? props.unit.side] }}>
        <div>
          <div class={styles.eyebrow}>
            {props.unit.groupName || t("ungrouped")} ·{" "}
            {props.unit.role || (props.unit.isPlayer ? t("profile_role_player") : t("ai_label"))}
            <Show when={controllingHost()}>
              {(host) =>
                host().type
                  ? ` · ${t("zeus_controlling_typed", { name: host().name, type: host().type })}`
                  : ` · ${t("zeus_controlling", { name: host().name })}`
              }
            </Show>
          </div>
          <h2>
            {props.unit.name
              ? t("profile_title", { name: props.unit.name })
              : t("profile_title_unit", { id: props.unit.id })}
          </h2>
        </div>
        <button class={styles.close} onClick={props.onClose} aria-label={t("profile_close")}>
          ×
        </button>
      </header>

      <div class={styles.actions}>
        <button
          classList={{ [styles.active]: props.isFollowed }}
          onClick={() => props.onToggleFollow(props.unit.id)}
        >
          {props.isFollowed ? t("profile_following") : t("profile_follow")}
        </button>
        <button
          classList={{ [styles.active]: diffing() }}
          onClick={toggleDiff}
        >
          {diffing() ? t("profile_diffing") : t("profile_diff")}
        </button>
        <Show when={props.isAdmin && props.markerCount > 0}>
          <div class={styles.adminActions}>
            <span>{t("profile_admin_actions")}</span>
            <button
              title={t("profile_blacklist_toggle")}
              classList={{ [styles.danger]: props.isBlacklisted }}
              onClick={() => props.onToggleBlacklist?.(props.unit.id)}
            >
              {props.isBlacklisted
                ? t("profile_restore_markers", { count: props.markerCount })
                : t("profile_blacklist", { count: props.markerCount })}
            </button>
          </div>
        </Show>
      </div>

      <Show when={diffing()}>
        <div class={styles.diffBar}>
          <div class={styles.diffPin}>
            <span>{t("profile_diff_from")}</span>
            <strong title={t("profile_frame", { frame: fromFrame() })}>{frameLabel(fromFrame())}</strong>
            <button type="button" onClick={() => setFromFrame(engine.currentFrame())}>
              {t("profile_diff_pin_from")}
            </button>
          </div>
          <span class={styles.diffArrow}>→</span>
          <div class={styles.diffPin}>
            <span>
              {t("profile_diff_to")}
              <Show when={toPinned() === null}>{` · ${t("profile_diff_playhead")}`}</Show>
            </span>
            <strong title={t("profile_frame", { frame: toFrame() })}>{frameLabel(toFrame())}</strong>
            <button
              type="button"
              onClick={() =>
                toPinned() === null ? setToPinned(engine.currentFrame()) : setToPinned(null)
              }
            >
              {toPinned() === null ? t("profile_diff_pin_to") : t("profile_diff_follow")}
            </button>
          </div>
          <button type="button" class={styles.diffSwap} onClick={swapDiff}>
            {t("profile_diff_swap")}
          </button>
        </div>
      </Show>

      <div class={styles.metrics}>
        <Show when={props.showKillCount}>
          <div>
            <strong>
              {metricNumber(
                diffing() ? killsAt(fromFrame()) : undefined,
                diffing() ? killsAt(toFrame()) : props.kills,
              )}
            </strong>
            <span>{t("profile_kills")}</span>
          </div>
          <div>
            <strong>
              {metricNumber(
                diffing() ? deathsAt(fromFrame()) : undefined,
                diffing() ? deathsAt(toFrame()) : props.deaths,
              )}
            </strong>
            <span>{t("profile_deaths")}</span>
          </div>
        </Show>
        <div title={t("profile_rounds")}>
          <strong>
            {metricNumber(
              carriedMagazineRounds(fromInventory()?.magazines),
              carriedMagazineRounds(diffing() ? toInventory()?.magazines : inventory()?.magazines),
            )}
          </strong>
          <span>{t("profile_rounds")}</span>
        </div>
        <div title={t("profile_rounds_shot")}>
          <strong>
            {metricNumber(
              props.unit.firedCountThrough(fromFrame()),
              props.unit.firedCountThrough(diffing() ? toFrame() : engine.currentFrame()),
            )}
          </strong>
          <span>{t("profile_rounds_shot")}</span>
        </div>
        <div>
          <strong>{props.isBlacklisted ? 0 : props.markerCount}</strong>
          <span>{t("profile_markers")}</span>
        </div>
        <Show when={tabIsTracked("stamina") || tabIsTracked("gear")}>
          <div>
            <strong>
              {metricNumber(
                carriedWeightKg(fromStamina()?.vanilla) ?? carriedWeightKg(fromInventory()),
                carriedWeightKg((diffing() ? toStamina() : stamina())?.vanilla) ??
                  carriedWeightKg(diffing() ? toInventory() : inventory()),
                1,
              )}
            </strong>
            <span>{t("profile_weight")}</span>
          </div>
        </Show>
        <Show when={tabIsTracked("stamina")}>
          <div title={staminaSource()}>
            <strong>
              {metricNumber(
                reserveAt(fromStamina(), fromInventory()),
                reserveAt(diffing() ? toStamina() : stamina(), diffing() ? toInventory() : inventory()),
                0,
                true,
              )}
            </strong>
            <span>{t("profile_stamina")}</span>
          </div>
        </Show>
        <Show when={tabIsTracked("stamina") || tabIsTracked("gear")}>
          <div>
            <strong>
              {metricNumber(
                fromStamina()?.vanilla?.load ?? fromInventory()?.load,
                (diffing() ? toStamina() : stamina())?.vanilla?.load ??
                  (diffing() ? toInventory() : inventory())?.load,
                0,
                true,
              )}
            </strong>
            <span>{t("profile_load")}</span>
          </div>
        </Show>
      </div>

      <Show when={snapshotsLoading() && availableTabs().length === 0}>
        <div class={styles.loading}>{t("profile_loading")}</div>
      </Show>

      <Show when={availableTabs().length > 0}>
        <nav class={styles.tabs} role="tablist">
          <For each={availableTabs()}>
            {(entry) => (
              <button
                role="tab"
                aria-selected={tab() === entry.id}
                classList={{ [styles.activeTab]: tab() === entry.id }}
                onClick={() => setTab(entry.id)}
              >
                {t(entry.labelKey)}
              </button>
            )}
          </For>
        </nav>
      </Show>

      <div class={styles.scroll}>
        <Show when={tab() === "gear" && tabIsTracked("gear")}>
          <Show when={diffing() ? toInventory() : inventory()}>
            <div class={styles.exportActions}>
              <button type="button" onClick={() => copyGear("vanilla")}>
                <CopyIcon size={12} />
                {t("profile_export_arsenal")}
              </button>
              <button type="button" onClick={() => copyGear("ace")}>
                <CopyIcon size={12} />
                {t("profile_export_ace_arsenal")}
              </button>
            </div>
          </Show>
          <Show
            when={diffing()}
            fallback={
              <Show
                when={inventory()}
                fallback={
                  <div class={styles.noData}>{missingSnapshotNote("inventorySnapshot", "profile_label_gear")}</div>
                }
              >
                {(gear) => (
                  <>
                    <SnapshotMeta event={snapshotEvent("inventorySnapshot")} />
                    <div class={styles.equipped}>
                      <span>
                        {t("profile_head")}: {gearItemName(gear().headgear) || t("profile_none")}
                      </span>
                      <span>
                        {t("profile_face")}: {gearItemName(gear().goggles) || t("profile_none")}
                      </span>
                    </div>
                    <div class={styles.gearBlock}>
                      <div class={styles.blockTitle}>{t("profile_weapons")}</div>
                      <For each={weaponsInSlotOrder(gear().weapons)}>
                        {(weapon) => (
                          <div class={styles.weapon}>
                            <b>{gearItemName(weapon)}</b>
                            <small>{weapon.slot}</small>
                            <ItemList items={weapon.attachments} />
                          </div>
                        )}
                      </For>
                      <Show when={!gear().weapons.length}>
                        <span class={styles.empty}>{t("profile_none")}</span>
                      </Show>
                      <CategorizedItemSections
                        items={magazinesNotInContainers(gear())}
                        alwaysLabel
                      />
                    </div>
                    <Container label={t("profile_uniform")} container={gear().uniform} />
                    <Container label={t("profile_vest")} container={gear().vest} />
                    <Container label={t("profile_backpack")} container={gear().backpack} />
                    <div class={styles.gearBlock}>
                      <div class={styles.blockTitle}>{t("profile_assigned")}</div>
                      <ItemList items={gear().assignedItems} />
                    </div>
                  </>
                )}
              </Show>
            }
          >
            <Show
              when={!sameDiffFrame() && !gearDiffIsEmpty(gearChanges())}
              fallback={<DiffEmpty sameFrame={sameDiffFrame()} />}
            >
              <GearDiffView diff={gearChanges()} />
            </Show>
          </Show>
        </Show>

        <Show when={tab() === "medical" && tabIsTracked("medical")}>
          <Show when={diffing()}>
            <Show
              when={!sameDiffFrame() && !medicalDiffIsEmpty(medicalChanges())}
              fallback={<DiffEmpty sameFrame={sameDiffFrame()} />}
            >
              <MedicalDiffView diff={medicalChanges()} />
            </Show>
          </Show>
          <Show when={!diffing()}>
          <Show
            when={medical()}
            fallback={
              <div class={styles.noData}>{missingSnapshotNote("medicalSnapshot", "profile_label_medical")}</div>
            }
          >
            <SnapshotMeta event={snapshotEvent("medicalSnapshot")} />
            <div class={styles.medicalLayout}>
              <MedicalBodyImage
                parts={bodyParts()}
                kat={katMedical()}
                vanillaDamage={
                  typeof vanillaMedical().damage === "number"
                    ? (vanillaMedical().damage as number)
                    : undefined
                }
                selected={selectedPart()}
                onSelect={(part: BodyPartId) => setSelectedPart(part)}
              />
              <div class={styles.medicalReadings}>
                <Show when={aceMedical()} fallback={
                  <>
                    <div class={styles.dataGrid}>
                      <span>
                        {t("profile_damage")}
                        <b>{percent(vanillaMedical().damage)}</b>
                      </span>
                      <span>
                        {t("profile_life_state")}
                        <b>{String(vanillaMedical().lifeState ?? "—")}</b>
                      </span>
                      <span>
                        {t("profile_incapacitated")}
                        <b>{yesNo(vanillaMedical().incapacitated)}</b>
                      </span>
                    </div>
                    <div class={styles.gearBlock}>
                      <div class={styles.blockTitle}>{t("profile_hit_points")}</div>
                      <div class={styles.itemList}>
                        <For each={vanillaHitPoints()}>
                          {(hitPoint) => (
                            <span class={styles.itemChip}>
                              {hitPoint.name} {percent(hitPoint.damage)}
                            </span>
                          )}
                        </For>
                        <Show when={!vanillaHitPoints().length}>
                          <span class={styles.empty}>{t("profile_uninjured")}</span>
                        </Show>
                      </div>
                    </div>
                  </>
                }>
                  {(ace) => (
                    <>
                      <div class={styles.subheading}>{t("profile_ace_medical")}</div>
                      <div class={styles.dataGrid}>
                        <span>
                          {t("profile_blood")}
                          <b>{number(ace().bloodVolume, 2)} L</b>
                        </span>
                        <span>
                          {t("profile_heart_rate")}
                          <b>{number(ace().heartRate)} bpm</b>
                        </span>
                        <span>
                          {t("profile_blood_pressure")}
                          <b>
                            {formatBloodPressure(ace().bloodPressure, t("profile_no_blood_pressure"))}
                          </b>
                        </span>
                        <Show when={!katMedical() && typeof spo2() === "number"}>
                          <span>
                            {t("profile_spo2")}
                            <b>{number(spo2(), 1)}%</b>
                          </span>
                        </Show>
                        <span>
                          {t("profile_pain")}
                          <b>{percent(ace().pain)}</b>
                        </span>
                        <span>
                          {t("profile_bleeding")}
                          <b>{number(ace().bleedingRate, 2)}</b>
                        </span>
                        <span>
                          {t("profile_hemorrhage")}
                          <b>
                            {HEMORRHAGE_KEYS[Number(ace().hemorrhage ?? 0)]
                              ? t(HEMORRHAGE_KEYS[Number(ace().hemorrhage ?? 0)])
                              : number(ace().hemorrhage)}
                          </b>
                        </span>
                        <span>
                          {t("profile_unconscious")}
                          <b>{yesNo(ace().unconscious)}</b>
                        </span>
                        <span>
                          {t("profile_cardiac_arrest")}
                          <b>{yesNo(ace().cardiacArrest)}</b>
                        </span>
                        <span>
                          {t("profile_open_wound_parts")}
                          <b>{openWoundParts()}</b>
                        </span>
                      </div>
                    </>
                  )}
                </Show>
              </div>
            </div>
            <div class={styles.subheading}>{t("profile_body_parts")}</div>
            <div class={styles.bodyParts}>
              <For each={bodyParts()}>
                {(part) => (
                  <div
                    classList={{ [styles.bodyPartSelected]: selectedPart() === part.part }}
                    data-part={part.part}
                    onClick={() => setSelectedPart(part.part)}
                  >
                    <b>{BODY_PART_KEYS[part.part] ? t(BODY_PART_KEYS[part.part]) : part.part}</b>
                    <Show when={typeof part.damage === "number"}>
                      <span>{t("profile_dmg", { value: formatBodyPartDamage(part.damage) })}</span>
                    </Show>
                    <For each={part.items}>
                      {(item) => (
                        <span title={item.detail ? `${item.kind} · ${item.detail}` : item.kind}>
                          {item.name}
                          <Show when={(item.count ?? 1) > 1}> ×{item.count}</Show>
                        </span>
                      )}
                    </For>
                    <Show when={!part.items.length}>
                      <span class={styles.empty}>
                        {(part.damage ?? 0) > 0 ? t("profile_untreated") : t("profile_uninjured")}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={treatments().length || aceMedical()}>
              <div class={styles.gearBlock}>
                <div class={styles.blockTitle}>{t("profile_in_system")}</div>
                <TreatmentList items={treatments()} />
              </div>
            </Show>
            <Show when={katMedical()}>
              {(kat) => (
                <>
                  <div class={styles.subheading}>{t("profile_kat_medical")}</div>
                  <div class={styles.dataGrid}>
                    <span>
                      {t("profile_spo2")}
                      <b>{number(spo2(), 1)}%</b>
                    </span>
                    <span>
                      {t("profile_etco2")}
                      <b>{number(kat().etco2, 1)}</b>
                    </span>
                    <span>
                      {t("profile_breath_rate")}
                      <b>{number(kat().breathRate, 1)}</b>
                    </span>
                    <span>
                      {t("profile_blood_type")}
                      <b>{String(kat().bloodType || "—")}</b>
                    </span>
                    <span>
                      {t("profile_airway_secured")}
                      <b>{yesNo(kat().airwaySecured)}</b>
                    </span>
                    <span>
                      {t("profile_airway_item")}
                      <b>{String(kat().airwayItem || "—")}</b>
                    </span>
                    <span>
                      {t("profile_obstruction")}
                      <b>{yesNo(kat().airwayObstruction)}</b>
                    </span>
                    <span>
                      {t("profile_occluded")}
                      <b>{yesNo(kat().airwayOccluded)}</b>
                    </span>
                    <span>
                      {t("profile_pneumothorax")}
                      <b>{number(kat().pneumothorax)}</b>
                    </span>
                    <span>
                      {t("profile_chest_seal")}
                      <b>{yesNo(kat().chestSeal)}</b>
                    </span>
                    <span>
                      {t("profile_hemopneumothorax")}
                      <b>{yesNo(kat().hemopneumothorax)}</b>
                    </span>
                    <span>
                      {t("profile_tension_ptx")}
                      <b>{yesNo(kat().tensionPneumothorax)}</b>
                    </span>
                    <span>
                      {t("profile_internal_bleed")}
                      <b>{number(kat().internalBleeding, 2)}</b>
                    </span>
                  </div>
                </>
              )}
            </Show>
            <Show when={aceMedical() || activityLog().length || quickView().length}>
              <div class={styles.medicalLogs}>
                <MedicalLogList titleKey="profile_activity_log" entries={activityLog()} />
                <MedicalLogList titleKey="profile_quick_view" entries={quickView()} />
              </div>
            </Show>
          </Show>
        </Show>
        </Show>

        <Show when={tab() === "stamina" && tabIsTracked("stamina")}>
          <Show when={diffing()}>
            <Show
              when={!sameDiffFrame() && staminaChanges().length > 0}
              fallback={<DiffEmpty sameFrame={sameDiffFrame()} />}
            >
              <StaminaDiffView fields={staminaChanges()} />
            </Show>
          </Show>
          <Show when={!diffing()}>
          <Show
            when={stamina()}
            fallback={
              <div class={styles.noData}>{missingSnapshotNote("staminaSnapshot", "profile_label_stamina")}</div>
            }
          >
            <SnapshotMeta event={snapshotEvent("staminaSnapshot")} />
            <div class={styles.dataGrid}>
              <Show when={!aceFatigue()}>
                <span>
                  {t("profile_sprint_reserve")}
                  <b>
                    <Show when={vanillaStaminaSimulated()} fallback={t("profile_pool_not_simulated")}>
                      {t("profile_sprint_detail", {
                        percent: percent(sprintReserve()),
                        current: number(vanillaStamina().stamina, 1),
                        max: number(sprintSecondsMax(), 1),
                      })}
                    </Show>
                  </b>
                </span>
                <span>
                  {t("profile_fatigue")}
                  <b>{percent(vanillaStamina().fatigue)}</b>
                </span>
              </Show>
              <span>
                {t("profile_carried_weight")}
                <b>{number(weightKg(), 1)} kg</b>
              </span>
              <span>
                {t("profile_load")}
                <b>{percent(loadFraction())}</b>
              </span>
              <Show when={stanceLabelKey(vanillaStamina().stance)}>
                {(key) => (
                  <span>
                    {t("profile_stance")}
                    <b>{t(key())}</b>
                  </span>
                )}
              </Show>
            </div>
            <Show when={aceFatigue()}>
              {(ace) => (
                <>
                  <div class={styles.subheading}>{t("profile_ace_fatigue")}</div>
                  <div class={styles.dataGrid}>
                    <span>
                      {t("profile_anaerobic")}
                      <b>{percent(ace().anaerobicReserve)}</b>
                    </span>
                    <span>
                      {t("profile_aerobic")}
                      <b>{percent(ace().aerobicReserve)}</b>
                    </span>
                    <span>
                      {t("profile_muscle_damage")}
                      <b>{percent(ace().muscleDamage)}</b>
                    </span>
                    <span>
                      {t("profile_performance")}
                      <b>
                        {typeof ace().performanceFactor === "number"
                          ? `${ace().performanceFactor.toFixed(2)}×`
                          : "—"}
                      </b>
                    </span>
                  </div>
                </>
              )}
            </Show>
          </Show>
        </Show>
        </Show>

        <Show when={tab() === "radio" && tabIsTracked("radio")}>
          <Show when={diffing()}>
            <Show
              when={!sameDiffFrame() && !radioDiffIsEmpty(radioChanges())}
              fallback={<DiffEmpty sameFrame={sameDiffFrame()} />}
            >
              <RadioDiffView diff={radioChanges()} />
            </Show>
          </Show>
          <Show when={!diffing()}>
          <Show
            when={(radio()?.radios.length ?? 0) > 0}
            fallback={
              <div class={styles.noData}>
                {radio()
                  ? t("profile_no_radio")
                  : missingSnapshotNote("radioSnapshot", "profile_label_radio")}
              </div>
            }
          >
            <SnapshotMeta event={snapshotEvent("radioSnapshot")} />
            <For each={radio()?.radios ?? []}>
              {(entry, index) => {
                const key = () => radioKey(entry, index());
                return (
                  <div class={styles.radioRow}>
                    <div>
                      <b>{gearItemName(entry)}</b>
                      <span>
                        {entry.mod} {entry.type}
                        {entry.additional ? ` ${t("profile_radio_additional")}` : ""}
                        {entry.active ? ` ${t("profile_radio_active")}` : ""}
                        {" · "}
                        {t("profile_radio_channel", { channel: entry.channel })}
                      </span>
                    </div>
                    <strong>
                      {typeof entry.frequency === "number" ? entry.frequency.toFixed(3) : "—"} MHz
                    </strong>
                    <small>
                      {t("profile_radio_code", { code: entry.code || "—" })}
                      {" · "}
                      {((entry.rangeMeters || 0) / 1000).toFixed(1)} km
                      <Show when={typeof entry.powerMilliwatts === "number"}>
                        {` · ${((entry.powerMilliwatts ?? 0) / 1000).toFixed(1)} W`}
                      </Show>
                    </small>
                    <div class={styles.radioActions}>
                      <button
                        type="button"
                        classList={{
                          [styles.active]: rangeRadio() === key() && rangeMode() === "simple",
                        }}
                        onClick={() => selectRange(key(), "simple")}
                      >
                        {t("profile_simple_range")}
                      </button>
                      <button
                        type="button"
                        classList={{
                          [styles.active]: rangeRadio() === key() && rangeMode() === "approx",
                        }}
                        disabled={!approxAvailable()}
                        title={
                          approxAvailable()
                            ? t(entry.mod === "ACRE" ? "profile_approx_hint_acre" : "profile_approx_hint")
                            : t("profile_approx_unavailable")
                        }
                        onClick={() => selectRange(key(), "approx")}
                      >
                        {t("profile_approx_range")}
                      </button>
                    </div>
                    <Show when={entry.mod === "ACRE"}>
                      <small class={styles.radioHint}>{t("profile_range_acre_note")}</small>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </Show>
        </Show>

        <Show when={tab() === "traits" && tabIsTracked("traits")}>
          <Show when={diffing()}>
            <Show
              when={!sameDiffFrame() && traitChanges().length > 0}
              fallback={<DiffEmpty sameFrame={sameDiffFrame()} />}
            >
              <div class={styles.dataGrid} data-testid="profile-traits-diff">
                <For each={traitChanges()}>
                  {(entry) => (
                    <span>
                      {t(entry.labelKey)}
                      <b class={styles.fieldDelta}>
                        {traitValue(entry, entry.from)} → {traitValue(entry, entry.to)}
                      </b>
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </Show>
          <Show when={!diffing()}>
            <Show
              when={traitSections().length > 0}
              fallback={<div class={styles.noData}>{t("profile_traits_none")}</div>}
            >
              <SnapshotMeta event={snapshotEvent("inventorySnapshot")} />
              <div data-testid="profile-traits">
                <For each={traitSections()}>
                  {(group) => (
                    <div class={styles.traitGroup}>
                      <div class={styles.sectionLabel}>{t(group.titleKey)}</div>
                      <div class={styles.dataGrid}>
                        <For each={group.fields}>
                          {(field) => (
                            <span
                              classList={{
                                [styles.traitActive]:
                                  field.value === true || (field.kind === "level" && Number(field.value) > 0),
                              }}
                            >
                              {t(field.labelKey)}
                              <b>{traitValue(field, field.value)}</b>
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </aside>
  );
}
