import L from "leaflet";
import type { ArmaCoord } from "../../utils/coordinates";
import type { AliveState, Side } from "../../data/types";
import type { EntityMarkerOpts, EntityMarkerState } from "../renderer.types";
import { closestEquivalentAngle, SKIP_ANIMATION_DISTANCE } from "../../utils/math";
import { CanvasIconCache, resolveVariant } from "./canvasIcons";
import { getGridInterval, computeGridLines, formatCoordLabel } from "./gridUtils";

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
  // Grid
  worldSize: number;
  latLngToArma: (latlng: L.LatLng) => ArmaCoord;
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
  private fireLines: FireLine[] = [];
  private gridVisible = false;

  // Reusable offscreen canvas for per-icon hit tint (avoids source-atop bleed)
  private hitCanvas: OffscreenCanvas;
  private hitCtx: OffscreenCanvasRenderingContext2D;

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
      hitStartTime: 0,
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
    this.fireLines = [];
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

    if (!this.config.layerVisible() && !this.gridVisible) return;
    if (this.entities.size === 0 && this.fireLines.length === 0 && !this.gridVisible) return;

    // During zoom the CSS transform scales the canvas — counter-scale so
    // lines and text stay at their true pixel size.
    const cs = this.zooming ? 1 / this.zoomScale : 1;

    // Coordinate grid (behind fire lines and entities)
    if (this.gridVisible) {
      const zoom = this.config.getZoom();
      const interval = getGridInterval(zoom, this.config.isMapLibreMode);
      const bounds = this.map.getBounds();
      const sw = this.config.latLngToArma(bounds.getSouthWest());
      const ne = this.config.latLngToArma(bounds.getNorthEast());

      const armaBounds = {
        minX: Math.max(0, Math.floor(sw[0] / interval) * interval),
        maxX: Math.min(this.config.worldSize, Math.ceil(ne[0] / interval) * interval),
        minY: Math.max(0, Math.floor(sw[1] / interval) * interval),
        maxY: Math.min(this.config.worldSize, Math.ceil(ne[1] / interval) * interval),
      };

      const gridLines = computeGridLines(armaBounds, interval);

      // Double-stroke: dark outline then light line for contrast on any map
      for (const pass of [
        { color: "rgba(0,0,0,0.3)", width: 2.5 * cs },
        { color: "rgba(255,255,255,0.4)", width: 1 * cs },
      ] as const) {
        ctx.strokeStyle = pass.color;
        ctx.lineWidth = pass.width;
        ctx.beginPath();

        for (const x of gridLines.x) {
          const start = this.map.latLngToContainerPoint(
            this.config.armaToLatLng([x, armaBounds.minY]),
          );
          const end = this.map.latLngToContainerPoint(
            this.config.armaToLatLng([x, armaBounds.maxY]),
          );
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
        }

        for (const y of gridLines.y) {
          const start = this.map.latLngToContainerPoint(
            this.config.armaToLatLng([armaBounds.minX, y]),
          );
          const end = this.map.latLngToContainerPoint(
            this.config.armaToLatLng([armaBounds.maxX, y]),
          );
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
        }

        ctx.stroke();
      }

      // Labels
      const fontSize = Math.round(10 * cs);
      ctx.font = `${fontSize}px sans-serif`;

      // X labels (bottom edge)
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      for (const x of gridLines.x) {
        const pos = this.map.latLngToContainerPoint(
          this.config.armaToLatLng([x, armaBounds.minY]),
        );
        const label = formatCoordLabel(x, interval);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3 * cs;
        ctx.strokeText(label, pos.x, pos.y + 2 * cs);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(label, pos.x, pos.y + 2 * cs);
      }

      // Y labels (left edge)
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const y of gridLines.y) {
        const pos = this.map.latLngToContainerPoint(
          this.config.armaToLatLng([armaBounds.minX, y]),
        );
        const label = formatCoordLabel(y, interval);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3 * cs;
        ctx.strokeText(label, pos.x + 3 * cs, pos.y);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(label, pos.x + 3 * cs, pos.y);
      }
    }

    const hideThreshold = this.config.isMapLibreMode ? 14 : 4;
    const hideLabels = this.config.getZoom() <= hideThreshold;
    const nameMode = this.config.nameDisplayMode();
    const iconCache = this.config.iconCache;
    const interpDur = this.interpDurationSec;

    // Draw fire lines (behind entity icons)
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

      ctx.save();
      ctx.globalAlpha = fl.opacity;
      ctx.strokeStyle = fl.color;
      ctx.lineWidth = fl.weight * cs;
      ctx.beginPath();
      ctx.moveTo(fromPx, fromPy);
      ctx.lineTo(toPx, toPy);
      ctx.stroke();
      ctx.restore();
    }

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

        if (hitAlpha > 0) {
          const hc = this.hitCanvas;
          const hctx = this.hitCtx;
          // Resize offscreen canvas if needed (icons are small, 64x64 covers all)
          const pw = Math.ceil(dw) + 2;
          const ph = Math.ceil(dh) + 2;
          if (hc.width < pw || hc.height < ph) {
            hc.width = pw;
            hc.height = ph;
          }
          hctx.clearRect(0, 0, hc.width, hc.height);
          // Draw icon centered in offscreen canvas
          hctx.globalCompositeOperation = "source-over";
          hctx.globalAlpha = 1;
          hctx.drawImage(img, 1, 1, dw, dh);
          // Tint only the icon pixels
          hctx.globalCompositeOperation = "source-atop";
          hctx.fillStyle = HIT_FLASH_COLOR;
          hctx.globalAlpha = hitAlpha;
          hctx.fillRect(0, 0, hc.width, hc.height);
          // Blit tinted icon to main canvas
          ctx.save();
          ctx.globalAlpha = e.opacity;
          ctx.translate(px, py);
          ctx.rotate((dir * Math.PI) / 180);
          ctx.drawImage(hc, 0, 0, pw, ph, -dw / 2 - 1, -dh / 2 + offy - 1, pw, ph);
          ctx.restore();
        } else {
          ctx.save();
          ctx.globalAlpha = e.opacity;
          ctx.translate(px, py);
          ctx.rotate((dir * Math.PI) / 180);
          ctx.drawImage(img, -dw / 2, -dh / 2 + offy, dw, dh);
          ctx.restore();
        }
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
