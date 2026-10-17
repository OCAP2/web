import { basePath } from "../../data/basePath";
import { METERS_PER_DEGREE } from "../../utils/coordinates";

/**
 * In-memory heightmap in Arma metres. Row 0 is south, matching the map-tool DEM.
 */
export interface DemGrid {
  cols: number;
  rows: number;
  /** Southwest corner of the grid, usually 0. */
  originX: number;
  originY: number;
  cellSize: number;
  /** World size in metres (Arma). */
  worldSize: number;
  /** Row-major, south to north. */
  data: Float32Array;
}

export const DEM_MAGIC = "OCAPDEM\u0001";

function writeF32(view: DataView, offset: number, value: number): void {
  view.setFloat32(offset, value, true);
}

export function encodeDemBinary(grid: DemGrid): Uint8Array {
  const header = 8 + 4 * 4 + 4 + 4;
  const buf = new ArrayBuffer(header + grid.data.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < 8; i++) view.setUint8(i, DEM_MAGIC.charCodeAt(i));
  writeF32(view, 8, grid.worldSize);
  writeF32(view, 12, grid.originX);
  writeF32(view, 16, grid.originY);
  writeF32(view, 20, grid.cellSize);
  view.setUint32(24, grid.cols, true);
  view.setUint32(28, grid.rows, true);
  for (let i = 0; i < grid.data.length; i++) {
    const dm = Math.round(grid.data[i] * 10);
    const clamped = Math.max(-32767, Math.min(32767, dm));
    view.setInt16(header + i * 2, clamped, true);
  }
  return new Uint8Array(buf);
}

export function decodeDemBinary(bytes: Uint8Array): DemGrid {
  if (bytes.length < 32) throw new Error("dem.bin is too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let magic = "";
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(view.getUint8(i));
  if (magic !== DEM_MAGIC) throw new Error("dem.bin magic mismatch");
  const worldSize = view.getFloat32(8, true);
  const originX = view.getFloat32(12, true);
  const originY = view.getFloat32(16, true);
  const cellSize = view.getFloat32(20, true);
  const cols = view.getUint32(24, true);
  const rows = view.getUint32(28, true);
  if (cols <= 0 || rows <= 0 || cellSize <= 0) {
    throw new Error("dem.bin has invalid dimensions");
  }
  const expected = 32 + cols * rows * 2;
  if (bytes.length < expected) throw new Error("dem.bin truncated");
  const data = new Float32Array(cols * rows);
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getInt16(32 + i * 2, true) / 10;
  }
  return { cols, rows, originX, originY, cellSize, worldSize, data };
}

export function sampleDem(grid: DemGrid, x: number, y: number): number {
  const gx = (x - grid.originX) / grid.cellSize;
  const gy = (y - grid.originY) / grid.cellSize;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = gx - x0;
  const ty = gy - y0;
  const h00 = demAt(grid, x0, y0);
  const h10 = demAt(grid, x1, y0);
  const h01 = demAt(grid, x0, y1);
  const h11 = demAt(grid, x1, y1);
  return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
}

function demAt(grid: DemGrid, col: number, row: number): number {
  const c = Math.max(0, Math.min(grid.cols - 1, col));
  const r = Math.max(0, Math.min(grid.rows - 1, row));
  return grid.data[r * grid.cols + c];
}

export function makeFlatDem(worldSize: number, height = 0, cellSize = 100): DemGrid {
  const cols = Math.max(2, Math.ceil(worldSize / cellSize) + 1);
  const rows = cols;
  const data = new Float32Array(cols * rows);
  data.fill(height);
  return { cols, rows, originX: 0, originY: 0, cellSize, worldSize, data };
}

export function demExtent(grid: DemGrid): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: grid.originX,
    minY: grid.originY,
    maxX: grid.originX + (grid.cols - 1) * grid.cellSize,
    maxY: grid.originY + (grid.rows - 1) * grid.cellSize,
  };
}

/** Closest point on the DEM rectangle. Off-map units land on the nearest edge. */
export function nearestOnDem(grid: DemGrid, x: number, y: number): [number, number] {
  const extent = demExtent(grid);
  return [
    Math.max(extent.minX, Math.min(extent.maxX, x)),
    Math.max(extent.minY, Math.min(extent.maxY, y)),
  ];
}

export interface CoverageSampleOrigin {
  x: number;
  y: number;
  shiftX: number;
  shiftY: number;
  offDem: boolean;
}

/**
 * If the radio is off the DEM, march from the nearest on-terrain point and
 * shift the resulting polygon back onto the unit. Uses the edge's ground
 * height rather than a Zeus ASL that is floating in empty space.
 */
