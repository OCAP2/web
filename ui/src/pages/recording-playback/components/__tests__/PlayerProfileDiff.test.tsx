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
