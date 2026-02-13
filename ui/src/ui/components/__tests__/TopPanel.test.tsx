import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { EngineProvider } from "../../hooks/useEngine";
import { CustomizeProvider } from "../../hooks/useCustomize";
import { TopPanel } from "../TopPanel";
import { AboutModal } from "../AboutModal";
import { I18nProvider } from "../../hooks/useLocale";
import { MissionSelector } from "../../../pages/mission-selector";
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
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} /></CustomizeProvider>
    ));
    expect(getByTestId("mission-name").textContent).toBe("Operation Thunder");
  });

  it("renders info button always", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} /></CustomizeProvider>
    ));
    expect(getByTestId("info-button")).toBeDefined();
    expect(getByTestId("info-button").textContent).toBe("i");
  });

  it("calls onInfoClick when info button clicked", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const onInfo = vi.fn();
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} onInfoClick={onInfo} /></CustomizeProvider>
    ));
    fireEvent.click(getByTestId("info-button"));
    expect(onInfo).toHaveBeenCalledTimes(1);
  });

  it("share button copies URL with /recording/:id/:name path to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const [name] = createSignal("Test Mission");
    const [opId] = createSignal<string | null>("op-42");
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} /></CustomizeProvider>
    ));

    fireEvent.click(getByTestId("share-button"));

    expect(writeText).toHaveBeenCalledTimes(1);
    const calledUrl = writeText.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/recording/op-42/op-42");
  });

  it("share button uses operationFilename as name segment", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const [name] = createSignal("Test Mission");
    const [opId] = createSignal<string | null>("42");
    const [opFilename] = createSignal<string | null>("my_mission");
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} operationFilename={opFilename} /></CustomizeProvider>
    ));

    fireEvent.click(getByTestId("share-button"));

    const calledUrl = writeText.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/recording/42/my_mission");
  });

  it("hides share and download buttons when no operationId", () => {
    const [name] = createSignal("No Op");
    const [opId] = createSignal<string | null>(null);
    const { queryByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} /></CustomizeProvider>
    ));
    expect(queryByTestId("share-button")).toBeNull();
    expect(queryByTestId("download-button")).toBeNull();
  });

  it("download button has correct href using operationFilename", () => {
    const [name] = createSignal("DL Mission");
    const [opId] = createSignal<string | null>("42");
    const [opFilename] = createSignal<string | null>("my_mission");
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} operationFilename={opFilename} /></CustomizeProvider>
    ));
    const link = getByTestId("download-button") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("data/my_mission.json.gz");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("download button falls back to operationId when no filename", () => {
    const [name] = createSignal("DL Mission");
    const [opId] = createSignal<string | null>("my-file");
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} /></CustomizeProvider>
    ));
    const link = getByTestId("download-button") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("data/my-file.json.gz");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("renders back button when onBack is provided", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const onBack = vi.fn();
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} onBack={onBack} /></CustomizeProvider>
    ));
    expect(getByTestId("back-button")).toBeDefined();
  });

  it("does not render back button when onBack is not provided", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const { queryByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} /></CustomizeProvider>
    ));
    expect(queryByTestId("back-button")).toBeNull();
  });

  it("calls onBack when back button clicked", () => {
    const [name] = createSignal("Test");
    const [opId] = createSignal<string | null>(null);
    const onBack = vi.fn();
    const { getByTestId } = render(() => (
      <CustomizeProvider><TopPanel missionName={name} operationId={opId} onBack={onBack} /></CustomizeProvider>
    ));
    fireEvent.click(getByTestId("back-button"));
    expect(onBack).toHaveBeenCalledTimes(1);
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
    expect(select.options.length).toBe(6);
  });
});

// ─── MissionSelector ───

describe("MissionSelector", () => {
  const mockOperations: Operation[] = [
    {
      id: "1",
      worldName: "Altis",
      missionName: "Op Alpha",
      missionDuration: 3600,
      date: "2024-01-01",
      tag: "TvT",
    },
    {
      id: "2",
      worldName: "Stratis",
      missionName: "Op Bravo",
      missionDuration: 1800,
      date: "2024-02-01",
      tag: "COOP",
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

  it("renders mission selector page", async () => {
    const { findByTestId } = render(() => (
      <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
        <Route path="/" component={MissionSelector} />
      </Router>
    ));

    const page = await findByTestId("mission-selector");
    expect(page).toBeDefined();
  });

  it("loads and displays operations in grid rows", async () => {
    const { findByTestId } = render(() => (
      <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
        <Route path="/" component={MissionSelector} />
      </Router>
    ));

    const list = await findByTestId("operations-list");
    expect(list).toBeDefined();

    const op1 = await findByTestId("operation-1");
    const op2 = await findByTestId("operation-2");
    expect(op1.textContent).toContain("Op Alpha");
    expect(op1.textContent).toContain("Altis");
    expect(op2.textContent).toContain("Op Bravo");
    expect(op2.textContent).toContain("Stratis");
  });

  it("has search input", async () => {
    const { getByTestId } = render(() => (
      <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
        <Route path="/" component={MissionSelector} />
      </Router>
    ));

    expect(getByTestId("search-input")).toBeDefined();
  });

  it("filters by search text", async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(() => (
      <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
        <Route path="/" component={MissionSelector} />
      </Router>
    ));

    await findByTestId("operation-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Bravo" } });

    await vi.waitFor(() => {
      expect(queryByTestId("operation-1")).toBeNull();
    });
    expect(queryByTestId("operation-2")).not.toBeNull();
  });

  it("shows loading indicator while fetching", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise<Response>((resolve) => { resolvers.push(resolve); });
    });

    const { queryByTestId, getByTestId } = render(() => (
      <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
        <Route path="/" component={MissionSelector} />
      </Router>
    ));

    expect(queryByTestId("loading-indicator")).not.toBeNull();

    const list = getByTestId("operations-list");
    expect(list.contains(queryByTestId("loading-indicator"))).toBe(true);

    const emptyResponse = { ok: true, json: () => Promise.resolve([]) } as Response;
    for (const resolve of resolvers) {
      resolve(emptyResponse);
    }

    await vi.waitFor(() => {
      expect(queryByTestId("loading-indicator")).toBeNull();
    });
  });

  it("shows duration with hours and date in localized format", async () => {
    const { findByTestId } = render(() => (
      <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
        <Route path="/" component={MissionSelector} />
      </Router>
    ));

    const op1 = await findByTestId("operation-1");
    expect(op1.textContent).toContain("1h 0m 0s");

    const op2 = await findByTestId("operation-2");
    expect(op2.textContent).toContain("30m 0s");
  });
});

// ─── CounterDisplay ───

describe("CounterDisplay", () => {
  afterEach(() => {
    cleanup();
  });

  it("is hidden when counterState is null", () => {
    const engine = createEngine();
    const { queryByTestId } = render(withEngine(engine, () => <CounterDisplay />));
    expect(queryByTestId("counter-display")).toBeNull();
  });

  it("shows counter values when counterState is present", () => {
    const engine = createEngine();

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
