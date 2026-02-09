import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { EngineProvider } from "../../hooks/useEngine";
import { I18nProvider } from "../../hooks/useLocale";
import { RightPanel } from "../RightPanel";
import { EventItem } from "../EventItem";
import { EventList } from "../EventList";
import { HitKilledEvent } from "../../../playback/events/hit-killed-event";
import { ConnectEvent } from "../../../playback/events/connect-event";
import { EndMissionEvent } from "../../../playback/events/end-mission-event";
import { GeneralMissionEvent } from "../../../playback/events/general-event";
import { CapturedEvent } from "../../../playback/events/captured-event";
import { TerminalHackEvent } from "../../../playback/events/terminal-hack-event";
import { GameEvent } from "../../../playback/events/game-event";
import { setRightPanelVisible } from "../../shortcuts";

/**
 * Creates a mock PlaybackEngine with vi.fn() methods and createSignal-based signals.
 */
function createMockEngine(initialEvents: GameEvent[] = []) {
  const [activeEvents, setActiveEvents] = createSignal<GameEvent[]>(initialEvents);
  const [captureDelayMs] = createSignal(1000);
  const [currentFrame] = createSignal(0);
  const [isPlaying] = createSignal(false);
  const [playbackSpeed] = createSignal(1);
  const [entitySnapshots] = createSignal(new Map());
  const [followTarget] = createSignal<number | null>(null);
  const [counterState] = createSignal(null);
  const [endFrame] = createSignal(100);

  return {
    engine: {
      activeEvents: activeEvents as Accessor<GameEvent[]>,
      captureDelayMs,
      currentFrame,
      isPlaying,
      playbackSpeed,
      entitySnapshots,
      followTarget,
      counterState,
      endFrame,
      seekTo: vi.fn(),
      followEntity: vi.fn(),
      unfollowEntity: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      togglePlayPause: vi.fn(),
      setSpeed: vi.fn(),
      loadOperation: vi.fn(),
      dispose: vi.fn(),
      entityManager: { getAll: vi.fn().mockReturnValue([]) },
      eventManager: { getAll: vi.fn().mockReturnValue([]) },
    },
    setActiveEvents,
  };
}

describe("RightPanel", () => {
  beforeEach(() => {
    setRightPanelVisible(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders when rightPanelVisible is true", () => {
    const { engine } = createMockEngine();
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine as any}>
        <RightPanel />
      </EngineProvider></I18nProvider>
    ));
    expect(getByTestId("right-panel")).toBeDefined();
  });

  it("is hidden when rightPanelVisible is false", () => {
    setRightPanelVisible(false);
    const { engine } = createMockEngine();
    const { queryByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine as any}>
        <RightPanel />
      </EngineProvider></I18nProvider>
    ));
    expect(queryByTestId("right-panel")).toBeNull();
  });

  it("contains event list", () => {
    const { engine } = createMockEngine();
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine as any}>
        <RightPanel />
      </EngineProvider></I18nProvider>
    ));
    expect(getByTestId("event-list")).toBeDefined();
  });

  it("contains header and filter sections", () => {
    const { engine } = createMockEngine();
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine as any}>
        <RightPanel />
      </EngineProvider></I18nProvider>
    ));
    expect(getByTestId("right-panel-header")).toBeDefined();
    expect(getByTestId("right-panel-filters")).toBeDefined();
  });
});

