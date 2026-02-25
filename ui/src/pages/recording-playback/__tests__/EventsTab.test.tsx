import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { EventsTab } from "../components/EventsTab";
import type { EventDef } from "../../../data/types";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
  killedEvent,
  hitEvent,
  connectEvent,
  endMissionEvent,
} from "./testHelpers";

/** Create a generalEvent definition. */
function generalEvent(frameNum: number, message: string): EventDef {
  return { type: "generalEvent", frameNum, message } as EventDef;
}

/** Create a captured event definition. */
function capturedEvent(
  frameNum: number,
  unitName: string,
  objectType: string,
): EventDef {
  return { type: "captured", frameNum, unitName, objectType } as EventDef;
}

/** Create a terminalHack event definition. */
function terminalHackEvent(
  frameNum: number,
  type: "terminalHackStarted" | "terminalHackCanceled",
  unitName: string,
): EventDef {
  return { type, frameNum, unitName } as EventDef;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventsTab", () => {
  it("shows 'no events' placeholder when no events exist", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef()]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText("No events to display")).toBeTruthy();
  });

  it("shows killed event with victim and killer names", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "Player1", side: "WEST" }),
      unitDef({ id: 2, name: "Player2", side: "EAST" }),
    ];
    const events = [killedEvent(0, 1, 2, "AK-47", 150)];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText("Player1")).toBeTruthy();
    expect(screen.getByText("Player2")).toBeTruthy();
    expect(screen.getByText("AK-47")).toBeTruthy();
    expect(screen.getByText("150m")).toBeTruthy();
  });

  it("shows victim and killer with correct side colors", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "BluforGuy", side: "WEST" }),
      unitDef({ id: 2, name: "OpforGuy", side: "EAST" }),
    ];
    const events = [killedEvent(0, 1, 2)];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const victim = screen.getByText("BluforGuy");
    expect(victim.getAttribute("style")).toContain("var(--side-blufor)");

    const killer = screen.getByText("OpforGuy");
    expect(killer.getAttribute("style")).toContain("var(--side-opfor)");
  });

  it("shows '(suicide)' when victimId equals causedById", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "SuicideGuy", side: "WEST" })];
    const events = [killedEvent(0, 1, 1, "Grenade", 0)];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText("SuicideGuy")).toBeTruthy();
    expect(screen.getByText("(suicide)")).toBeTruthy();
  });

  it("hides hit events by default", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "Victim", side: "WEST" }),
      unitDef({ id: 2, name: "Shooter", side: "EAST" }),
    ];
    const events = [hitEvent(0, 1, 2, "M4A1", 50)];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Hit events hidden by default, so we see the no-events placeholder
    expect(screen.getByText("No events to display")).toBeTruthy();
  });

  it("shows hit events after toggling the Hits filter button", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "Victim", side: "WEST" }),
      unitDef({ id: 2, name: "Shooter", side: "EAST" }),
    ];
    const events = [hitEvent(0, 1, 2, "M4A1", 50)];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Toggle hits on
    fireEvent.click(screen.getByText("Hits"));

    // Now the hit event should be visible
    expect(screen.getByText("Victim")).toBeTruthy();
    expect(screen.getByText("Shooter")).toBeTruthy();
    expect(screen.queryByText("No events to display")).toBeNull();
  });

  it("hides connect/disconnect events by default", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Player1" })];
    const events = [connectEvent(0, "connected", "Player1")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Connection events hidden by default
    expect(screen.getByText("No events to display")).toBeTruthy();
  });

  it("shows connect events after toggling the Connections filter button", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Player1" })];
    const events = [connectEvent(0, "connected", "JoinedPlayer")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Toggle connections on
    fireEvent.click(screen.getByText("Conn"));

    // Now the connect event should be visible
    expect(screen.getByText(/JoinedPlayer/)).toBeTruthy();
    expect(screen.getByText(/connected/)).toBeTruthy();
    expect(screen.queryByText("No events to display")).toBeNull();
  });

  it("text search filters events by name", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "Alpha", side: "WEST" }),
      unitDef({ id: 2, name: "Bravo", side: "EAST" }),
      unitDef({ id: 3, name: "Charlie", side: "WEST" }),
    ];
    const events = [
      killedEvent(0, 1, 2, "AK-47", 100),
      killedEvent(0, 3, 2, "M4A1", 200),
    ];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Both events visible initially
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Charlie")).toBeTruthy();

    // Type "Alpha" in search
    const input = screen.getByPlaceholderText("Search events...");
    fireEvent.input(input, { target: { value: "Alpha" } });

    // Only the event involving Alpha should remain
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Charlie")).toBeNull();
  });

  it("clicking an event calls seekTo", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "Victim", side: "WEST" }),
      unitDef({ id: 2, name: "Killer", side: "EAST" }),
    ];
    const events = [killedEvent(5, 1, 2, "M4A1", 100)];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(10); // Seek past the event so it becomes active

    const seekSpy = vi.spyOn(engine, "seekTo");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Click the event row
    const eventRow = screen.getByTestId("event-row-5");
    fireEvent.click(eventRow);

    expect(seekSpy).toHaveBeenCalledWith(5);
  });

  it("displays events in reverse order (newest first)", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "First", side: "WEST" }),
      unitDef({ id: 2, name: "Second", side: "EAST" }),
      unitDef({ id: 3, name: "Third", side: "WEST" }),
    ];
    const events = [
      killedEvent(5, 1, 2, "AK-47", 100),
      killedEvent(10, 3, 2, "M4A1", 200),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(15); // Both events active

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Event rows have data-testid="event-row-{frameNum}"
    const row10 = screen.getByTestId("event-row-10");
    const row5 = screen.getByTestId("event-row-5");

    // Third (frame 10) should come before First (frame 5) because of reverse order
    expect(row10.textContent).toContain("Third");
    expect(row5.textContent).toContain("First");
    // Verify DOM order: frame 10 comes first
    expect(row10.compareDocumentPosition(row5) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("events become visible only after seeking to their frame", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "LateVictim", side: "WEST" }),
      unitDef({ id: 2, name: "LateKiller", side: "EAST" }),
    ];
    const events = [killedEvent(50, 1, 2, "M4A1", 100)];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // At frame 0, the event at frame 50 is not yet active
    expect(screen.getByText("No events to display")).toBeTruthy();

    // Seek to frame 50
    engine.seekTo(50);

    // Now the event should be visible
    expect(screen.getByText("LateVictim")).toBeTruthy();
    expect(screen.queryByText("No events to display")).toBeNull();
  });

  it("renders EndMissionEvent with side and message", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [endMissionEvent(0, "WEST", "BLUFOR wins")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText("WEST")).toBeTruthy();
    expect(screen.getByText("BLUFOR wins")).toBeTruthy();
  });

  it("renders EndMissionEvent with GUER and CIV sides using correct colors", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [
      endMissionEvent(0, "GUER", "IND wins"),
      endMissionEvent(1, "CIV", "Civilians saved"),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const guerSide = screen.getByText("GUER");
    expect(guerSide.getAttribute("style")).toContain("var(--side-ind)");

    const civSide = screen.getByText("CIV");
    expect(civSide.getAttribute("style")).toContain("var(--side-civ)");
  });

  it("renders GeneralMissionEvent with message text", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [generalEvent(0, "Objective Alpha completed")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText("Objective Alpha completed")).toBeTruthy();
  });

  it("renders CapturedEvent with unit name and object type", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [capturedEvent(0, "CapGuy", "flag")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText(/CapGuy/)).toBeTruthy();
    expect(screen.getByText(/flag/)).toBeTruthy();
  });

  it("renders TerminalHackEvent with started message", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [terminalHackEvent(0, "terminalHackStarted", "HackerGuy")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText(/HackerGuy/)).toBeTruthy();
    expect(screen.getByText(/started hacking/)).toBeTruthy();
  });

  it("renders TerminalHackEvent with canceled message", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [terminalHackEvent(0, "terminalHackCanceled", "CancelGuy")];
    engine.loadRecording(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    expect(screen.getByText(/CancelGuy/)).toBeTruthy();
    expect(screen.getByText(/canceled hack/)).toBeTruthy();
  });

  it("text search filters EndMissionEvent by message", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [
      endMissionEvent(0, "WEST", "BLUFOR wins"),
      endMissionEvent(1, "EAST", "OPFOR defeated"),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search events...");
    fireEvent.input(input, { target: { value: "BLUFOR" } });

    expect(screen.getByText("BLUFOR wins")).toBeTruthy();
    expect(screen.queryByText("OPFOR defeated")).toBeNull();
  });

  it("text search filters GeneralMissionEvent by message", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [
      generalEvent(0, "Alpha objective done"),
      generalEvent(1, "Bravo objective done"),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search events...");
    fireEvent.input(input, { target: { value: "Alpha" } });

    expect(screen.getByText("Alpha objective done")).toBeTruthy();
    expect(screen.queryByText("Bravo objective done")).toBeNull();
  });

  it("text search filters CapturedEvent by unit name", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [
      capturedEvent(0, "AlphaCaptor", "flag"),
      capturedEvent(1, "BravoCaptor", "terminal"),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search events...");
    fireEvent.input(input, { target: { value: "AlphaCaptor" } });

    expect(screen.getByText(/AlphaCaptor/)).toBeTruthy();
    expect(screen.queryByText(/BravoCaptor/)).toBeNull();
  });

  it("text search filters TerminalHackEvent by unit name", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Soldier" })];
    const events = [
      terminalHackEvent(0, "terminalHackStarted", "AlphaHacker"),
      terminalHackEvent(1, "terminalHackStarted", "BravoHacker"),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search events...");
    fireEvent.input(input, { target: { value: "AlphaHacker" } });

    expect(screen.getByText(/AlphaHacker/)).toBeTruthy();
    expect(screen.queryByText(/BravoHacker/)).toBeNull();
  });

  it("text search filters ConnectEvent by unit name", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "Player1" })];
    const events = [
      connectEvent(0, "connected", "AlphaPlayer"),
      connectEvent(1, "connected", "BravoPlayer"),
    ];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Enable connection events
    fireEvent.click(screen.getByText("Conn"));

    const input = screen.getByPlaceholderText("Search events...");
    fireEvent.input(input, { target: { value: "AlphaPlayer" } });

    expect(screen.getByText(/AlphaPlayer/)).toBeTruthy();
    expect(screen.queryByText(/BravoPlayer/)).toBeNull();
  });
});
