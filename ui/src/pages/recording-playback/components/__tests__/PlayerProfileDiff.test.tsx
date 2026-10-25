import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { formatSigned, GearDiffView } from "../PlayerProfileDiff";
import type { GearDiff } from "../../profileDiff";

// I18nProvider is required by useI18n; use the real one with en locale.
import { I18nProvider } from "../../../../hooks/useLocale";

describe("formatSigned", () => {
  it("formats zero without a sign", () => {
    expect(formatSigned(0)).toBe("0");
  });

  it("prefixes positive values with plus", () => {
    expect(formatSigned(5)).toBe("+5");
  });

  it("prefixes negative values with a minus (U+2212)", () => {
    expect(formatSigned(-5)).toBe("−5");
  });

  it("keeps decimals when digits are requested", () => {
    expect(formatSigned(1.456, 2)).toBe("+1.46");
    expect(formatSigned(-1.456, 2)).toBe("−1.46");
  });
});

const emptyDiff: GearDiff = {
  net: [],
  moved: [],
  equipped: [],
  weapons: [],
  locations: [],
};

function renderGear(props: { diff: GearDiff }) {
  render(() => (
    <I18nProvider locale="en">
      <GearDiffView diff={props.diff} />
    </I18nProvider>
  ));
}

describe("GearDiffView", () => {
  it("renders nothing for an empty diff", () => {
    renderGear({ diff: emptyDiff });
    expect(screen.queryByText("Net changes")).toBeNull();
    expect(screen.queryByText("Moved")).toBeNull();
    expect(screen.queryByText("Weapons")).toBeNull();
  });

  it("renders net item changes", () => {
    renderGear({
      diff: {
        ...emptyDiff,
        net: [
          { polarity: "added", class: "CUP_G36", name: "G36", fromCount: 0, toCount: 1 },
          { polarity: "removed", class: "Rnd_556", name: "5.56mm", fromCount: 30, toCount: 0 },
        ],
      },
    });
    expect(screen.getByText("Net changes")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("G36"))).toBeTruthy();
    expect(screen.getByText((t) => t.includes("5.56mm"))).toBeTruthy();
  });

  it("renders moved items", () => {
    renderGear({
      diff: {
        ...emptyDiff,
        moved: [{ class: "ACE_fieldDressing", name: "Field dressing", count: 2, from: "uniform", to: "vest" }],
      },
    });
    expect(screen.getByText("Moved")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("Field dressing"))).toBeTruthy();
  });

  it("renders equipped changes with a from → to arrow", () => {
    renderGear({
      diff: {
        ...emptyDiff,
        equipped: [
          { polarity: "changed", slotKey: "profile_vest", fromName: "Old vest", toName: "New vest" },
        ],
      },
    });
    expect(screen.getByText((t) => t.includes("Old vest") && t.includes("New vest"))).toBeTruthy();
  });

  it("renders weapon changes with attachments", () => {
    renderGear({
      diff: {
        ...emptyDiff,
        weapons: [
          {
            polarity: "added",
            slot: "Primary",
            fromName: "",
            toName: "M4",
            attachments: [
              { polarity: "added", class: "optic_aco", name: "ACO", fromCount: 0, toCount: 1 },
            ],
          },
        ],
      },
    });
    expect(screen.getByText("Weapons")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("M4"))).toBeTruthy();
    expect(screen.getByText((t) => t.includes("ACO"))).toBeTruthy();
  });

  it("renders a gear location with its items and container delta", () => {
    renderGear({
      diff: {
        ...emptyDiff,
        locations: [
          {
            location: "vest",
            container: { polarity: "changed", slotKey: "profile_vest", fromName: "", toName: "Assault vest" },
            items: [
              { polarity: "added", class: "HandGrenade", name: "Hand grenade", fromCount: 0, toCount: 1 },
            ],
          },
        ],
      },
    });
    expect(screen.getByText("Vest")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("Assault vest"))).toBeTruthy();
    expect(screen.getByText((t) => t.includes("Hand grenade"))).toBeTruthy();
  });
});

