import L from "leaflet";
import type { ArmaCoord } from "../../utils/coordinates";
import type { AliveState, Side } from "../../data/types";
import type { EntityMarkerOpts, EntityMarkerState, CrewInfo } from "../renderer.types";
import { closestEquivalentAngle, SKIP_ANIMATION_DISTANCE } from "../../utils/math";
import { CanvasIconCache, resolveVariant } from "./canvasIcons";
import { getGridLevels, computeGridLines, formatCoordLabel } from "./gridUtils";

/** Map Side enum to bright hex color for canvas drawing. */
const SIDE_COLORS: Record<Side, string> = {
  WEST: "#00a8ff",
  EAST: "#ff0000",
  GUER: "#00cc00",
  CIV: "#c900ff",
};

/** Duration of the hit flash color tint in milliseconds. */
const HIT_FLASH_DURATION_MS = 300;

/** Hit flash glow color (yellow-orange). Alpha controlled via globalAlpha. */
const HIT_FLASH_COLOR = "#ffc800";

// --------------- Internal entity state ---------------

interface CanvasEntity {
  id: number;

  // Interpolation (Arma coordinate space, meters)
  prevX: number;
  prevY: number;
  prevDir: number;
  targetX: number;
  targetY: number;
  targetDir: number;
  interpProgress: number; // 0 → 1

  // Visual state
  iconType: string;
  iconVariant: string;
  iconSize: [number, number];
  opacity: number;

  // Label / visibility
  name: string;
  side: Side | null;
  crew: CrewInfo | undefined;
  isPlayer: boolean;
  isInVehicle: boolean;
  alive: AliveState;

  // Cached container pixel position — reused during zoom so the CSS transform
  // handles position animation while we counter-scale icons.
  cachedPx: number;
  cachedPy: number;
  cachedDir: number;

  // Hit flash — wall-clock fade-out managed by canvas render loop
  hitStartTime: number; // 0 = no active hit

  // Cached label measurement (invalidated on entity update or font size change)
  cachedLabelMaxW: number;
  cachedLabelFontSize: number;
}

interface CanvasProjectile {
  id: number;
  prevX: number;
  prevY: number;
  prevDir: number;
  targetX: number;
  targetY: number;
  targetDir: number;
  interpProgress: number;
  iconUrl: string;
  iconSize: [number, number];
  opacity: number;
  cachedPx: number;
  cachedPy: number;
  cachedDir: number;
  text: string;
}

export interface ProjectileOpts {
  iconUrl: string;
  iconSize: [number, number];
  text?: string;
}

export interface ProjectileState {
  position: ArmaCoord;
  direction: number;
  alpha: number;
}

export interface FireLine {
  // Arma coordinate space (meters)
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;

  // Visual
  color: string;
  weight: number;
  opacity: number;

  // Cached pixel positions for zoom
  cachedFromPx: number;
  cachedFromPy: number;
  cachedToPx: number;
  cachedToPy: number;
}

// --------------- Config passed from the renderer ---------------

export interface EntityCanvasConfig {
  armaToLatLng: (coords: ArmaCoord) => L.LatLng;
  iconCache: CanvasIconCache;
  getZoom: () => number;
  isMapLibreMode: boolean;
  nameDisplayMode: () => "players" | "all" | "none";
  layerVisible: () => boolean;
  projectileLayerVisible: () => boolean;
  // Grid
  worldSize: number;
  latLngToArma: (latlng: L.LatLng) => ArmaCoord;
}

// --------------- Canvas layer ---------------

export class EntityCanvasLayer {
  private map: L.Map;
  private config: EntityCanvasConfig;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  private entities = new Map<number, CanvasEntity>();
  private projectiles = new Map<number, CanvasProjectile>();

  private smoothing = false;
  private interpDurationSec = 1;
  private zooming = false;
  private zoomScale = 1;
  // Snapshot of the map center/zoom when the canvas was last drawn (pre-zoom).
  // Used by zoom transforms to compute the correct scale/offset.
  private drawnCenter: L.LatLng | null = null;
  private drawnZoom = 0;
  private fireLines: FireLine[] = [];
  private gridVisible = false;

