import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { EventsTab } from "../components/EventsTab";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
  killedEvent,
  hitEvent,
  connectEvent,
  endMissionEvent,
} from "./test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventsTab", () => {
  it("shows 'no events' placeholder when no events exist", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef()]));

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
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    const victim = screen.getByText("BluforGuy");
    expect(victim.getAttribute("style")).toContain("var(--accent-blue)");

    const killer = screen.getByText("OpforGuy");
    expect(killer.getAttribute("style")).toContain("var(--accent-red)");
  });

  it("shows '(suicide)' when victimId equals causedById", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [unitDef({ id: 1, name: "SuicideGuy", side: "WEST" })];
    const events = [killedEvent(0, 1, 1, "Grenade", 0)];
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));

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
    engine.loadOperation(makeManifest(entities, events));
    engine.seekTo(10); // Seek past the event so it becomes active

    const seekSpy = vi.spyOn(engine, "seekTo");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Click the event row (find by victim name, then click the parent button)
    const victimEl = screen.getByText("Victim");
    const eventRow = victimEl.closest("button")!;
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
    engine.loadOperation(makeManifest(entities, events));
    engine.seekTo(15); // Both events active

    const { container } = render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <EventsTab />
      </TestProviders>
    ));

    // Get all event row buttons
    const buttons = container.querySelectorAll("button");
    // Filter to only event rows (the ones that contain event content, not filter buttons)
    const eventRows: Element[] = [];
    buttons.forEach((btn) => {
      if (btn.textContent?.includes("First") || btn.textContent?.includes("Third")) {
        eventRows.push(btn);
      }
    });

    // Third (frame 10) should come before First (frame 5) because of reverse order
    expect(eventRows.length).toBe(2);
    expect(eventRows[0].textContent).toContain("Third");
    expect(eventRows[1].textContent).toContain("First");
  });

  it("events become visible only after seeking to their frame", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "LateVictim", side: "WEST" }),
      unitDef({ id: 2, name: "LateKiller", side: "EAST" }),
    ];
    const events = [killedEvent(50, 1, 2, "M4A1", 100)];
    engine.loadOperation(makeManifest(entities, events));

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
});