import { MedicalDiffView, RadioDiffView, StaminaDiffView, DiffEmpty } from "../PlayerProfileDiff";
import type { MedicalDiff, RadioDiff, FieldDelta } from "../../profileDiff";

function renderView(ui: () => import("solid-js").JSX.Element) {
  render(() => <I18nProvider locale="en">{ui()}</I18nProvider>);
}

const field = (labelKey: string, kind: FieldDelta["kind"], from: unknown, to: unknown, extra: Partial<FieldDelta> = {}): FieldDelta => ({
  labelKey,
  kind,
  from,
  to,
  ...extra,
});

describe("MedicalDiffView", () => {
  it("renders nothing when the diff is empty", () => {
    renderView(() => (
      <I18nProvider locale="en">
        <MedicalDiffView diff={{ fields: [], bodyParts: [], treatments: [], activity: [], quickView: [] }} />
      </I18nProvider>
    ));
    expect(screen.queryByText("Body parts")).toBeNull();
    expect(screen.queryByText("In the system")).toBeNull();
    expect(screen.queryByText("New since then")).toBeNull();
  });

  it("formats every field kind through the grid", () => {
    const diff: MedicalDiff = {
      fields: [
        field("profile_heart_rate", "number", 80, 92),
        field("profile_pain", "percent", 0.25, 0.5),
        field("profile_blood", "bool", false, true),
        field("profile_pressure", "bp", [0, 0], [120, 80]),
        field("profile_hemorrhage", "hemorrhage", 0, 2),
        field("profile_stance", "stance", 1, 3),
        field("profile_note", "text", "old", "new"),
      ],
      bodyParts: [],
      treatments: [],
      activity: [],
      quickView: [],
    };
    renderView(() => (
      <I18nProvider locale="en">
        <MedicalDiffView diff={diff} />
      </I18nProvider>
    ));

    // number
    expect(screen.getByText((t) => t.includes("80 → 92"))).toBeTruthy();
    // percent
    expect(screen.getByText((t) => t.includes("25% → 50%"))).toBeTruthy();
    // bool
    expect(screen.getByText((t) => t.includes("No → Yes"))).toBeTruthy();
    // bp: zero/zero falls back to the none label, a real pressure renders
    expect(screen.getByText((t) => t.includes("No pressure → 80/120"))).toBeTruthy();
    // hemorrhage levels
    expect(screen.getByText((t) => t.includes("→ Class II"))).toBeTruthy();
    // stance keys map through their labels
    expect(screen.getByText((t) => t.includes("Standing → Prone"))).toBeTruthy();
    // plain values pass through
    expect(screen.getByText((t) => t.includes("old → new"))).toBeTruthy();
  });

  it("renders body parts with damage and items", () => {
    const diff: MedicalDiff = {
      fields: [],
      bodyParts: [
        {
          part: "head",
          damage: field("profile_damage", "percent", 0.1, 0.9),
          items: [{ polarity: "removed", class: "bandage", name: "Bandage", fromCount: 2, toCount: 0 }],
        },
        { part: "torsolog", damage: undefined, items: [] },
      ],
      treatments: [],
      activity: [],
      quickView: [],
    };
    renderView(() => (
      <I18nProvider locale="en">
        <MedicalDiffView diff={diff} />
      </I18nProvider>
    ));
    expect(screen.getByText("Body parts")).toBeTruthy();
    expect(screen.getByText("Head")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("10% → 90%"))).toBeTruthy();
    expect(screen.getByText("torsolog")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("Bandage"))).toBeTruthy();
  });

  it("lists treatments, activity and quick view entries", () => {
    const diff: MedicalDiff = {
      fields: [],
      bodyParts: [],
      treatments: [{ polarity: "added", class: "morphine", name: "Morphine", fromCount: 0, toCount: 1 }],
      activity: [{ time: "12:00", text: "Bandage applied" }],
      quickView: [{ time: "12:01", text: "Pain reduced" }],
    };
    renderView(() => (
      <I18nProvider locale="en">
        <MedicalDiffView diff={diff} />
      </I18nProvider>
    ));
    expect(screen.getByText("In the system")).toBeTruthy();
    expect(screen.getByText("New since then")).toBeTruthy();
    expect(screen.getByText("Quick view")).toBeTruthy();
    expect(screen.getByText("Bandage applied")).toBeTruthy();
    expect(screen.getByText("Pain reduced")).toBeTruthy();
  });

  it("renders item rounds deltas for each polarity", () => {
    const diff: MedicalDiff = {
      fields: [],
      bodyParts: [],
      treatments: [
        { polarity: "added", class: "mag", name: "Mag", fromCount: 0, toCount: 2, toRounds: 30 },
        { polarity: "removed", class: "mag", name: "Spent", fromCount: 1, toCount: 0, fromRounds: 30 },
        { polarity: "changed", class: "mag", name: "Partial", fromCount: 1, toCount: 1, fromRounds: 10, toRounds: 25 },
        { polarity: "changed", class: "mag", name: "Unknown rounds", fromCount: 1, toCount: 1 },
      ],
      activity: [],
      quickView: [],
    };
    renderView(() => (
      <I18nProvider locale="en">
        <MedicalDiffView diff={diff} />
      </I18nProvider>
    ));
    expect(screen.getByText((t) => t.includes("+ Mag") && t.includes("×2") && t.includes("30 rds"))).toBeTruthy();
    expect(screen.getByText((t) => t.includes("− Spent") && t.includes("×1") && t.includes("30 rds"))).toBeTruthy();
    expect(screen.getByText((t) => t.includes("Partial") && t.includes("10 → 25"))).toBeTruthy();
    // Without round counts there is no rounds suffix at all.
    expect(screen.queryByText((t) => t.includes("Unknown rounds") && t.includes("rds"))).toBeNull();
  });
});

