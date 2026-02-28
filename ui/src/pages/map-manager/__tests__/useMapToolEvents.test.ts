import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { useMapToolEvents } from "../useMapToolEvents";
import type { JobInfo } from "../types";

// ─── Mock EventSource ───

type ESListener = (e: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  listeners: Record<string, ESListener[]> = {};
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: ESListener) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  // Test helpers
  emit(event: string, data: unknown) {
    const listeners = this.listeners[event] || [];
    for (const cb of listeners) {
      cb(new MessageEvent(event, { data: JSON.stringify(data) }));
    }
  }

  triggerError() {
    if (this.onerror) this.onerror();
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function runHook(url: string) {
  let result!: ReturnType<typeof useMapToolEvents>;
  const dispose = createRoot((d) => {
    result = useMapToolEvents(() => url);
    return d;
  });
  // flush microtasks so createEffect runs
  return { ...result, dispose };
}

async function flush() {
  await new Promise<void>((r) => queueMicrotask(r));
}

describe("useMapToolEvents", () => {
  it("creates EventSource with the provided URL", async () => {
    const { dispose } = runHook("http://localhost/events");
    await flush();
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toBe("http://localhost/events");
    dispose();
  });

  it("does not create EventSource when URL is empty", async () => {
    const { dispose } = runHook("");
    await flush();
    expect(MockEventSource.instances.length).toBe(0);
    dispose();
  });

  it("populates jobs from snapshot event", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();

    const snapshot: JobInfo[] = [
      {
        id: "j1",
        worldName: "Altis",
        inputPath: "",
        outputDir: "",
        tempDir: "",
        status: "done",
        startedAt: "2024-01-01T00:00:00Z",
      },
    ];

    MockEventSource.instances[0].emit("snapshot", snapshot);

    expect(jobs().length).toBe(1);
    expect(jobs()[0].worldName).toBe("Altis");
    expect(jobs()[0].status).toBe("done");
    dispose();
  });

  it("updates job on progress event", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];

    es.emit("snapshot", [
      {
        id: "j1",
        worldName: "Altis",
        inputPath: "",
        outputDir: "",
        tempDir: "",
        status: "pending",
        startedAt: "2024-01-01T00:00:00Z",
      },
    ]);

    es.emit("progress", {
      type: "progress",
      data: {
        jobId: "j1",
        stage: "render",
        stageNum: 2,
        totalStages: 7,
        message: "Rendering tiles",
      },
    });

    expect(jobs()[0].status).toBe("running");
    expect(jobs()[0].stage).toBe("render");
    expect(jobs()[0].stageNum).toBe(2);
    dispose();
  });

  it("adds new job from progress event if not in list", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];

    es.emit("snapshot", []);
    es.emit("progress", {
      type: "progress",
      data: {
        jobId: "j2",
        stage: "parse_gradmeh",
        stageNum: 0,
        totalStages: 7,
      },
    });

    expect(jobs().length).toBe(1);
    expect(jobs()[0].id).toBe("j2");
    expect(jobs()[0].status).toBe("running");
    dispose();
  });

  it("updates job on status event", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];

    es.emit("snapshot", [
      {
        id: "j1",
        worldName: "Altis",
        inputPath: "",
        outputDir: "",
        tempDir: "",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
      },
    ]);

    es.emit("status", {
      type: "status",
      job: {
        id: "j1",
        worldName: "Altis",
        inputPath: "",
        outputDir: "",
        tempDir: "",
        status: "done",
        startedAt: "2024-01-01T00:00:00Z",
        finishedAt: "2024-01-01T00:05:00Z",
      },
    });

    expect(jobs()[0].status).toBe("done");
    expect(jobs()[0].finishedAt).toBe("2024-01-01T00:05:00Z");
    dispose();
  });

  it("adds new job from status event if not in list", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];

    es.emit("snapshot", []);
    es.emit("status", {
      type: "status",
      job: {
        id: "j3",
        worldName: "Stratis",
        inputPath: "",
        outputDir: "",
        tempDir: "",
        status: "done",
        startedAt: "2024-01-01T00:00:00Z",
      },
    });

    expect(jobs().length).toBe(1);
    expect(jobs()[0].worldName).toBe("Stratis");
    dispose();
  });

  it("ignores progress event with no data", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];

    es.emit("snapshot", []);
    es.emit("progress", { type: "progress" });

    expect(jobs().length).toBe(0);
    dispose();
  });

  it("ignores status event with no job", async () => {
    const { jobs, dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];

    es.emit("snapshot", []);
    es.emit("status", { type: "status" });

    expect(jobs().length).toBe(0);
    dispose();
  });

  it("reconnects on error with backoff", async () => {
    vi.useFakeTimers();
    const { dispose } = runHook("http://localhost/events");
    await flush();

    const es1 = MockEventSource.instances[0];
    es1.triggerError();

    expect(MockEventSource.instances.length).toBe(1);

    // Advance past initial backoff (1000ms)
    vi.advanceTimersByTime(1000);
    await flush();
    expect(MockEventSource.instances.length).toBe(2);
    expect(MockEventSource.instances[1].url).toBe("http://localhost/events");

    dispose();
  });

  it("closes EventSource on cleanup", async () => {
    const { dispose } = runHook("http://localhost/events");
    await flush();
    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);
    dispose();
    expect(es.closed).toBe(true);
  });

  it("reconnects when heartbeat times out", async () => {
    vi.useFakeTimers();
    const { dispose } = runHook("http://localhost/events");
    await flush();

    expect(MockEventSource.instances.length).toBe(1);
    const es1 = MockEventSource.instances[0];
    expect(es1.closed).toBe(false);

    // Advance past heartbeat timeout (45s)
    vi.advanceTimersByTime(45_000);
    await flush();

    // Original ES should be closed and a new one created
    expect(es1.closed).toBe(true);
    expect(MockEventSource.instances.length).toBe(2);

    dispose();
  });

  it("resets heartbeat on snapshot event", async () => {
    vi.useFakeTimers();
    const { dispose } = runHook("http://localhost/events");
    await flush();

    // Advance 40s (close to timeout)
    vi.advanceTimersByTime(40_000);
    await flush();

    // Send a snapshot — should reset the timer
    MockEventSource.instances[0].emit("snapshot", []);
    await flush();

    // Advance another 40s — should NOT have timed out
    vi.advanceTimersByTime(40_000);
    await flush();

    // Still only 1 ES instance (no reconnect triggered)
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].closed).toBe(false);

    dispose();
  });

  it("clears reconnect timer on cleanup", async () => {
    vi.useFakeTimers();
    const { dispose } = runHook("http://localhost/events");
    await flush();

    // Trigger error to start reconnect timer
    MockEventSource.instances[0].triggerError();

    // Dispose before reconnect fires — should clean up the timer
    dispose();

    // Advance past backoff — should NOT create a new ES
    vi.advanceTimersByTime(5000);
    await flush();
    expect(MockEventSource.instances.length).toBe(1);
  });
});
