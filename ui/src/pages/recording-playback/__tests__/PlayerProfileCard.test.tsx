import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { PlayerProfileCard } from "../components/PlayerProfileCard";
import { Unit } from "../../../playback/entities/unit";
import type { EventDef, WorldConfig } from "../../../data/types";
import { createTestEngine, TestProviders, unitDef, makeManifest } from "./testHelpers";

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

function snapshotEvent(
  frameNum: number,
  type: "inventorySnapshot" | "staminaSnapshot" | "medicalSnapshot" | "radioSnapshot",
  payload: Record<string, unknown>,
): EventDef {
  return { type, frameNum, payload: { unitId: 1, ...payload } } as unknown as EventDef;
}

function renderCard(
  events: EventDef[],
  frame = 10,
  world?: WorldConfig,
  extra?: { framesFired?: Array<[number, [number, number]]> },
) {
  const { engine, renderer } = createTestEngine();
  if (world) engine.setWorldConfig(world);
  const unitPositions = Array.from({ length: frame + 1 }, () => ({
    position: [100, 200] as [number, number],
    direction: 0,
    alive: 1 as const,
  }));
  engine.loadRecording(
    makeManifest(
      [
        unitDef({
          id: 1,
          name: "Rifleman",
          positions: unitPositions,
          framesFired: extra?.framesFired,
        }),
      ],
      events,
    ),
  );
  engine.seekTo(frame);
  const unit = engine.entityManager.getEntity(1) as Unit;

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <PlayerProfileCard
        unit={unit}
        kills={0}
        deaths={0}
        markerCount={0}
        isBlacklisted={false}
        isFollowed={false}
        isAdmin={false}
        showKillCount={true}
        onClose={() => {}}
        onToggleFollow={() => {}}
      />
    </TestProviders>
  ));
  return { engine, renderer };
}

