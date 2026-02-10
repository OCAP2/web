import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { EngineProvider } from "../../hooks/useEngine";
import { TopPanel } from "../TopPanel";
import { AboutModal } from "../AboutModal";
import { I18nProvider } from "../../hooks/useLocale";
import { MissionModal } from "../MissionModal";
import { CounterDisplay } from "../CounterDisplay";
import { Hint, showHint, hintVisible } from "../Hint";
import type { Operation } from "../../../data/types";
import type { CounterState } from "../../../playback/events/counter-event";

// ─── Helpers ───

function createEngine(): PlaybackEngine {
  return new PlaybackEngine(new MockRenderer());
}

function withEngine(engine: PlaybackEngine, ui: () => any) {
  return () => <EngineProvider engine={engine}>{ui()}</EngineProvider>;
}

// ─── TopPanel ───

describe("TopPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders mission name", () => {
    const [name] = createSignal("Operation Thunder");
    const [opId] = createSignal<string | null>("123");
    const { getByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} />
    ));
    expect(getByTestId("mission-name").textContent).toBe("Operation Thunder");
  });

  it("renders info button always", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const { getByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} />
    ));
    expect(getByTestId("info-button")).toBeDefined();
    expect(getByTestId("info-button").textContent).toBe("i");
  });

  it("calls onInfoClick when info button clicked", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const onInfo = vi.fn();
    const { getByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} onInfoClick={onInfo} />
    ));
    fireEvent.click(getByTestId("info-button"));
    expect(onInfo).toHaveBeenCalledTimes(1);
  });

  it("share button copies URL with ?op= param to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const [name] = createSignal("Test Mission");
    const [opId] = createSignal<string | null>("op-42");
    const { getByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} />
    ));

    fireEvent.click(getByTestId("share-button"));

    expect(writeText).toHaveBeenCalledTimes(1);
    const calledUrl = writeText.mock.calls[0][0] as string;
    expect(calledUrl).toContain("?op=op-42");
  });

  it("hides share and download buttons when no operationId", () => {
    const [name] = createSignal("No Op");
    const [opId] = createSignal<string | null>(null);
    const { queryByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} />
    ));
    expect(queryByTestId("share-button")).toBeNull();
    expect(queryByTestId("download-button")).toBeNull();
  });

  it("download button has correct href using operationFilename", () => {
    const [name] = createSignal("DL Mission");
    const [opId] = createSignal<string | null>("42");
    const [opFilename] = createSignal<string | null>("my_mission");
    const { getByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} operationFilename={opFilename} />
    ));
    const link = getByTestId("download-button") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("data/my_mission.json.gz");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("download button falls back to operationId when no filename", () => {
    const [name] = createSignal("DL Mission");
    const [opId] = createSignal<string | null>("my-file");
    const { getByTestId } = render(() => (
      <TopPanel missionName={name} operationId={opId} />
    ));
    const link = getByTestId("download-button") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("data/my-file.json.gz");
    expect(link.hasAttribute("download")).toBe(true);
  });
});

// ─── AboutModal ───