describe("EventList", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders events from activeEvents signal", () => {
    const events: GameEvent[] = [
      new HitKilledEvent(10, "killed", 0, 1, 2, 150, "M4A1"),
      new ConnectEvent(5, "connected", 1, "Player1"),
    ];
    const { engine } = createMockEngine(events);
    const { getAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={true} showConnectEvents={true} filterText="" />
      </EngineProvider>
    ));
    const items = getAllByTestId("event-item");
    expect(items).toHaveLength(2);
  });

  it("renders events in reverse chronological order (newest at top)", () => {
    const event1 = new ConnectEvent(5, "connected", 0, "EarlyPlayer");
    const event2 = new HitKilledEvent(10, "killed", 1, 1, 2, 100, "AK47");
    event2.victimName = "Victim1";
    event2.causerName = "Attacker1";
    const event3 = new ConnectEvent(20, "disconnected", 2, "LatePlayer");

    const events = [event1, event2, event3];
    const { engine } = createMockEngine(events);
    const { getAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={true} showConnectEvents={true} filterText="" />
      </EngineProvider>
    ));

    const items = getAllByTestId("event-item");
    expect(items).toHaveLength(3);

    // Newest (frame 20) should be first
    expect(items[0].getAttribute("data-event-type")).toBe("disconnected");
    // Middle (frame 10) should be second
    expect(items[1].getAttribute("data-event-type")).toBe("killed");
    // Oldest (frame 5) should be last
    expect(items[2].getAttribute("data-event-type")).toBe("connected");
  });

  it("renders empty list when no events", () => {
    const { engine } = createMockEngine([]);
    const { getByTestId, queryAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={true} showConnectEvents={true} filterText="" />
      </EngineProvider>
    ));
    expect(getByTestId("event-list")).toBeDefined();
    expect(queryAllByTestId("event-item")).toHaveLength(0);
  });

  it("updates when activeEvents signal changes", () => {
    const { engine, setActiveEvents } = createMockEngine([]);
    const { queryAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={true} showConnectEvents={true} filterText="" />
      </EngineProvider>
    ));

    expect(queryAllByTestId("event-item")).toHaveLength(0);

    // Add events dynamically
    setActiveEvents([
      new ConnectEvent(10, "connected", 0, "NewPlayer"),
    ]);

    expect(queryAllByTestId("event-item")).toHaveLength(1);
  });

  it("filters out hit events when showHitEvents is false but keeps killed events", () => {
    const events: GameEvent[] = [
      new HitKilledEvent(10, "hit", 0, 1, 2, 150, "M4A1"),
      new HitKilledEvent(15, "killed", 1, 3, 4, 200, "AK47"),
      new ConnectEvent(5, "connected", 2, "Player1"),
    ];
    const { engine } = createMockEngine(events);
    const { getAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={false} showConnectEvents={true} filterText="" />
      </EngineProvider>
    ));
    const items = getAllByTestId("event-item");
    // "hit" event filtered out, but "killed" and "connected" remain
    expect(items).toHaveLength(2);
    const types = items.map((i) => i.getAttribute("data-event-type"));
    expect(types).toContain("killed");
    expect(types).toContain("connected");
    expect(types).not.toContain("hit");
  });

  it("filters out connect events when showConnectEvents is false", () => {
    const kill = new HitKilledEvent(10, "killed", 0, 1, 2, 150, "M4A1");
    kill.victimName = "V";
    kill.causerName = "A";
    const events: GameEvent[] = [
      kill,
      new ConnectEvent(5, "connected", 1, "Player1"),
    ];
    const { engine } = createMockEngine(events);
    const { getAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={true} showConnectEvents={false} filterText="" />
      </EngineProvider>
    ));
    const items = getAllByTestId("event-item");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("data-event-type")).toBe("killed");
  });

  it("filters events by text search", () => {
    const kill = new HitKilledEvent(10, "killed", 0, 1, 2, 150, "M4A1");
    kill.victimName = "AlphaPlayer";
    kill.causerName = "BravoPlayer";
    const connect = new ConnectEvent(5, "connected", 1, "CharliePlayer");
    const events: GameEvent[] = [kill, connect];
    const { engine } = createMockEngine(events);
    const { getAllByTestId, queryAllByTestId } = render(() => (
      <EngineProvider engine={engine as any}>
        <EventList showHitEvents={true} showConnectEvents={true} filterText="charlie" />
      </EngineProvider>
    ));
    const items = queryAllByTestId("event-item");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("data-event-type")).toBe("connected");
  });
});