describe("PlayerProfileCard", () => {
  it("offers a Traits tab listing every recorded trait", () => {
    renderCard([
      snapshotEvent(5, "inventorySnapshot", {
        weapons: [],
        magazines: [],
        assignedItems: [],
        traits: {
          medic: true,
          engineer: false,
          uavHacker: false,
          loadCoef: 0.9,
          custom: { pilot: true },
          ace: { medic: 2, engineer: 1, eod: true },
        },
      }),
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Traits" }));
    const text = screen.getByTestId("profile-traits").textContent ?? "";
    expect(text).toContain("Engine traits");
    expect(text).toContain("MedicYes");
    expect(text).toContain("EngineerNo");
    expect(text).toContain("ACE training");
    expect(text).toContain("Medical levelDoctor");
    expect(text).toContain("Engineer levelEngineer");
    expect(text).toContain("EODYes");
    expect(text).toContain("Load×0.9");
    expect(text).toContain("Custom traits");
    expect(text).toContain("pilotYes");
  });

  it("does not offer a Traits tab when the recording carries no traits", () => {
    renderCard([snapshotEvent(5, "inventorySnapshot", { weapons: [], magazines: [], assignedItems: [] })]);
    expect(screen.queryByRole("tab", { name: "Traits" })).toBeNull();
    expect(screen.queryByTestId("profile-traits")).toBeNull();
  });


  it("exports the visible gear from buttons shown only on the gear tab", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderCard([
      snapshotEvent(5, "inventorySnapshot", {
        uniform: { class: "U_B_CombatUniform_mcam", items: [] },
        vest: { class: "", items: [] },
        backpack: { class: "", items: [] },
        headgear: { class: "" },
        goggles: { class: "" },
        weapons: [],
        magazines: [],
        assignedItems: [],
      }),
      snapshotEvent(5, "medicalSnapshot", { vanilla: { damage: 0 } }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Export to Arsenal" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain('this forceAddUniform "U_B_CombatUniform_mcam";');

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));
    expect(screen.queryByRole("button", { name: "Export to Arsenal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export to ACE Arsenal" })).toBeNull();
  });

  it("converts Arma mass units to kilograms", () => {
    renderCard([
      snapshotEvent(5, "staminaSnapshot", {
        vanilla: { massUnits: 545, load: 0.545, stamina: 26.6, staminaMax: 27.3 },
      }),
    ]);

    expect(screen.getByText("24.7")).toBeTruthy();
  });

  it("shows vanilla stamina as a share of the load-adjusted maximum", () => {
    renderCard([
      snapshotEvent(5, "staminaSnapshot", {
        vanilla: { massUnits: 545, load: 0.545, stamina: 13.65, staminaMax: 27.3 },
      }),
    ]);

    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("prefers the ACE anaerobic reserve when advanced fatigue is recorded", () => {
    renderCard([
      snapshotEvent(5, "staminaSnapshot", {
        vanilla: { massUnits: 100, load: 0.1, stamina: 54, staminaMax: 54 },
        ace: { anaerobicReserve: 0.42, aerobicReserve: 1, muscleDamage: 0, performanceFactor: 2 },
      }),
    ]);

    expect(screen.getAllByText("42%").length).toBeGreaterThan(0);
  });

  it("does not read the vanilla pool that ACE froze above its ceiling", () => {
    renderCard([
      snapshotEvent(5, "staminaSnapshot", {
        vanilla: { massUnits: 545, load: 0.545, stamina: 60, staminaMax: 27.3 },
        ace: { anaerobicReserve: 0.87, aerobicReserve: 1, muscleDamage: 0, performanceFactor: 2 },
      }),
    ]);

    expect(screen.getAllByText("87%").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Stamina" }));

    expect(screen.getByText("ACE Advanced Fatigue")).toBeTruthy();
    expect(screen.queryByText("Sprint reserve")).toBeNull();
    expect(screen.queryByText("Fatigue")).toBeNull();
    expect(screen.queryByText(/60\.0 s of/)).toBeNull();
  });

  it("prints ACE blood pressure as systolic/diastolic", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0 },
        ace: { bloodVolume: 6, heartRate: 80, bloodPressure: [80, 120] },
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("120/80")).toBeTruthy();
    expect(screen.queryByText("80/120")).toBeNull();
  });

  it("shows no pressure instead of 0/0 during cardiac arrest", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0 },
        ace: { bloodVolume: 5.7, heartRate: 0, bloodPressure: [0, 0], cardiacArrest: true, unconscious: true },
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("No pressure")).toBeTruthy();
    expect(screen.queryByText("0/0")).toBeNull();
  });

  it("lists every body part even when they are uninjured", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0 },
        ace: { bloodVolume: 6, heartRate: 80 },
        bodyParts: [
          { part: "head", damage: 0, items: [] },
          { part: "body", damage: 0, items: [] },
          { part: "leftarm", damage: 0, items: [] },
          { part: "rightarm", damage: 0, items: [] },
          { part: "leftleg", damage: 0, items: [] },
          { part: "rightleg", damage: 0, items: [] },
        ],
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("Head")).toBeTruthy();
    expect(screen.getByText("Torso")).toBeTruthy();
    expect(screen.getByText("L Arm")).toBeTruthy();
    expect(screen.getByText("R Arm")).toBeTruthy();
    expect(screen.getByText("L Leg")).toBeTruthy();
    expect(screen.getByText("R Leg")).toBeTruthy();
    expect(screen.getAllByText("Uninjured").length).toBe(6);
    expect(screen.getAllByText("Dmg 0%").length).toBe(6);
  });

  it("caps ACE body-part trauma at 100 percent", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0 },
        ace: { bloodVolume: 5, heartRate: 0 },
        bodyParts: [{ part: "head", damage: 2.02, items: [{ kind: "wound", name: "Large Velocity Wound", count: 2 }] }],
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("Dmg 100%")).toBeTruthy();
    expect(screen.queryByText("Dmg 202%")).toBeNull();
  });

  it("replaces the vanilla hit point list with ACE readings when ACE is loaded", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0.25, lifeState: "HEALTHY", hitPointNames: ["hithead"], hitPointDamage: [0.3] },
        ace: { bloodVolume: 5.1, heartRate: 133, pain: 0.4, hemorrhage: 2 },
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("ACE Medical")).toBeTruthy();
    expect(screen.getByText("Class II")).toBeTruthy();
    expect(screen.queryByText("Life state")).toBeNull();
    expect(screen.queryByText("Damaged hit points")).toBeNull();
  });

  it("prefers the KAT oxygen saturation over the ACE one", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0 },
        ace: { bloodVolume: 6, heartRate: 80, spo2: 97 },
        kat: { spo2: 81.4, etco2: 30 },
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("81.4%")).toBeTruthy();
    expect(screen.queryByText("97.0%")).toBeNull();
  });

  it("renders whatever treatments a body part carries without knowing their kind", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0.2 },
        ace: { bloodVolume: 5, heartRate: 90 },
        bodyParts: [
          { part: "head", damage: 0, items: [] },
          {
            part: "body",
            damage: 0.45,
            items: [
              { kind: "bandage", name: "Bandaged wound", count: 3 },
              { kind: "iv", name: "Saline IV (250ml)", detail: "180 ml left" },
              { kind: "somethingNew", name: "Experimental patch" },
            ],
          },
        ],
        treatments: [{ kind: "medication", name: "Morphine", count: 2 }],
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("Torso")).toBeTruthy();
    expect(screen.getByText(/Bandaged wound/)).toBeTruthy();
    expect(screen.getByText(/Saline IV \(250ml\)/)).toBeTruthy();
    expect(screen.getByText(/Experimental patch/)).toBeTruthy();
    expect(screen.getByText(/Morphine/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Body diagram" })).toBeTruthy();
    expect(document.querySelector('[data-overlay="chestSeal"]')).toBeNull();
  });

  it("draws ACE/KAT treatment icons on the body diagram", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0.2 },
        ace: { bloodVolume: 5, heartRate: 90 },
        kat: { pneumothorax: 1, chestSeal: true },
        bodyParts: [
          {
            part: "body",
            damage: 0.4,
            items: [{ kind: "chestSeal", name: "Chest seal" }],
          },
          {
            part: "rightarm",
            damage: 0,
            items: [{ kind: "tourniquet", name: "Tourniquet" }],
          },
        ],
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(document.querySelector('[data-overlay="chestSeal"]')).toBeTruthy();
    expect(document.querySelector('[data-overlay="pneumothorax"]')).toBeTruthy();
    expect(document.querySelector('[data-overlay="tourniquet:rightarm"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Torso" }));
    expect(document.querySelector('[data-overlay="selected:body"]')).toBeTruthy();
  });

  it("prints ACE activity and quick-view lines the way the medical menu does", () => {
    renderCard([
      snapshotEvent(5, "medicalSnapshot", {
        vanilla: { damage: 0.2 },
        ace: { bloodVolume: 5, heartRate: 0 },
        activity: [
          { time: "10:02", text: "Matthew Allen has bandaged patient" },
          { time: "10:02", text: "Matthew Allen applied a tourniquet" },
        ],
        quickView: [{ time: "10:02", text: "Matthew Allen checked Heart Rate: None" }],
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.getByText("Activity log")).toBeTruthy();
    expect(screen.getByText("Quick view")).toBeTruthy();
    expect(screen.getByText("Matthew Allen has bandaged patient")).toBeTruthy();
    expect(screen.getByText("Matthew Allen applied a tourniquet")).toBeTruthy();
    expect(screen.getByText("Matthew Allen checked Heart Rate: None")).toBeTruthy();
    expect(screen.getAllByText("10:02").length).toBe(3);
  });

  it("rebuilds a diff-encoded snapshot when the playhead sits on it", () => {
    renderCard(
      [
        snapshotEvent(5, "radioSnapshot", {
          playerUid: "uid",
          radios: [
            {
              class: "TFAR_anprc152_1",
              mod: "TFAR",
              type: "SW",
              channel: 1,
              frequency: 472.8,
              code: "",
              rangeMeters: 5000,
              additional: false,
            },
          ],
        }),
        snapshotEvent(20, "radioSnapshot", {
          diffOf: 5,
          set: { radios: [{ class: "TFAR_anprc152_1", mod: "TFAR", type: "SW", channel: 3, frequency: 101, code: "", rangeMeters: 2000, additional: false }] },
        }),
      ],
      20,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Radios" }));

    expect(screen.getByText("101.000 MHz")).toBeTruthy();
    expect(screen.getByText(/2\.0 km/)).toBeTruthy();
  });

  it("offers simple and approximate range buttons", () => {
    const { renderer } = renderCard([
      snapshotEvent(5, "radioSnapshot", {
        radios: [
          {
            class: "TFAR_anprc152_1",
            mod: "TFAR",
            type: "SW",
            channel: 1,
            frequency: 472.8,
            code: "",
            rangeMeters: 5000,
            additional: false,
          },
        ],
      }),
    ]);
    const createSpy = vi.spyOn(renderer, "createBriefingMarker");

    fireEvent.click(screen.getByRole("tab", { name: "Radios" }));

    expect(screen.getByRole("button", { name: "Simple range" })).toBeTruthy();
    const approx = screen.getByRole("button", { name: "Approximate range" });
    expect(approx).toBeTruthy();
    expect(approx.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Simple range" }));
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        shape: "ELLIPSE",
        size: [5000, 5000],
        brush: "SolidBorder",
        layer: "systemMarkers",
      }),
    );
  });

  it("enables approximate range when the map has elevation", () => {
    renderCard(
      [
        snapshotEvent(5, "radioSnapshot", {
          radios: [
            {
              class: "TFAR_anprc152_1",
              mod: "TFAR",
              type: "SW",
              channel: 1,
              frequency: 472.8,
              code: "",
              rangeMeters: 5000,
              additional: false,
            },
          ],
        }),
      ],
      10,
      {
        worldName: "Altis",
        worldSize: 30720,
        maxZoom: 6,
        minZoom: 0,
        tileBaseUrl: "http://maps.test/altis",
        hasDem: true,
      },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Radios" }));
    expect(screen.getByRole("button", { name: "Approximate range" }).hasAttribute("disabled")).toBe(false);
  });

  it("notes that ACRE coverage uses ACRE terrain loss", () => {
    renderCard([
      snapshotEvent(5, "radioSnapshot", {
        radios: [
          {
            class: "ACRE_PRC152",
            mod: "ACRE",
            type: "SR",
            channel: 1,
            frequency: 60,
            code: "",
            rangeMeters: 5000,
            additional: false,
            powerMilliwatts: 5000,
          },
        ],
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Radios" }));
    expect(screen.getByText("Approximate range uses ACRE terrain loss")).toBeTruthy();
  });

  it("points at the first snapshot instead of implying the data is missing", () => {
    renderCard([snapshotEvent(50, "inventorySnapshot", { weapons: [], magazines: [], assignedItems: [] })], 10);

    expect(screen.getByText("First gear snapshot is at frame 50. Scrub forward to see it.")).toBeTruthy();
  });

  it("hides untracked snapshot tabs and metrics when a unit has none", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef({ id: 2, name: "Allen", isPlayer: false })], []));
    const unit = engine.entityManager.getEntity(2) as Unit;

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <PlayerProfileCard
          unit={unit}
          kills={0}
          deaths={0}
          markerCount={0}
          isBlacklisted={false}
          isFollowed={false}
          isAdmin={false}
          showKillCount={true}
          onClose={() => {}}
          onToggleFollow={() => {}}
        />
      </TestProviders>
    ));

    expect(screen.getByText("Follow")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Gear")).toBeNull();
    expect(screen.queryByText("Medical")).toBeNull();
    expect(screen.queryByText("Radios")).toBeNull();
    expect(screen.queryByText(/weight/i)).toBeNull();
    expect(screen.queryByText("No gear snapshot was recorded for this player.")).toBeNull();
  });

  it("only lists snapshot tabs that exist for the unit", () => {
    renderCard([snapshotEvent(5, "medicalSnapshot", { vanilla: { damage: 0.1, lifeState: "HEALTHY" } })]);

    expect(screen.getByRole("tab", { name: "Medical" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Gear" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Stamina" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Radios" })).toBeNull();
    expect(screen.getByText("Life state")).toBeTruthy();
  });

  it("marks the selected tab as selected", () => {
    renderCard([
      snapshotEvent(5, "inventorySnapshot", { weapons: [], magazines: [], assignedItems: [] }),
      snapshotEvent(5, "medicalSnapshot", { vanilla: { damage: 0.25, lifeState: "HEALTHY" } }),
    ]);

    expect(screen.getByRole("tab", { name: "Gear" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));
    expect(screen.getByRole("tab", { name: "Medical" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Gear" }).getAttribute("aria-selected")).toBe("false");
  });

  it("shows one snapshot category at a time and switches on tab click", () => {
    renderCard([
      snapshotEvent(5, "inventorySnapshot", { weapons: [], magazines: [], assignedItems: [] }),
      snapshotEvent(5, "medicalSnapshot", { vanilla: { damage: 0.25, lifeState: "HEALTHY" } }),
    ]);

    expect(screen.getByText("Weapons")).toBeTruthy();
    expect(screen.queryByText("Life state")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Medical" }));

    expect(screen.queryByText("Weapons")).toBeNull();
    expect(screen.getByText("Life state")).toBeTruthy();
  });

  it("lists magazines inside their containers instead of a duplicate magazines block", () => {
    renderCard([
      snapshotEvent(5, "inventorySnapshot", {
        weapons: [
          {
            class: "hlc_pistol_P226R_Combat",
            slot: "handgun",
            attachments: [],
          },
        ],
        magazines: [
          { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 5 },
          { class: "ACE_16Rnd_9x19_mag", cat: "magazines", count: 2 },
          { class: "hlc_15Rnd_9x19_B_P226", cat: "magazines", count: 1, loadedCount: 1 },
          { class: "kat_Painkiller", cat: "medical", count: 3 },
        ],
        assignedItems: [],
        uniform: {
          class: "UK3CB_BAF_U_CombatUniform_MTP_RM",
          items: [
            { class: "ACE_MapTools", count: 1 },
            { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 1 },
          ],
        },
        vest: {
          class: "UK3CB_BAF_V_Osprey_SL_A",
          items: [
            { class: "ACE_CableTie", count: 2 },
            { class: "ACE_16Rnd_9x19_mag", cat: "magazines", count: 2 },
            { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 4 },
          ],
        },
        backpack: {
          class: "UK3CB_BAF_B_Bergen_MTP_SL_L_A",
          items: [
            { class: "ACE_packingBandage", cat: "medical", count: 17 },
            { class: "kat_Painkiller", cat: "medical", count: 3 },
          ],
        },
      }),
    ]);

    const weaponsBlock = screen.getByText("Weapons").closest("[class*='gearBlock']");
    expect(weaponsBlock?.nextElementSibling?.textContent).toContain("Uniform");
    expect(weaponsBlock?.textContent).toContain("Hlc 15Rnd 9x19 B P226");

    const uniformBlock = screen.getByText("U Combat Uniform MTP RM").closest("[class*='gearBlock']");
    expect(uniformBlock?.textContent).toContain("Magazines");
    expect(uniformBlock?.textContent).toContain("Items");
    expect(uniformBlock?.textContent).toContain("Mag 30Rnd 556x45 Mk318 PMAG");
    expect(uniformBlock?.textContent).toContain("Map Tools");

    const vestBlock = screen.getByText("V Osprey SL A").closest("[class*='gearBlock']");
    expect(vestBlock?.textContent).toContain("Magazines");
    expect(vestBlock?.textContent).toContain("16Rnd 9x19 Mag ×2");
    expect(vestBlock?.textContent).toContain("Mag 30Rnd 556x45 Mk318 PMAG ×4");
    expect(vestBlock?.textContent).toContain("Cable Tie ×2");

    const backpackBlock = screen.getByText("B Bergen MTP SL L A").closest("[class*='gearBlock']");
    expect(backpackBlock?.textContent).toContain("Medical");
    expect(backpackBlock?.textContent).not.toContain("Magazines");
    expect(backpackBlock?.textContent).toContain("Painkiller ×3");
    expect(backpackBlock?.textContent).toContain("Packing Bandage ×17");

    expect(screen.getAllByText("Magazines").every((el) => el.className.includes("sectionLabel"))).toBe(true);
  });

  it("re-splits container magazines when a later snapshot fills them in", () => {
    const { engine } = renderCard(
      [
        snapshotEvent(5, "inventorySnapshot", {
          weapons: [],
          magazines: [],
          assignedItems: [],
          vest: { class: "Osprey", items: [] },
        }),
        snapshotEvent(20, "inventorySnapshot", {
          weapons: [],
          magazines: [{ class: "30Rnd", cat: "magazines", count: 4 }],
          assignedItems: [],
          vest: {
            class: "Osprey",
            items: [
              { class: "ACE_CableTie", count: 2 },
              { class: "30Rnd", cat: "magazines", count: 4 },
            ],
          },
        }),
      ],
      5,
    );

    expect(screen.queryByText("Magazines")).toBeNull();
    expect(screen.queryByText("30Rnd ×4")).toBeNull();

    engine.seekTo(20);

    const vestBlock = screen.getByText("Osprey").closest("[class*='gearBlock']");
    expect(vestBlock?.textContent).toContain("Magazines");
    expect(vestBlock?.textContent).toContain("Items");
    expect(vestBlock?.textContent).toContain("30Rnd ×4");
    expect(vestBlock?.textContent).toContain("Cable Tie ×2");
  });

  it("splits grenades and medical inside a container and sorts each group", () => {
    renderCard([
      snapshotEvent(5, "inventorySnapshot", {
        weapons: [],
        magazines: [
          { class: "HandGrenade", cat: "grenades", count: 1 },
          { class: "SmokeShell", cat: "grenades", count: 2 },
          { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 4 },
          { class: "kat_Painkiller", cat: "medical", count: 3 },
        ],
        assignedItems: [],
        vest: {
          class: "Osprey",
          items: [
            { class: "ACE_CableTie", count: 2 },
            { class: "SmokeShell", cat: "grenades", count: 2 },
            { class: "ACE_splint", cat: "medical", count: 2 },
            { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 4 },
            { class: "HandGrenade", cat: "grenades", count: 1 },
            { class: "ACE_adenosine", cat: "medical", count: 1 },
            { class: "ACE_MapTools", count: 1 },
          ],
        },
      }),
    ]);

    const vestBlock = screen.getByText("Osprey").closest("[class*='gearBlock']");
    const text = vestBlock?.textContent ?? "";
    expect(text).toContain("Magazines");
    expect(text).toContain("Grenades");
    expect(text).toContain("Medical");
    expect(text).toContain("Items");
    expect(text.indexOf("Magazines")).toBeLessThan(text.indexOf("Grenades"));
    expect(text.indexOf("Grenades")).toBeLessThan(text.indexOf("Medical"));
    expect(text.indexOf("Medical")).toBeLessThan(text.indexOf("Items"));
    expect(text.indexOf("Hand Grenade")).toBeLessThan(text.indexOf("Smoke Shell"));
    expect(text.indexOf("Adenosine")).toBeLessThan(text.indexOf("Splint"));
    expect(text.indexOf("Cable Tie")).toBeLessThan(text.indexOf("Map Tools"));
  });

  it("shows carried magazine rounds after deaths, skipping grenades and medical", () => {
    renderCard([
      snapshotEvent(5, "inventorySnapshot", {
        weapons: [],
        magazines: [
          { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 5, totalRounds: 120 },
          { class: "ACE_16Rnd_9x19_mag", cat: "magazines", count: 2, totalRounds: 34 },
          { class: "HandGrenade", cat: "grenades", count: 1, totalRounds: 1 },
          { class: "kat_Painkiller", cat: "medical", count: 3, totalRounds: 20 },
        ],
        assignedItems: [],
      }),
    ]);

    const deaths = screen.getByText("Deaths");
    const rounds = screen.getByText("Rounds");
    expect(deaths.compareDocumentPosition(rounds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rounds.previousElementSibling?.textContent).toBe("154");
  });

  it("counts recorded shots up to the playhead next to rounds", () => {
    const { engine } = renderCard(
      [
        snapshotEvent(5, "inventorySnapshot", {
          weapons: [],
          magazines: [{ class: "30Rnd", count: 4, totalRounds: 90 }],
          assignedItems: [],
        }),
      ],
      10,
      undefined,
      {
        framesFired: [
          [5, [100, 200]],
          [8, [110, 210]],
          [20, [120, 220]],
        ],
      },
    );

    const shot = screen.getByText("Shot");
    expect(shot.previousElementSibling?.textContent).toBe("2");

    engine.seekTo(20);
    expect(shot.previousElementSibling?.textContent).toBe("3");
  });

  it("compares two times after Diff is pinned and the playhead moves", () => {
    const { engine } = renderCard(
      [
        snapshotEvent(5, "inventorySnapshot", {
          weapons: [],
          magazines: [{ class: "30Rnd", cat: "magazines", count: 5, totalRounds: 120 }],
          assignedItems: [],
          vest: {
            class: "v",
            items: [{ class: "30Rnd", cat: "magazines", count: 5 }],
          },
        }),
        snapshotEvent(20, "inventorySnapshot", {
          weapons: [],
          magazines: [{ class: "30Rnd", cat: "magazines", count: 2, totalRounds: 40 }],
          assignedItems: [],
          vest: {
            class: "v",
            items: [{ class: "30Rnd", cat: "magazines", count: 2 }],
          },
        }),
      ],
      5,
    );

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(screen.getByRole("button", { name: "Diffing" })).toBeTruthy();
    expect(screen.getByText("Scrub the timeline to pick the other time.")).toBeTruthy();

    engine.seekTo(20);
    expect(screen.getByText("Net changes")).toBeTruthy();
    expect(screen.getByText("30Rnd ×5 → ×2 · 120 → 40 rds")).toBeTruthy();
    expect(screen.queryByText("30Rnd ×5 → ×2")).toBeNull();
  });

  it("reports a vest-to-backpack shuffle as moved instead of gained and lost", () => {
    const { engine } = renderCard(
      [
        snapshotEvent(5, "inventorySnapshot", {
          weapons: [],
          magazines: [],
          assignedItems: [],
          vest: {
            class: "v",
            items: [{ class: "ACE_MapTools", count: 1 }],
          },
          backpack: { class: "b", items: [] },
        }),
        snapshotEvent(20, "inventorySnapshot", {
          weapons: [],
          magazines: [],
          assignedItems: [],
          vest: { class: "v", items: [] },
          backpack: {
            class: "b",
            items: [{ class: "ACE_MapTools", count: 1 }],
          },
        }),
      ],
      5,
    );

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    engine.seekTo(20);
    expect(screen.getByText("Moved")).toBeTruthy();
    expect(screen.getByText(/Map Tools/)).toBeTruthy();
    expect(screen.getByText(/Vest → Backpack/)).toBeTruthy();
    expect(screen.queryByText("Net changes")).toBeNull();
  });
});
