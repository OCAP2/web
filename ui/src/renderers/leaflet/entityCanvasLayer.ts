import L from "leaflet";
import type { ArmaCoord } from "../../utils/coordinates";
import type { AliveState, Side } from "../../data/types";
import type { EntityMarkerOpts, EntityMarkerState } from "../renderer.types";
import { closestEquivalentAngle, SKIP_ANIMATION_DISTANCE } from "../../utils/math";
import { getTransitionDuration } from "./leafletSmoothing";
import { CanvasIconCache, resolveVariant } from "./canvasIcons";

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
  isPlayer: boolean;
  isInVehicle: boolean;
  alive: AliveState;

  // Cached container pixel position — reused during zoom so the CSS transform
  // handles position animation while we counter-scale icons.
  cachedPx: number;
  cachedPy: number;
  cachedDir: number;
}

// --------------- Config passed from the renderer ---------------

export interface EntityCanvasConfig {
  armaToLatLng: (coords: ArmaCoord) => L.LatLng;
  iconCache: CanvasIconCache;
  getZoom: () => number;
  isMapLibreMode: boolean;
  nameDisplayMode: () => "players" | "all" | "none";
  layerVisible: () => boolean;
}

// --------------- Helpers ---------------

/** Strip HTML tags from vehicle display names for canvas text. */
function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, " \u00B7 ").replace(/<[^>]*>/g, "");
}

// --------------- Canvas layer ---------------

export class EntityCanvasLayer {
  private map: L.Map;
  private config: EntityCanvasConfig;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  private entities = new Map<number, CanvasEntity>();

  private smoothing = false;
  private interpDurationSec = 1;
  private zooming = false;
  private zoomScale = 1;

  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(map: L.Map, config: EntityCanvasConfig) {
    this.map = map;
    this.config = config;

    // Create canvas element
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:625;";
    this.ctx = this.canvas.getContext("2d")!;

    // Insert into map container
    map.getContainer().appendChild(this.canvas);

    // Size canvas to match container
    this.resize();

    // Watch for container resizes
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(map.getContainer());

    // Zoom animation: apply a matching CSS transform so entities scale
    // in sync with the map tiles during the zoom transition.
    map.on("zoomanim", this.onZoomAnim, this);
    map.on("zoomend", this.onZoomEnd, this);

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
      prevDir: 0,
      targetX: opts.position[0],
      targetY: opts.position[1],
      targetDir: 0,
      interpProgress: 1, // start at target
      iconType,
      iconVariant: variant,
      iconSize: this.config.iconCache.getSize(iconType),
      opacity: 1,
      name: opts.name,
      isPlayer: opts.isPlayer,
      isInVehicle: false,
      alive: 1,
      cachedPx: 0,
      cachedPy: 0,
      cachedDir: 0,
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

    // Snap immediately for teleports or when smoothing is off (seek/pause)
    const dx = e.targetX - e.prevX;
    const dy = e.targetY - e.prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > SKIP_ANIMATION_DISTANCE || !this.smoothing) {
      e.prevX = e.targetX;
      e.prevY = e.targetY;
      e.prevDir = e.targetDir;
      e.interpProgress = 1;
    } else {
      e.interpProgress = 0;
    }

    // Update visual state
    const iconType = this.config.iconCache.resolveType(state.iconType);
    const isHit = !!state.hit && state.alive !== 0;
    e.iconVariant = resolveVariant(state.alive, state.side, isHit);
    e.iconType = iconType;
    e.iconSize = this.config.iconCache.getSize(iconType);
    e.opacity = state.isInVehicle ? 0 : state.alive === 0 ? 0.4 : 1;
    e.name = state.name;
    e.isPlayer = state.isPlayer;
    e.isInVehicle = state.isInVehicle;
    e.alive = state.alive;
  }

  removeEntity(id: number): void {
    this.entities.delete(id);
  }

  setSmoothingEnabled(enabled: boolean, speed?: number): void {
    this.smoothing = enabled;
    if (speed !== undefined) {
      this.interpDurationSec = getTransitionDuration(speed);
    }
    // Don't snap on disable — entities freeze at their current interpolated
    // position. Seeking while paused snaps via updateEntity() instead.
  }

  dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.map.off("zoomanim", this.onZoomAnim, this);
    this.map.off("zoomend", this.onZoomEnd, this);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.remove();
    this.entities.clear();
  }

  // --------------- Zoom animation ---------------

  private onZoomAnim(ev: L.ZoomAnimEvent): void {
    // Compute the zoom pivot — the point in container space that stays fixed
    // during zoom (e.g. mouse cursor for scroll-zoom, map center for buttons).
    //
    // Given: after zoom, ev.center will be at container center (w/2, h/2).
    // Currently ev.center is at container point C.
    // For CSS `transform-origin: ox,oy; scale(s)`:
    //   ox + (C.x - ox)*s = w/2   →   ox = (w/2 - C.x*s) / (1-s)
    const scale = this.map.getZoomScale(ev.zoom);
    const c = this.map.latLngToContainerPoint(ev.center);
    const container = this.map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const denom = 1 - scale;

    if (Math.abs(denom) < 1e-6) return; // no actual zoom change

    const ox = (w / 2 - c.x * scale) / denom;
    const oy = (h / 2 - c.y * scale) / denom;

    this.zoomScale = scale;
    this.canvas.style.transition = "transform 250ms ease-out";
    this.canvas.style.transformOrigin = `${ox}px ${oy}px`;
    this.canvas.style.transform = `scale(${scale})`;
    this.zooming = true;
  }

  private onZoomEnd(): void {
    this.canvas.style.transition = "";
    this.canvas.style.transform = "";
    this.canvas.style.transformOrigin = "";
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

    if (!this.config.layerVisible()) return;
    if (this.entities.size === 0) return;

    const hideThreshold = this.config.isMapLibreMode ? 14 : 4;
    const hideLabels = this.config.getZoom() <= hideThreshold;
    const nameMode = this.config.nameDisplayMode();
    const iconCache = this.config.iconCache;
    const interpDur = this.interpDurationSec;

    // During zoom the CSS transform scales the canvas — counter-scale icons
    // and labels so they stay at their true pixel size.
    const cs = this.zooming ? 1 / this.zoomScale : 1;

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

        const pt = this.map.latLngToContainerPoint(
          this.config.armaToLatLng([x, y]),
        );
        px = pt.x;
        py = pt.y;

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
        ctx.save();
        ctx.globalAlpha = e.opacity;
        ctx.translate(px, py);
        ctx.rotate((dir * Math.PI) / 180);
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }

      // Draw label (not rotated, positioned above icon, counter-scaled during zoom)
      if (
        !hideLabels &&
        nameMode !== "none" &&
        !e.isInVehicle &&
        (nameMode === "all" || (nameMode === "players" && e.isPlayer))
      ) {
        const [, ih] = e.iconSize;
        const labelY = py - (ih * cs) / 2 - 4 * cs;
        const plainName = stripHtml(e.name);
        const fontSize = Math.round(11 * cs);

        ctx.save();
        ctx.globalAlpha = e.opacity;
        ctx.font =
          `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3 * cs;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.fillStyle = "#ffffff";
        ctx.strokeText(plainName, px, labelY);
        ctx.fillText(plainName, px, labelY);
        ctx.restore();
      }
    }
  }
}
