import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ workerUrl: "" }));

vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?url", () => ({
  default: "/assets/maplibre-gl-worker-abc123.mjs",
}));

vi.mock("maplibre-gl", () => ({
  getWorkerUrl: vi.fn(() => state.workerUrl),
  setWorkerUrl: vi.fn((url: string) => {
    state.workerUrl = url;
  }),
}));

import * as maplibregl from "maplibre-gl";
import { loadMaplibre } from "../maplibreLoader";

describe("loadMaplibre", () => {
  beforeEach(() => {
    state.workerUrl = "";
    vi.mocked(maplibregl.setWorkerUrl).mockClear();
  });

  it("points MapLibre at the worker file Vite emits", async () => {
    const ml = await loadMaplibre();

    expect(maplibregl.setWorkerUrl).toHaveBeenCalledWith("/assets/maplibre-gl-worker-abc123.mjs");
    expect(ml.getWorkerUrl()).toBe("/assets/maplibre-gl-worker-abc123.mjs");
  });

  it("sets the worker URL only once across calls", async () => {
    await loadMaplibre();
    await loadMaplibre();

    expect(maplibregl.setWorkerUrl).toHaveBeenCalledTimes(1);
  });
});