  // Cached grid state — frozen during zoom so the CSS transform handles
  // the animation instead of re-projecting every frame (same as entities).
  private gridCachedZoom = 0;
  private gridCachedSwX = 0;
  private gridCachedSwY = 0;
  private gridCachedNeX = 0;
  private gridCachedNeY = 0;

  // Precomputed affine projection: px = projAx*arma_x + projBx*arma_y + projCx
  private projAx = 0;
  private projBx = 0;
  private projCx = 0;
  private projAy = 0;
  private projBy = 0;
  private projCy = 0;

  // Reusable offscreen canvas for per-icon hit tint (avoids source-atop bleed)
  private hitCanvas: OffscreenCanvas;
  private hitCtx: OffscreenCanvasRenderingContext2D;

  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(map: L.Map, config: EntityCanvasConfig) {
    this.map = map;
    this.config = config;

    // Create canvas element. We set transform-origin:0 0 to match Leaflet's
    // zoom transform math (translate3d + scale with origin at top-left).
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:625;transform-origin:0 0;";
    this.ctx = this.canvas.getContext("2d")!;

    // Small offscreen canvas for isolated per-icon hit tint
    this.hitCanvas = new OffscreenCanvas(64, 64);
    this.hitCtx = this.hitCanvas.getContext("2d")!;

    // Insert into map container
    map.getContainer().appendChild(this.canvas);

    // Size canvas to match container
    this.resize();

    // Watch for container resizes
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(map.getContainer());

    // Zoom animation: apply CSS translate3d+scale during zoom, then redraw
    // fresh on completion. The canvas is outside Leaflet's _mapPane so the
    // standard .leaflet-zoom-anim .leaflet-zoom-animated CSS transition
    // doesn't apply — we manage the transition manually in onZoomAnim.
    map.on("zoomanim", this.onZoomAnim, this);
    // Listen for the CSS transition completing to know when to clear the
    // transform and resume normal rendering. This replaces zoomend for
    // transform cleanup, preventing the transform from being cleared
    // before the animation visually finishes.
    this.onTransitionEnd = this.onTransitionEnd.bind(this);
    this.canvas.addEventListener("transitionend", this.onTransitionEnd);

    // Start render loop
    this.startRenderLoop();
  }

  // --------------- Public API ---------------

  addEntity(id: number, opts: EntityMarkerOpts): void {
    const iconType = this.config.iconCache.resolveType(opts.iconType);
    const variant = resolveVariant(1, opts.side, false);
    this.entities.set(id, {
      id,
      prevX: opts.position[0],
      prevY: opts.position[1],
      prevDir: opts.direction,
      targetX: opts.position[0],
      targetY: opts.position[1],
      targetDir: opts.direction,
      interpProgress: 1, // start at target
      iconType,
      iconVariant: variant,
      iconSize: this.config.iconCache.getSize(iconType),
      opacity: 1,
      name: opts.name,
      side: opts.side,
      crew: opts.crew,
      isPlayer: opts.isPlayer,
      isInVehicle: false,
      alive: 1,
      cachedPx: 0,
      cachedPy: 0,
      cachedDir: 0,
      hitStartTime: 0,
      cachedLabelMaxW: 0,
      cachedLabelFontSize: 0,
    });
  }

  updateEntity(id: number, state: EntityMarkerState): void {
    const e = this.entities.get(id);
    if (!e) return;

    // Snapshot current interpolated position as new "previous"
    const t = e.interpProgress;
    e.prevX = e.prevX + (e.targetX - e.prevX) * t;
    e.prevY = e.prevY + (e.targetY - e.prevY) * t;
    e.prevDir = e.prevDir + (e.targetDir - e.prevDir) * t;

    // Set new target
    e.targetX = state.position[0];
    e.targetY = state.position[1];
    e.targetDir = closestEquivalentAngle(e.prevDir, state.direction);

    // Snap immediately for teleports, smoothing off, or vehicle exit
    // (units re-appearing after being hidden in a vehicle must not interpolate
    // from their stale pre-vehicle position).
    const exitingVehicle = e.isInVehicle && !state.isInVehicle;
    const dx = e.targetX - e.prevX;
    const dy = e.targetY - e.prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > SKIP_ANIMATION_DISTANCE || !this.smoothing || exitingVehicle) {
      e.prevX = e.targetX;
      e.prevY = e.targetY;
      e.prevDir = e.targetDir;
      e.interpProgress = 1;
    } else {
      e.interpProgress = 0;
    }