describe("AboutModal", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ BuildVersion: "v1.2.3", BuildCommit: "abc123", BuildDate: "2026-01-01" }),
    } as Response);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders when open", () => {
    const [open] = createSignal(true);
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={() => {}} /></I18nProvider>
    ));
    expect(getByTestId("about-modal")).toBeDefined();
  });

  it("does not render when closed", () => {
    const [open] = createSignal(false);
    const { queryByTestId } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={() => {}} /></I18nProvider>
    ));
    expect(queryByTestId("about-modal")).toBeNull();
  });

  it("calls onClose when close button clicked", () => {
    const [open] = createSignal(true);
    const onClose = vi.fn();
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={onClose} /></I18nProvider>
    ));
    fireEvent.click(getByTestId("about-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows OCAP title and GitHub link", () => {
    const [open] = createSignal(true);
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={() => {}} /></I18nProvider>
    ));
    const modal = getByTestId("about-modal");
    expect(modal.textContent).toContain("Operation Capture And Playback");
    expect(modal.textContent).toContain("GitHub Link");
  });

  it("shows keyboard shortcuts", () => {
    const [open] = createSignal(true);
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={() => {}} /></I18nProvider>
    ));
    const modal = getByTestId("about-modal");
    expect(modal.textContent).toContain("Play/pause: space");
    expect(modal.textContent).toContain("Show/Hide left panel: E");
    expect(modal.textContent).toContain("Show/Hide right panel: R");
  });

  it("shows server version after fetch", async () => {
    const [open] = createSignal(true);
    const { findByText } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={() => {}} /></I18nProvider>
    ));
    const versionEl = await findByText(/v1\.2\.3/);
    expect(versionEl).toBeDefined();
  });

  it("shows extension and addon versions when provided", () => {
    const [open] = createSignal(true);
    const [extVer] = createSignal<string | undefined>("0.0.1");
    const [addonVer] = createSignal<string | undefined>("1.2.0");
    const { getByTestId } = render(() => (
      <I18nProvider locale="en">
        <AboutModal open={open} onClose={() => {}} extensionVersion={extVer} addonVersion={addonVer} />
      </I18nProvider>
    ));
    const modal = getByTestId("about-modal");
    expect(modal.textContent).toContain("Extension version: 0.0.1");
    expect(modal.textContent).toContain("Addon version: 1.2.0");
  });

  it("has language selector", () => {
    const [open] = createSignal(true);
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><AboutModal open={open} onClose={() => {}} /></I18nProvider>
    ));
    const select = getByTestId("language-select") as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.value).toBe("en");
    expect(select.options.length).toBe(5);
  });
});

// ─── MissionModal ───

describe("MissionModal", () => {
  const mockOperations: Operation[] = [
    {
      id: "1",
      worldName: "Altis",
      missionName: "Op Alpha",
      missionDuration: 3600,
      date: "2024-01-01",
    },
    {
      id: "2",
      worldName: "Stratis",
      missionName: "Op Bravo",
      missionDuration: 1800,
      date: "2024-02-01",
    },
  ];

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          mockOperations.map((op) => ({
            id: Number(op.id),
            world_name: op.worldName,
            mission_name: op.missionName,
            mission_duration: op.missionDuration,
            filename: `${op.id}.json`,
            date: op.date,
            tag: op.tag,
          })),
        ),
    } as Response);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders operations list when open", async () => {
    const [open] = createSignal(true);
    const onClose = vi.fn();
    const onSelect = vi.fn();

    const { findByTestId } = render(() => (
      <I18nProvider locale="en"><MissionModal open={open} onClose={onClose} onSelectOperation={onSelect} /></I18nProvider>
    ));

    // Wait for fetch to complete
    const list = await findByTestId("operations-list");
    expect(list).toBeDefined();

    // Verify operations appear
    const op1 = await findByTestId("operation-1");
    const op2 = await findByTestId("operation-2");
    expect(op1.textContent).toContain("Op Alpha");
    expect(op1.textContent).toContain("Altis");
    expect(op2.textContent).toContain("Op Bravo");
    expect(op2.textContent).toContain("Stratis");
  });

  it("does not render when closed", () => {
    const [open] = createSignal(false);
    const onClose = vi.fn();
    const onSelect = vi.fn();

    const { queryByTestId } = render(() => (
      <I18nProvider locale="en"><MissionModal open={open} onClose={onClose} onSelectOperation={onSelect} /></I18nProvider>
    ));

    expect(queryByTestId("mission-modal")).toBeNull();
  });

  it("calls onSelectOperation when clicking an operation", async () => {
    const [open] = createSignal(true);
    const onClose = vi.fn();
    const onSelect = vi.fn();

    const { findByTestId } = render(() => (
      <I18nProvider locale="en"><MissionModal open={open} onClose={onClose} onSelectOperation={onSelect} /></I18nProvider>
    ));

    const op1 = await findByTestId("operation-1");
    fireEvent.click(op1);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "1",
        missionName: "Op Alpha",
        worldName: "Altis",
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has filter input and submit button", async () => {
    const [open] = createSignal(true);
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><MissionModal open={open} onClose={() => {}} onSelectOperation={() => {}} /></I18nProvider>
    ));

    expect(getByTestId("filter-name-input")).toBeDefined();
    expect(getByTestId("filter-submit-button")).toBeDefined();
  });

  it("has tag dropdown and date range filters", () => {
    const [open] = createSignal(true);
    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><MissionModal open={open} onClose={() => {}} onSelectOperation={() => {}} /></I18nProvider>
    ));

    expect(getByTestId("filter-tag-input")).toBeDefined();
    expect(getByTestId("filter-newer-input")).toBeDefined();
    expect(getByTestId("filter-older-input")).toBeDefined();
  });

  it("shows date in D/M/YYYY format and duration with hours", async () => {
    const [open] = createSignal(true);
    const { findByTestId } = render(() => (
      <I18nProvider locale="en"><MissionModal open={open} onClose={() => {}} onSelectOperation={() => {}} /></I18nProvider>
    ));

    const op1 = await findByTestId("operation-1");
    // 3600 seconds = 1h 0m 0s
    expect(op1.textContent).toContain("1h 0m 0s");
    // 2024-01-01 → 1/1/2024
    expect(op1.textContent).toContain("1/1/2024");

    const op2 = await findByTestId("operation-2");
    // 1800 seconds = 30m 0s
    expect(op2.textContent).toContain("30m 0s");
    // 2024-02-01 → 1/2/2024
    expect(op2.textContent).toContain("1/2/2024");
  });
});

