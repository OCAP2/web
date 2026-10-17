import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorldDem, resetDemCache, sampleDem, demExtent, makeFlatDem, encodeDemBinary } from "../demGrid";
import { METERS_PER_DEGREE } from "../../../utils/coordinates";

const archive = vi.hoisted(() => ({ getHeader: vi.fn(), getZxy: vi.fn() }));
vi.mock("pmtiles", () => ({ PMTiles: vi.fn(function () { return archive; }) }));

const ZOOM = 11;
const N = 2 ** ZOOM;
const TILE_SIZE = 256;
interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  close: () => void;
}

// A native-size canvas blit, with transparent pixels for anything not drawn.
// No projection/cropping behavior is mocked: that must come from the loader.
class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      drawImage: (bitmap: Bitmap, x: number, y: number) => {
        for (let row = 0; row < bitmap.height; row++) {
          this.data.set(bitmap.data.subarray(row * bitmap.width * 4, (row + 1) * bitmap.width * 4),
            ((y + row) * this.width + x) * 4);
        }
      },
      getImageData: () => ({ data: this.data }),
    };
  }
}

let heightAt: (x: number, y: number) => number;
let opaqueAt: (x: number, y: number) => boolean;

beforeEach(() => {
  resetDemCache();
  vi.clearAllMocks();
  heightAt = () => 100;
  opaqueAt = () => true;
  archive.getHeader.mockResolvedValue({ minZoom: ZOOM });
  archive.getZxy.mockImplementation(async (z: number, x: number, y: number) => {
    if (y >= N / 2) return undefined; // The world has no tile south of the equator.
    return { data: new TextEncoder().encode(JSON.stringify([z, x, y])).buffer };
  });
  vi.stubGlobal("OffscreenCanvas", Canvas);
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob): Promise<Bitmap> => {
    const [, tileX, tileY] = JSON.parse(await blob.text()) as number[];
    const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let row = 0; row < TILE_SIZE; row++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + (row + 0.5) / TILE_SIZE) / N))) * 180 / Math.PI;
      const y = lat * METERS_PER_DEGREE;
      for (let col = 0; col < TILE_SIZE; col++) {
        const x = ((tileX + (col + 0.5) / TILE_SIZE) * 360 / N - 180) * METERS_PER_DEGREE;
        const value = Math.round((heightAt(x, y) + 10000) * 10);
        const offset = (row * TILE_SIZE + col) * 4;
        data.set([value >> 16, (value >> 8) & 255, value & 255, opaqueAt(x, y) ? 255 : 0], offset);
      }
    }
    return { width: TILE_SIZE, height: TILE_SIZE, data, close: vi.fn() };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetDemCache();
});

const load = (worldSize = 12800) => loadWorldDem({
  tileBaseUrl: "https://maps.test/heightmap-only", worldSize, hasDem: false, hasHeightmap: true,
});

describe("heightmap.pmtiles fallback", () => {
  it("continues to prefer the compact binary DEM when available", async () => {
    const binary = encodeDemBinary(makeFlatDem(12800, 40, 100));
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(binary).buffer }));
    vi.stubGlobal("fetch", fetch);
    const grid = await loadWorldDem({ tileBaseUrl: "https://maps.test/binary", worldSize: 12800, hasDem: true });
    expect(grid).toBeDefined();
    expect(sampleDem(grid!, 100, 100)).toBeCloseTo(40);
    expect(archive.getHeader).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("excludes southern tiles and preserves a constant height to the world boundaries", async () => {
    const grid = await load();
    expect(grid).toBeDefined();
    expect(demExtent(grid!)).toEqual({ minX: 0, minY: 0, maxX: 12800, maxY: 12800 });
    for (const [x, y] of [[0, 0], [100, 100], [6400, 6400], [12800, 12800]]) {
      expect(sampleDem(grid!, x, y)).toBeCloseTo(100);
    }
    expect(archive.getZxy.mock.calls.every(([, , y]) => y < N / 2)).toBe(true);
  });

  it.each([12800, 42000])("maps pixel elevations to geographic world coordinates for a %s m world", async (worldSize) => {
    heightAt = (x, y) => 100 + x / 100 + y / 50;
    const grid = await load(worldSize);
    expect(grid).toBeDefined();
    for (const [x, y] of [[1000, 1000], [worldSize / 2, worldSize * 0.75], [worldSize - 1000, 2000]]) {
      expect(sampleDem(grid!, x, y)).toBeCloseTo(heightAt(x, y), 0);
    }
  });

  it("ignores transparent padding outside the geographic world bounds", async () => {
    opaqueAt = (x, y) => x >= 0 && y >= 0 && x <= 12800 && y <= 12800;
    const grid = await load();
    expect(grid).toBeDefined();
    expect(sampleDem(grid!, 12800, 12800)).toBeCloseTo(100);
  });

  it("declines terrain with transparent holes rather than decoding them as -10000 metres", async () => {
    opaqueAt = (x, y) => !(x > 4000 && x < 8000 && y > 4000 && y < 8000);
    expect(await load() === undefined).toBe(true);
  });

  it("declines an incomplete set of in-world tiles", async () => {
    const original = archive.getZxy.getMockImplementation()!;
    archive.getZxy.mockImplementation((z, x, y) => x === N / 2 + 1 ? undefined : original(z, x, y));
    expect(await load(42000) === undefined).toBe(true);
  });
});