describe("EventItem", () => {
  afterEach(() => {
    cleanup();
  });

  describe("HitKilledEvent rendering", () => {
    it("renders killed event with victim, attacker, and details line", () => {
      const event = new HitKilledEvent(60, "killed", 0, 1, 2, 250.7, "M4A1");
      event.victimName = "VictimPlayer";
      event.causerName = "AttackerPlayer";
      event.victimSide = "WEST";
      event.causerSide = "EAST";

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-victim").textContent).toBe("VictimPlayer");
      expect(getByTestId("event-causer").textContent).toBe("AttackerPlayer");
      expect(getByTestId("event-action").textContent).toBe(" killed by ");
      // Details line: time - distance - weapon
      expect(getByTestId("event-details").textContent).toBe("0:01:00 - 251m - M4A1");
    });

    it("renders hit event with correct action text", () => {
      const event = new HitKilledEvent(30, "hit", 0, 1, 2, 100, "RPG");
      event.victimName = "Target";
      event.causerName = "Shooter";

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-action").textContent).toBe(" hit by ");
    });

    it("applies side CSS classes to names (no side- prefix)", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "BluforUnit";
      event.causerName = "OpforUnit";
      event.victimSide = "WEST";
      event.causerSide = "EAST";

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-victim").classList.contains("blufor")).toBe(true);
      expect(getByTestId("event-causer").classList.contains("opfor")).toBe(true);
    });

    it("calls seekTo and followEntity on click", () => {
      const event = new HitKilledEvent(42, "killed", 0, 5, 3, 200, "M16");
      event.victimName = "Dead";
      event.causerName = "Killer";

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      fireEvent.click(getByTestId("event-item"));

      expect(engine.seekTo).toHaveBeenCalledWith(42);
      expect(engine.followEntity).toHaveBeenCalledWith(5);
    });

    it("shows fallback names when entity references not resolved", () => {
      const event = new HitKilledEvent(10, "killed", 0, 7, 8, 100, "Rifle");
      // No victimName or causerName set

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-victim").textContent).toBe("Unit #7");
      expect(getByTestId("event-causer").textContent).toBe("Unit #8");
    });
  });

  describe("ConnectEvent rendering", () => {
    it("renders connected event with unit name", () => {
      const event = new ConnectEvent(15, "connected", 0, "JohnDoe");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-unit-name").textContent).toContain("connected");
      expect(getByTestId("event-unit-name").textContent).toContain("JohnDoe");
      expect(getByTestId("event-details").textContent).toBe("0:00:15");
    });

    it("renders disconnected event correctly", () => {
      const event = new ConnectEvent(90, "disconnected", 0, "JaneDoe");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-unit-name").textContent).toContain("disconnected");
    });

    it("does not call seekTo or followEntity on click (connect events are not clickable)", () => {
      const event = new ConnectEvent(25, "connected", 0, "Player");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      fireEvent.click(getByTestId("event-item"));

      expect(engine.seekTo).not.toHaveBeenCalled();
      expect(engine.followEntity).not.toHaveBeenCalled();
    });
  });

  describe("event item visibility", () => {
    it("event items have reveal class for visibility", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "Victim";
      event.causerName = "Attacker";

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      const item = getByTestId("event-item");
      expect(item.classList.contains("reveal")).toBe(true);
    });

    it("connect event items have reveal class", () => {
      const event = new ConnectEvent(10, "connected", 0, "Player1");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      const item = getByTestId("event-item");
      expect(item.classList.contains("reveal")).toBe(true);
    });
  });

  describe("kill score display", () => {
    it("shows kill score after attacker name for non-vehicle kills", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "Victim";
      event.causerName = "Attacker";
      event.causerKillScore = 3;
      event.victimIsVehicle = false;

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-kill-score").textContent).toBe(" (3 kills)");
    });

    it("shows negative kill score for team killers", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "Victim";
      event.causerName = "TeamKiller";
      event.causerKillScore = -2;
      event.victimIsVehicle = false;

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-kill-score").textContent).toBe(" (-2 kills)");
    });

    it("does not show kill score for vehicle kills", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "Humvee";
      event.causerName = "Attacker";
      event.causerKillScore = 5;
      event.victimIsVehicle = true;

      const { engine } = createMockEngine();
      const { queryByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(queryByTestId("event-kill-score")).toBeNull();
    });

    it("does not show kill score when causerKillScore is not set", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "Victim";
      event.causerName = "Attacker";
      // causerKillScore not set

      const { engine } = createMockEngine();
      const { queryByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(queryByTestId("event-kill-score")).toBeNull();
    });

    it("shows zero kill score", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "Victim";
      event.causerName = "Attacker";
      event.causerKillScore = 0;
      event.victimIsVehicle = false;

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-kill-score").textContent).toBe(" (0 kills)");
    });
  });

  describe("side class mapping", () => {
    it("maps GUER to ind class", () => {
      const event = new HitKilledEvent(10, "killed", 0, 1, 2, 50, "AK47");
      event.victimName = "IndUnit";
      event.victimSide = "GUER";
      event.causerName = "CivUnit";
      event.causerSide = "CIV";

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-victim").classList.contains("ind")).toBe(true);
      expect(getByTestId("event-causer").classList.contains("civ")).toBe(true);
    });
  });

  describe("EndMissionEvent rendering", () => {
    it("renders end mission with side and message", () => {
      const event = new EndMissionEvent(100, 0, "EAST", "OPFOR wins!");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-item").getAttribute("data-event-type")).toBe("endMission");
      expect(getByTestId("event-side").textContent).toContain("EAST");
      expect(getByTestId("event-side").classList.contains("opfor")).toBe(true);
      expect(getByTestId("event-message").textContent).toBe("OPFOR wins!");
    });
  });

  describe("GeneralMissionEvent rendering", () => {
    it("renders general event with message", () => {
      const event = new GeneralMissionEvent(50, 0, "Mission has started!");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-item").getAttribute("data-event-type")).toBe("generalEvent");
      expect(getByTestId("event-message").textContent).toBe("Mission has started!");
    });
  });

  describe("CapturedEvent rendering", () => {
    it("renders flag capture event", () => {
      const event = new CapturedEvent(30, "capturedFlag", 0, "John", "flag");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-item").getAttribute("data-event-type")).toBe("capturedFlag");
      expect(getByTestId("event-unit-name").textContent).toBe("John");
      expect(getByTestId("event-item").textContent).toContain("captured the flag");
    });

    it("renders object capture event", () => {
      const event = new CapturedEvent(30, "captured", 0, "John", "radio");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-item").textContent).toContain("captured radio");
    });
  });

  describe("TerminalHackEvent rendering", () => {
    it("renders terminal hack started event", () => {
      const event = new TerminalHackEvent(40, "terminalHackStarted", 0, "Hacker");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-item").getAttribute("data-event-type")).toBe("terminalHackStarted");
      expect(getByTestId("event-unit-name").textContent).toBe("Hacker");
      expect(getByTestId("event-item").textContent).toContain("is hacking terminal");
    });

    it("renders terminal hack canceled event", () => {
      const event = new TerminalHackEvent(45, "terminalHackCanceled", 0, "Hacker");

      const { engine } = createMockEngine();
      const { getByTestId } = render(() => (
        <EngineProvider engine={engine as any}>
          <EventItem event={event} engine={engine as any} />
        </EngineProvider>
      ));

      expect(getByTestId("event-item").textContent).toContain("interrupted hack");
    });
  });
});