// ─── CounterDisplay ───

describe("CounterDisplay", () => {
  afterEach(() => {
    cleanup();
  });

  it("is hidden when counterState is null", () => {
    const engine = createEngine();
    // counterState defaults to null
    const { queryByTestId } = render(withEngine(engine, () => <CounterDisplay />));
    expect(queryByTestId("counter-display")).toBeNull();
  });

  it("shows counter values when counterState is present", () => {
    const engine = createEngine();

    // Build a minimal manifest with counter events to trigger counterState
    const manifest = {
      version: 1,
      worldName: "Altis",
      missionName: "Test",
      frameCount: 100,
      chunkSize: 100,
      captureDelayMs: 1000,
      chunkCount: 1,
      entities: [],
      events: [
        { frameNum: 0, type: "counterInit" as const, data: [100, 80] },
      ],
      markers: [],
      times: [],
    };

    // Use loadOperation to set up counter state (requires a mock chunk manager)
    const mockChunkManager = { getChunkForFrame: () => null } as any;
    engine.loadOperation(manifest, mockChunkManager);

    const { getByTestId } = render(withEngine(engine, () => <CounterDisplay />));
    expect(getByTestId("counter-display")).toBeDefined();
    expect(getByTestId("counter-label").textContent).toBe("counterInit");
    expect(getByTestId("counter-side-0").textContent).toContain("100");
    expect(getByTestId("counter-side-1").textContent).toContain("80");
  });
});

// ─── Hint ───

describe("Hint", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows message when visible", () => {
    const [msg] = createSignal("Copied to clipboard!");
    const [vis] = createSignal(true);
    const { getByTestId } = render(() => (
      <Hint message={msg} visible={vis} />
    ));
    expect(getByTestId("hint").textContent).toBe("Copied to clipboard!");
  });

  it("is hidden when not visible", () => {
    const [msg] = createSignal("Hidden msg");
    const [vis] = createSignal(false);
    const { queryByTestId } = render(() => (
      <Hint message={msg} visible={vis} />
    ));
    expect(queryByTestId("hint")).toBeNull();
  });

  it("showHint auto-dismisses after timeout", async () => {
    vi.useFakeTimers();

    render(() => <Hint />);

    showHint("Auto dismiss test");
    expect(hintVisible()).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(hintVisible()).toBe(false);

    vi.useRealTimers();
  });
});