export function projectCoverageOrigin(
  grid: DemGrid,
  origin: [number, number, number?],
): CoverageSampleOrigin {
  const [x, y] = nearestOnDem(grid, origin[0], origin[1]);
  const shiftX = origin[0] - x;
  const shiftY = origin[1] - y;
  return {
    x,
    y,
    shiftX,
    shiftY,
    offDem: Math.hypot(shiftX, shiftY) > 0.5,
  };
}

export function shiftCoveragePoints(
  points: [number, number][],
  shiftX: number,
  shiftY: number,
): [number, number][] {
  if (shiftX === 0 && shiftY === 0) return points;
  return points.map(([x, y]) => [x + shiftX, y + shiftY]);
}

async function inflateGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function looksGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

const demLoads = new Map<string, Promise<DemGrid | undefined>>();

export function resetDemCache(): void {
  demLoads.clear();
}

export function worldHasElevation(world?: {
  tileBaseUrl?: string;
  worldName?: string;
  worldSize?: number;
  hasDem?: boolean;
  hasHeightmap?: boolean;
} | null): boolean {
  if (!(world?.worldSize && world.worldSize > 0)) return false;
  if (world.hasDem === false && world.hasHeightmap === false && !world.worldName) return false;
  return Boolean(world.tileBaseUrl || world.worldName);
}

function looksDemBinary(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  if (looksGzip(bytes)) return true;
  let magic = "";
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(bytes[i]);
  return magic === DEM_MAGIC;
}

async function fetchDemCandidate(url: string): Promise<DemGrid | undefined> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return undefined;
    let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer());
    if (!looksDemBinary(bytes)) return undefined;
    if (looksGzip(bytes)) bytes = await inflateGzip(bytes);
    return decodeDemBinary(bytes);
  } catch {
    return undefined;
  }
}

function demBinaryUrls(base: string): string[] {
  const trimmed = base.replace(/\/$/, "");
  if (!trimmed) return [];
  return [
    `${trimmed}/tiles/dem.bin.gz`,
    `${trimmed}/dem.bin.gz`,
    `${trimmed}/tiles/dem.bin`,
    `${trimmed}/dem.bin`,
  ];
}

function heightmapUrls(base: string): string[] {
  const trimmed = base.replace(/\/$/, "");
  if (!trimmed) return [];
  return [`${trimmed}/tiles/heightmap.pmtiles`, `${trimmed}/heightmap.pmtiles`];
}

function localMapsBase(worldName?: string): string | undefined {
  if (!worldName) return undefined;
  return `${basePath}images/maps/${encodeURIComponent(worldName.toLowerCase())}`;
}

/**
 * Load a playback DEM. Prefers the compact `dem.bin.gz` the map pipeline
 * writes; falls back to assembling Mapbox terrain-RGB tiles from
 * `heightmap.pmtiles` so existing maps still work.
 *
 * Tile basemaps often come from a CDN that has no DEM. A file under the
 * webserver's `maps/{world}/` folder is tried first via `/images/maps/…`,
 * without replacing the CDN `map.json` / raster tiles.
 */
export async function loadWorldDem(opts: {
  tileBaseUrl?: string;
  worldName?: string;
  worldSize: number;
  hasDem?: boolean;
  hasHeightmap?: boolean;
}): Promise<DemGrid | undefined> {
  if (opts.worldSize <= 0) return undefined;
  const remote = opts.tileBaseUrl?.replace(/\/$/, "") || undefined;
  const local = localMapsBase(opts.worldName)?.replace(/\/$/, "");
  if (!remote && !local) return undefined;
  const key = `${local ?? ""}|${remote ?? ""}|${opts.worldSize}|${opts.hasDem}|${opts.hasHeightmap}`;
  let pending = demLoads.get(key);
  if (!pending) {
    pending = loadWorldDemUncached({ local, remote, worldSize: opts.worldSize, hasDem: opts.hasDem, hasHeightmap: opts.hasHeightmap });
    demLoads.set(key, pending);
  }
  return pending;
}