describe("RadioDiffView", () => {
  it("marks each radio row with its polarity", () => {
    const diff: RadioDiff = {
      radios: [
        { polarity: "added", name: "PRC-343", fields: [field("profile_radio_freq", "number", 0, 2560)] },
        { polarity: "removed", name: "PRC-152", fields: [] },
        { polarity: "changed", name: "BF-888S", fields: [] },
      ],
    };
    renderView(() => (
      <I18nProvider locale="en">
        <RadioDiffView diff={diff} />
      </I18nProvider>
    ));
    expect(screen.getByText("PRC-343")).toBeTruthy();
    expect(screen.getByText("PRC-152")).toBeTruthy();
    expect(screen.getByText("BF-888S")).toBeTruthy();
    expect(screen.getByText((t) => t.includes("0 → 2560"))).toBeTruthy();
  });
});

describe("StaminaDiffView and DiffEmpty", () => {
  it("renders stamina fields through the same grid", () => {
    renderView(() => (
      <I18nProvider locale="en">
        <StaminaDiffView fields={[field("profile_weight", "number", 30, 35, { digits: 1, suffix: " kg" })]} />
      </I18nProvider>
    ));
    expect(screen.getByText((t) => t.includes("30.0 kg → 35.0 kg"))).toBeTruthy();
  });

  it("tells apart same-frame and empty diffs", () => {
    renderView(() => (
      <I18nProvider locale="en">
        <DiffEmpty sameFrame={true} />
      </I18nProvider>
    ));
    expect(screen.getByText("Scrub the timeline to pick the other time.")).toBeTruthy();
  });

  it("explains when there are no changes at all", () => {
    renderView(() => (
      <I18nProvider locale="en">
        <DiffEmpty sameFrame={false} />
      </I18nProvider>
    ));
    expect(screen.getByText("No changes in this tab.")).toBeTruthy();
  });
});