    // Update visual state
    const iconType = this.config.iconCache.resolveType(state.iconType);
    // Trigger hit flash on new hit events (wall-clock timer)
    if (state.hit && state.alive !== 0) {
      e.hitStartTime = performance.now();
    }
    e.iconVariant = resolveVariant(state.alive, state.side, false);
    e.iconType = iconType;
    e.iconSize = this.config.iconCache.getSize(iconType);
    e.opacity = state.isInVehicle ? 0 : state.alive === 0 ? 0.4 : 1;
    e.name = state.name;
    e.side = state.side;
    e.crew = state.crew;
    e.isPlayer = state.isPlayer;
    e.isInVehicle = state.isInVehicle;
    e.alive = state.alive;
    e.cachedLabelFontSize = 0; // invalidate label measurement cache
  }

  removeEntity(id: number): void {
    this.entities.delete(id);
  }

  setSmoothingEnabled(enabled: boolean, speed?: number): void {
    this.smoothing = enabled;
    if (speed !== undefined) {
      // Canvas interpolation must complete within the frame interval (1/speed)
      // so entities reach their target before the next update arrives.
      // The CSS renderer uses longer durations (getTransitionDuration) because
      // CSS transitions redirect smoothly when interrupted, but canvas lerp
      // accumulates visible lag if the duration exceeds the frame interval.
      this.interpDurationSec = speed > 0 ? 1 / speed : 1;
    }
    // Don't snap on disable — entities freeze at their current interpolated
    // position. Seeking while paused snaps via updateEntity() instead.
  }

  setFireLines(lines: FireLine[]): void {
    this.fireLines = lines;
  }

  clearFireLines(): void {
    this.fireLines = [];
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
  }

  addProjectile(id: number, opts: ProjectileOpts): void {
    this.projectiles.set(id, {
      id,
      prevX: 0, prevY: 0, prevDir: 0,
      targetX: 0, targetY: 0, targetDir: 0,
      interpProgress: 1,
      iconUrl: opts.iconUrl,
      iconSize: opts.iconSize,
      // Start invisible — renderProjectiles skips opacity===0.
      // First updateProjectile sets real alpha and snaps position
      // (distance from origin triggers SKIP_ANIMATION_DISTANCE).
      opacity: 0,
      cachedPx: 0, cachedPy: 0, cachedDir: 0,
      text: opts.text ?? "",
    });
  }

  updateProjectile(id: number, state: ProjectileState): void {
    const p = this.projectiles.get(id);
    if (!p) return;

    // Snapshot current interpolated position as new "previous"
    const t = p.interpProgress;
    p.prevX = p.prevX + (p.targetX - p.prevX) * t;
    p.prevY = p.prevY + (p.targetY - p.prevY) * t;
    p.prevDir = p.prevDir + (p.targetDir - p.prevDir) * t;

    p.targetX = state.position[0];
    p.targetY = state.position[1];
    p.targetDir = closestEquivalentAngle(p.prevDir, state.direction);
    p.opacity = state.alpha;

    // MarkerManager provides per-frame interpolated positions, so the
    // distance between updates is small. Canvas interpolation adds
    // sub-frame smoothing (same pattern as entities).
    const dx = p.targetX - p.prevX;
    const dy = p.targetY - p.prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > SKIP_ANIMATION_DISTANCE || !this.smoothing) {
      p.prevX = p.targetX;
      p.prevY = p.targetY;
      p.prevDir = p.targetDir;
      p.interpProgress = 1;
    } else {
      p.interpProgress = 0;
    }
  }

  removeProjectile(id: number): void {
    this.projectiles.delete(id);
  }

  dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.map.off("zoomanim", this.onZoomAnim, this);
    this.canvas.removeEventListener("transitionend", this.onTransitionEnd);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.remove();
    this.entities.clear();
    this.projectiles.clear();
    this.fireLines = [];
  }

  // --------------- Zoom animation ---------------

  /**
   * Leaflet fires zoomanim with the target center/zoom. We compute a CSS
   * translate3d + scale transform matching Leaflet's own formula (see
   * L.Renderer._updateTransform). The CSS transition animates it smoothly.
   *
   * This works in BOTH legacy and MapLibre modes because even when MapLibre
   * jumps Leaflet's internal zoom instantly, zoomanim still provides the
   * correct target values relative to our drawnCenter/drawnZoom snapshot.
   */
  private onZoomAnim(ev: L.ZoomAnimEvent): void {
    if (!this.drawnCenter) return;
    const scale = this.map.getZoomScale(ev.zoom, this.drawnZoom);
    const viewHalf = this.map.getSize().multiplyBy(0.5);
    const currentCenterPoint = this.map.project(this.drawnCenter, ev.zoom);
    const destCenterPoint = this.map.project(ev.center, ev.zoom);
    const centerOffset = destCenterPoint.subtract(currentCenterPoint);
    const offset = viewHalf.multiplyBy(-scale).add(viewHalf).subtract(centerOffset);

    this.zoomScale = scale;
    this.zooming = true;
    // Enable CSS transition, then apply transform. The canvas is outside
    // _mapPane so the standard .leaflet-zoom-anim descendant rule doesn't
    // apply — we set the transition directly on the element.
    this.canvas.style.transition =
      "transform 0.25s cubic-bezier(0,0,0.25,1)";
    this.canvas.style.transform =
      `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
  }

  /** Called when the CSS transition on the canvas finishes. */
  private onTransitionEnd(): void {
    this.canvas.style.transition = "";
    this.canvas.style.transform = "";
    this.zooming = false;
    this.zoomScale = 1;
  }

  // --------------- Internals ---------------

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const container = this.map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
  }

  private startRenderLoop(): void {
    let lastTime = 0;
    const loop = (time: number) => {
      const dt = lastTime === 0 ? 0 : (time - lastTime) / 1000;
      lastTime = time;
      this.render(Math.min(dt, 0.1)); // Clamp to 100ms to prevent huge jumps
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private render(dt: number): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const entityLayerVisible = this.config.layerVisible();
    const projectileLayerVisible = this.config.projectileLayerVisible();
    if (!entityLayerVisible && !projectileLayerVisible && !this.gridVisible) return;
    if (this.entities.size === 0 && this.fireLines.length === 0 && this.projectiles.size === 0 && !this.gridVisible) return;

    // During zoom the CSS transform scales the canvas — counter-scale so
    // lines and text stay at their true pixel size.
    const cs = this.zooming ? 1 / this.zoomScale : 1;

    // Precompute affine projection: Arma [x,y] → container [px,py].
    // Both CRS modes are linear over the map extent (EPSG:3857 distortion
    // is <0.001% at equator), so 3 reference points give exact coefficients.
    // Avoids per-entity L.LatLng allocation and Leaflet CRS projection calls.
    if (!this.zooming) {
      const d = 10000;
      const p0 = this.map.latLngToContainerPoint(this.config.armaToLatLng([0, 0]));
      const p1 = this.map.latLngToContainerPoint(this.config.armaToLatLng([d, 0]));
      const p2 = this.map.latLngToContainerPoint(this.config.armaToLatLng([0, d]));
      this.projAx = (p1.x - p0.x) / d;
      this.projBx = (p2.x - p0.x) / d;
      this.projCx = p0.x;
      this.projAy = (p1.y - p0.y) / d;
      this.projBy = (p2.y - p0.y) / d;
      this.projCy = p0.y;
    }

    if (this.gridVisible) this.renderGrid(cs);
    this.renderFireLines(cs, w, h);
    if (projectileLayerVisible) this.renderProjectiles(dt, cs, w, h);
    if (entityLayerVisible) this.renderEntities(dt, cs, w, h);

    // Snapshot the current map center/zoom so the next zoom transform
    // has the correct baseline (matching Leaflet's _center / _zoom pattern).
    if (!this.zooming) {
      this.drawnCenter = this.map.getCenter();
      this.drawnZoom = this.map.getZoom();
    }
  }

  /** Project Arma [x,y] → container pixel using the precomputed affine. */
  private projArma(ax: number, ay: number): { x: number; y: number } {
    return {
      x: this.projAx * ax + this.projBx * ay + this.projCx,
      y: this.projAy * ax + this.projBy * ay + this.projCy,
    };
  }

  private renderGrid(cs: number): void {
    const ctx = this.ctx;
    const ws = this.config.worldSize;

    // During zoom, freeze bounds and zoom level so grid positions stay
    // consistent with the CSS transform (same pattern as entity rendering).
    if (!this.zooming) {
      this.gridCachedZoom = this.config.getZoom();
      const bounds = this.map.getBounds();
      const sw = this.config.latLngToArma(bounds.getSouthWest());
      const ne = this.config.latLngToArma(bounds.getNorthEast());
      this.gridCachedSwX = sw[0];
      this.gridCachedSwY = sw[1];
      this.gridCachedNeX = ne[0];
      this.gridCachedNeY = ne[1];
    }

    const { major, minor } = getGridLevels(this.gridCachedZoom, this.config.isMapLibreMode);

    // Compute bounds snapped to the finest interval
    const finest = minor ?? major;
    const armaBounds = {
      minX: Math.max(0, Math.floor(this.gridCachedSwX / finest) * finest),
      maxX: Math.min(ws, Math.ceil(this.gridCachedNeX / finest) * finest),
      minY: Math.max(0, Math.floor(this.gridCachedSwY / finest) * finest),
      maxY: Math.min(ws, Math.ceil(this.gridCachedNeY / finest) * finest),
    };

    // --- Minor grid (thin, subtle) ---
    if (minor) {
      const minorLines = computeGridLines(armaBounds, minor);
      const minorXPts: { sx: number; sy: number; ex: number; ey: number }[] = [];
      for (const x of minorLines.x) {
        if (x % major === 0) continue;
        const s = this.projArma(x, armaBounds.minY);
        const e = this.projArma(x, armaBounds.maxY);
        minorXPts.push({ sx: s.x, sy: s.y, ex: e.x, ey: e.y });
      }
      const minorYPts: { sx: number; sy: number; ex: number; ey: number }[] = [];
      for (const y of minorLines.y) {
        if (y % major === 0) continue;
        const s = this.projArma(armaBounds.minX, y);
        const e = this.projArma(armaBounds.maxX, y);
        minorYPts.push({ sx: s.x, sy: s.y, ex: e.x, ey: e.y });
      }

      for (const pass of [
        { color: "rgba(0,0,0,0.15)", width: 1.5 * cs },
        { color: "rgba(255,255,255,0.15)", width: 0.5 * cs },
      ] as const) {
        ctx.strokeStyle = pass.color;
        ctx.lineWidth = pass.width;
        ctx.beginPath();
        for (const p of minorXPts) { ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.ex, p.ey); }
        for (const p of minorYPts) { ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.ex, p.ey); }
        ctx.stroke();
      }
    }

    // --- Major grid (thicker, more visible) ---
    const majorBounds = {
      minX: Math.max(0, Math.floor(this.gridCachedSwX / major) * major),
      maxX: Math.min(ws, Math.ceil(this.gridCachedNeX / major) * major),
      minY: Math.max(0, Math.floor(this.gridCachedSwY / major) * major),
      maxY: Math.min(ws, Math.ceil(this.gridCachedNeY / major) * major),
    };
    const majorLines = computeGridLines(majorBounds, major);

    const majorXPts: { sx: number; sy: number; ex: number; ey: number; val: number }[] = [];
    for (const x of majorLines.x) {
      const s = this.projArma(x, armaBounds.minY);
      const e = this.projArma(x, armaBounds.maxY);
      majorXPts.push({ sx: s.x, sy: s.y, ex: e.x, ey: e.y, val: x });
    }
    const majorYPts: { sx: number; sy: number; ex: number; ey: number; val: number }[] = [];
    for (const y of majorLines.y) {
      const s = this.projArma(armaBounds.minX, y);
      const e = this.projArma(armaBounds.maxX, y);
      majorYPts.push({ sx: s.x, sy: s.y, ex: e.x, ey: e.y, val: y });
    }

    for (const pass of [
      { color: "rgba(0,0,0,0.25)", width: 2 * cs },
      { color: "rgba(255,255,255,0.35)", width: 0.75 * cs },
    ] as const) {
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = pass.width;
      ctx.beginPath();
      for (const p of majorXPts) { ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.ex, p.ey); }
      for (const p of majorYPts) { ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.ex, p.ey); }
      ctx.stroke();
    }

    // --- Labels (major grid only) ---
    const fontSize = Math.round(10 * cs);
    ctx.font = `${fontSize}px sans-serif`;

    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (const p of majorXPts) {
      const label = formatCoordLabel(p.val, major);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3 * cs;
      ctx.strokeText(label, p.sx, p.sy + 2 * cs);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(label, p.sx, p.sy + 2 * cs);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of majorYPts) {
      const label = formatCoordLabel(p.val, major);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3 * cs;
      ctx.strokeText(label, p.sx + 3 * cs, p.sy);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(label, p.sx + 3 * cs, p.sy);
    }
  }

  private renderFireLines(cs: number, w: number, h: number): void {
    const ctx = this.ctx;

    for (const fl of this.fireLines) {
      let fromPx: number;
      let fromPy: number;
      let toPx: number;
      let toPy: number;

      if (this.zooming) {
        fromPx = fl.cachedFromPx;
        fromPy = fl.cachedFromPy;
        toPx = fl.cachedToPx;
        toPy = fl.cachedToPy;
      } else {
        const fp = this.map.latLngToContainerPoint(
          this.config.armaToLatLng([fl.fromX, fl.fromY]),
        );
        const tp = this.map.latLngToContainerPoint(
          this.config.armaToLatLng([fl.toX, fl.toY]),
        );
        fromPx = fp.x;
        fromPy = fp.y;
        toPx = tp.x;
        toPy = tp.y;

        fl.cachedFromPx = fromPx;
        fl.cachedFromPy = fromPy;
        fl.cachedToPx = toPx;
        fl.cachedToPy = toPy;
      }

      // Frustum culling — skip if both endpoints are off-screen
      if (
        (fromPx < -40 && toPx < -40) ||
        (fromPx > w + 40 && toPx > w + 40) ||
        (fromPy < -40 && toPy < -40) ||
        (fromPy > h + 40 && toPy > h + 40)
      ) {
        continue;
      }

      ctx.globalAlpha = fl.opacity;
      ctx.strokeStyle = fl.color;
      ctx.lineWidth = fl.weight * cs;
      ctx.beginPath();
      ctx.moveTo(fromPx, fromPy);
      ctx.lineTo(toPx, toPy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private renderProjectiles(dt: number, cs: number, w: number, h: number): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const iconCache = this.config.iconCache;
    const interpDur = this.interpDurationSec;
    const labelFontSize = Math.round(11 * cs);
    const fontNormal =
      `${labelFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

    for (const p of this.projectiles.values()) {
      if (p.opacity === 0) continue;

      if (this.smoothing && p.interpProgress < 1) {
        p.interpProgress = interpDur > 0
          ? Math.min(1, p.interpProgress + dt / interpDur)
          : 1;
      }

      let px: number;
      let py: number;
      let dir: number;

      if (this.zooming) {
        px = p.cachedPx;
        py = p.cachedPy;
        dir = p.cachedDir;
      } else {
        const t = p.interpProgress;
        const x = p.prevX + (p.targetX - p.prevX) * t;
        const y = p.prevY + (p.targetY - p.prevY) * t;
        dir = p.prevDir + (p.targetDir - p.prevDir) * t;

        px = this.projAx * x + this.projBx * y + this.projCx;
        py = this.projAy * x + this.projBy * y + this.projCy;

        p.cachedPx = px;
        p.cachedPy = py;
        p.cachedDir = dir;
      }

      if (px < -40 || px > w + 40 || py < -40 || py > h + 40) continue;

      const img = iconCache.getOrLoad(p.iconUrl);
      if (!img) continue;

      const [iw, ih] = p.iconSize;
      const dw = iw * cs;
      const dh = ih * cs;

      const rad = (dir * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      ctx.setTransform(
        dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * px, dpr * py,
      );
      ctx.globalAlpha = p.opacity;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);

      // Draw label above icon (matching Leaflet popup placement)
      if (p.text) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = fontNormal;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3 * cs;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.fillStyle = "#ffffff";
        const labelY = py - dh / 2 - 2 * cs;
        ctx.strokeText(p.text, px, labelY);
        ctx.fillText(p.text, px, labelY);
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  private renderEntities(dt: number, cs: number, w: number, h: number): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const hideThreshold = this.config.isMapLibreMode ? 14 : 4;
    const hideLabels = this.config.getZoom() <= hideThreshold;
    const nameMode = this.config.nameDisplayMode();
    const iconCache = this.config.iconCache;
    const interpDur = this.interpDurationSec;
    const labelFontSize = Math.round(11 * cs);
    const labelLineHeight = labelFontSize * 1.3;
    const fontNormal =
      `${labelFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    const fontBold =
      `bold ${labelFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

    for (const e of this.entities.values()) {
      // Skip hidden (in vehicle) entities
      if (e.opacity === 0) continue;

      // Advance interpolation
      if (this.smoothing && e.interpProgress < 1) {
        e.interpProgress = interpDur > 0
          ? Math.min(1, e.interpProgress + dt / interpDur)
          : 1;
      }
      let px: number;
      let py: number;
      let dir: number;

      if (this.zooming) {
        // During zoom: reuse cached positions — the CSS transform handles
        // animating them to their new screen locations.
        px = e.cachedPx;
        py = e.cachedPy;
        dir = e.cachedDir;
      } else {
        // Normal: interpolate in Arma space, then project to container pixels.
        const t = e.interpProgress;
        const x = e.prevX + (e.targetX - e.prevX) * t;
        const y = e.prevY + (e.targetY - e.prevY) * t;
        dir = e.prevDir + (e.targetDir - e.prevDir) * t;

        px = this.projAx * x + this.projBx * y + this.projCx;
        py = this.projAy * x + this.projBy * y + this.projCy;

        // Cache for zoom animation
        e.cachedPx = px;
        e.cachedPy = py;
        e.cachedDir = dir;
      }

      // Frustum culling — skip if off-screen (with generous margin)
      if (px < -40 || px > w + 40 || py < -40 || py > h + 40) {
        continue;
      }

      // Draw icon (rotated, counter-scaled during zoom)
      const img = iconCache.get(e.iconType, e.iconVariant);
      if (img) {
        const [iw, ih] = e.iconSize;
        const dw = iw * cs;
        const dh = ih * cs;
        // Man icons rotate around 50% 60% (matching leaflet-rotatedmarker's rotationOrigin)
        const offy = e.iconType === "man" ? 0.1 * dh : 0;

        // Hit flash: tint the icon via an offscreen canvas (isolates source-atop
        // to just this icon's pixels, avoiding bleed onto other canvas content).
        let hitAlpha = 0;
        if (e.hitStartTime > 0) {
          const elapsed = performance.now() - e.hitStartTime;
          if (elapsed < HIT_FLASH_DURATION_MS) {
            hitAlpha = 1 - elapsed / HIT_FLASH_DURATION_MS;
          } else {
            e.hitStartTime = 0;
          }
        }

        // Set rotated transform centered on entity (replaces save/translate/rotate/restore)
        const rad = (dir * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        ctx.setTransform(
          dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * px, dpr * py,
        );
        ctx.globalAlpha = e.opacity;

        if (hitAlpha > 0) {
          const hc = this.hitCanvas;
          const hctx = this.hitCtx;
          const pw = Math.ceil(dw) + 2;
          const ph = Math.ceil(dh) + 2;
          if (hc.width < pw || hc.height < ph) {
            hc.width = pw;
            hc.height = ph;
          }
          hctx.clearRect(0, 0, hc.width, hc.height);
          hctx.globalCompositeOperation = "source-over";
          hctx.globalAlpha = 1;
          hctx.drawImage(img, 1, 1, dw, dh);
          hctx.globalCompositeOperation = "source-atop";
          hctx.fillStyle = HIT_FLASH_COLOR;
          hctx.globalAlpha = hitAlpha;
          hctx.fillRect(0, 0, hc.width, hc.height);
          ctx.drawImage(hc, 0, 0, pw, ph, -dw / 2 - 1, -dh / 2 + offy - 1, pw, ph);
        } else {
          ctx.drawImage(img, -dw / 2, -dh / 2 + offy, dw, dh);
        }

        // Reset to base DPR transform for label drawing
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Draw label (not rotated, positioned above icon, counter-scaled during zoom).
      // Vehicle types stay visible in "players" mode so AI vehicles can still be
      // identified without showing every AI infantry name.
      const isVehicle = e.crew !== undefined;
      if (
        !hideLabels &&
        nameMode !== "none" &&
        !e.isInVehicle &&
        (nameMode === "all" || e.isPlayer || isVehicle)
      ) {
        const [, ih] = e.iconSize;
        const crew = e.crew;
        const hasCrew = crew && crew.names.length > 0;
        // Stack lines upward from just above the icon
        const baseY = py - (ih * cs) / 2 - 4 * cs;

        ctx.globalAlpha = e.opacity;
        ctx.textBaseline = "bottom";

        if (!hasCrew) {
          // Unit label (or vehicle with no player crew): text outline, no background
          const label = crew
            ? `${e.name} (${crew.count})`
            : e.name;
          ctx.font = fontNormal;
          ctx.textAlign = "center";
          ctx.lineWidth = 3 * cs;
          ctx.strokeStyle = "rgba(0,0,0,0.7)";
          ctx.fillStyle = "#ffffff";
          ctx.strokeText(label, px, baseY);
          ctx.fillText(label, px, baseY);
        } else {
          // Vehicle with player crew: background pill + side-colored crew names
          const titleLine = `${e.name} (${crew.count})`;
          const lines = [titleLine, ...crew.names];
          const sideColor = (e.side && SIDE_COLORS[e.side]) || "#ffffff";
          const padX = 4 * cs;
          const padY = 2 * cs;

          ctx.textAlign = "left";
          let maxW: number;
          if (e.cachedLabelFontSize === labelFontSize) {
            maxW = e.cachedLabelMaxW;
          } else {
            maxW = 0;
            for (let i = 0; i < lines.length; i++) {
              ctx.font = i === 0 ? fontBold : fontNormal;
              const mw = ctx.measureText(lines[i]).width;
              if (mw > maxW) maxW = mw;
            }
            e.cachedLabelMaxW = maxW;
            e.cachedLabelFontSize = labelFontSize;
          }

          // Background pill
          const bgW = maxW + padX * 2;
          const bgH = lines.length * labelLineHeight + padY * 2;
          const bgX = px - bgW / 2;
          const bgY = baseY - bgH + padY;
          const r = 3 * cs;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.beginPath();
          ctx.roundRect(bgX, bgY, bgW, bgH, r);
          ctx.fill();

          // Text lines
          const leftX = px - maxW / 2;
          for (let i = lines.length - 1; i >= 0; i--) {
            ctx.font = i === 0 ? fontBold : fontNormal;
            ctx.fillStyle = i === 0 ? "#ffffff" : sideColor;
            const y = baseY - (lines.length - 1 - i) * labelLineHeight;
            ctx.fillText(lines[i], leftX, y);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