async function loadWorldDemUncached(opts: {
  local?: string;
  remote?: string;
  worldSize: number;
  hasDem?: boolean;
  hasHeightmap?: boolean;
}): Promise<DemGrid | undefined> {
  const tryDem = async (base?: string): Promise<DemGrid | undefined> => {
    if (!base) return undefined;
    for (const url of demBinaryUrls(base)) {
      const grid = await fetchDemCandidate(url);
      if (grid) return grid;
    }
    return undefined;
  };
  const tryHeightmap = async (base?: string): Promise<DemGrid | undefined> => {
    if (!base) return undefined;
    for (const url of heightmapUrls(base)) {
      const grid = await loadDemFromHeightmapPmtiles(url, opts.worldSize);
      if (grid) return grid;
    }
    return undefined;
  };

  // Local files win so a DEM dropped next to the webserver works even when the
  // CDN map has tiles but no elevation (Hammertest Šumava).
  const localDem = await tryDem(opts.local);
  if (localDem) return localDem;

  if (opts.hasDem !== false) {
    const remote = opts.remote && opts.remote !== opts.local ? opts.remote : undefined;
    const remoteDem = await tryDem(remote);
    if (remoteDem) return remoteDem;
  }

  if (opts.hasHeightmap !== false) {
    const localHeightmap = await tryHeightmap(opts.local);
    if (localHeightmap) return localHeightmap;
    const remote = opts.remote && opts.remote !== opts.local ? opts.remote : undefined;
    const remoteHeightmap = await tryHeightmap(remote);
    if (remoteHeightmap) return remoteHeightmap;
  }
  return undefined;
}

async function loadDemFromHeightmapPmtiles(url: string, worldSize: number): Promise<DemGrid | undefined> {
  const tiles: { x: number; y: number; bitmap: ImageBitmap }[] = [];
  try {
    const { PMTiles } = await import("pmtiles");
    const archive = new PMTiles(url);
    const header = await archive.getHeader();
    const z = header.minZoom;
    const n = 2 ** z;
    const west = 0;
    const south = 0;
    const east = worldSize / METERS_PER_DEGREE;
    const north = worldSize / METERS_PER_DEGREE;
    // Fetch only tiles whose interior intersects the world. In particular,
    // the equator is a tile edge, not a reason to request the southern tile.
    const minX = Math.floor(lngToTile(west, n));
    const maxX = Math.ceil(lngToTile(east, n)) - 1;
    const minY = Math.floor(latToTile(north, n));
    const maxY = Math.ceil(latToTile(south, n)) - 1;

    let tileSize = 0;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const tile = await archive.getZxy(z, x, y);
        // Incomplete terrain must fall back to distance-only coverage rather
        // than inventing elevations from the canvas's transparent pixels.
        if (!tile?.data) return undefined;
        const blob = new Blob([tile.data], { type: "image/png" });
        const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        tiles.push({ x, y, bitmap });
        if (bitmap.width !== bitmap.height || (tileSize && bitmap.width !== tileSize)) return undefined;
        tileSize = bitmap.width;
      }
    }
    if (!tiles.length || tileSize <= 0) return undefined;

    const width = (maxX - minX + 1) * tileSize;
    const height = (maxY - minY + 1) * tileSize;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    for (const tile of tiles) {
      ctx.drawImage(tile.bitmap, (tile.x - minX) * tileSize, (tile.y - minY) * tileSize);
    }
    const image = ctx.getImageData(0, 0, width, height);
    // A tile rectangle generally exceeds the world bounds. Resample at regular
    // Arma-metre intervals using each point's actual Mercator pixel location,
    // rather than stretching that rectangle onto the world. Pixels are centred
    // half a pixel inside their tile; DemGrid samples include both world edges.
    const steps = Math.max(1, Math.ceil((lngToTile(east, n) - lngToTile(west, n)) * tileSize));
    const cols = steps + 1;
    const rows = cols;
    const cellSize = worldSize / steps;
    const data = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const py = (latToTile(r * cellSize / METERS_PER_DEGREE, n) - minY) * tileSize - 0.5;
      for (let c = 0; c < cols; c++) {
        const px = (lngToTile(c * cellSize / METERS_PER_DEGREE, n) - minX) * tileSize - 0.5;
        const elevation = sampleTerrainRgb(image.data, width, height, px, py);
        if (elevation === undefined) return undefined;
        data[r * cols + c] = elevation;
      }
    }
    return {
      cols,
      rows,
      originX: 0,
      originY: 0,
      cellSize,
      worldSize,
      data,
    };
  } catch {
    return undefined;
  } finally {
    for (const { bitmap } of tiles) bitmap.close();
  }
}

/** Interpolate heights, not RGB channels, excluding transparent no-data padding. */
function sampleTerrainRgb(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): number | undefined {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx = px - x0;
  const ty = py - y0;
  let total = 0;
  let weights = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
      const offset = (Math.min(height - 1, y0 + dy) * width + Math.min(width - 1, x0 + dx)) * 4;
      if (weight === 0 || pixels[offset + 3] !== 255) continue;
      const value = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
      total += (value / 10 - 10000) * weight;
      weights += weight;
    }
  }
  return weights > 0 ? total / weights : undefined;
}

function lngToTile(lng: number, n: number): number {
  return Math.max(0, Math.min(n, ((lng + 180) / 360) * n));
}

function latToTile(lat: number, n: number): number {
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.max(0, Math.min(n, y));
}
