# Canvas Coordinate Grid — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Draw the coordinate grid (lines + labels) on the existing entity canvas instead of creating/destroying DOM elements on every zoom/pan.

**Architecture:** `EntityCanvasLayer` gains grid config and a `gridVisible` flag. The render loop draws grid lines (double-stroke for contrast) and labels (`fillText`) before fire lines and entities. `CanvasLeafletRenderer` overrides `setLayerVisible` for grid and suppresses the Leaflet grid layer. Pure grid math (`gridUtils.ts`) is reused unchanged.

**Tech Stack:** HTML5 Canvas 2D, TypeScript

---

### Task 1: Add grid config and visibility to EntityCanvasLayer

**Files:**
- Modify: `ui/src/renderers/leaflet/entityCanvasLayer.ts`

**Step 1: Extend EntityCanvasConfig with grid fields (after line 77)**

Add to the `EntityCanvasConfig` interface:

```typescript
  // Grid
  worldSize: number;
  latLngToArma: (latlng: L.LatLng) => ArmaCoord;
```

**Step 2: Add grid imports (line 1 area)**

Add to imports:

```typescript
import { getGridInterval, computeGridLines, formatCoordLabel } from "./gridUtils";
```

**Step 3: Add gridVisible field (after line 102, alongside fireLines)**

```typescript
  private gridVisible = false;
```

**Step 4: Add setGridVisible public method (after clearFireLines, around line 244)**

```typescript
  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
  }
```

**Step 5: Update the early return in render() (line 332)**

Change:
```typescript
    if (this.entities.size === 0 && this.fireLines.length === 0) return;
```
To:
```typescript
    if (this.entities.size === 0 && this.fireLines.length === 0 && !this.gridVisible) return;
```

**Step 6: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: Errors in `canvasLeafletRenderer.ts` (missing new config fields) — expected, we fix those in Task 3.

**Step 7: Commit**

```bash
git add ui/src/renderers/leaflet/entityCanvasLayer.ts
git commit -m "feat: add grid config and visibility to EntityCanvasLayer"
```

---

### Task 2: Draw grid in the render loop

**Files:**
- Modify: `ui/src/renderers/leaflet/entityCanvasLayer.ts`

**Step 1: Add grid drawing block in render(), after the canvas clear and before fire lines (after line 332, the early return)**

Insert before the `const hideThreshold` line:

```typescript
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

        // Vertical lines (constant X)
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

        // Horizontal lines (constant Y)
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
      ctx.textBaseline = "top";

      // X labels (bottom edge)
      for (const x of gridLines.x) {
        const pos = this.map.latLngToContainerPoint(
          this.config.armaToLatLng([x, armaBounds.minY]),
        );
        const label = formatCoordLabel(x, interval);
        ctx.textAlign = "center";
        // Outline
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3 * cs;
        ctx.strokeText(label, pos.x, pos.y + 2 * cs);
        // Fill
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
        // Outline
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3 * cs;
        ctx.strokeText(label, pos.x + 3 * cs, pos.y);
        // Fill
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(label, pos.x + 3 * cs, pos.y);
      }
    }
```

**Step 2: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: Still errors in `canvasLeafletRenderer.ts` (missing config fields) — fixed next task.

**Step 3: Commit**

```bash
git add ui/src/renderers/leaflet/entityCanvasLayer.ts
git commit -m "feat: draw coordinate grid in canvas render loop"
```

---

### Task 3: Wire up grid in CanvasLeafletRenderer

**Files:**
- Modify: `ui/src/renderers/leaflet/canvasLeafletRenderer.ts`

**Step 1: Make latLngToArma accessible from subclass**

In `ui/src/renderers/leaflet/leafletRenderer.ts`, change `latLngToArma` from `private` to `protected` (line 729):

```typescript
  protected latLngToArma(latlng: L.LatLng): ArmaCoord {
```

**Step 2: Add grid config fields to the EntityCanvasLayer constructor call (canvasLeafletRenderer.ts lines 50-57)**

Replace the existing config object:
```typescript
    this.canvasLayer = new EntityCanvasLayer(this.map, {
      armaToLatLng: (c) => this.armaToLatLng(c),
      iconCache: this.iconCache,
      getZoom: () => this.map.getZoom(),
      isMapLibreMode: this.useMapLibreMode,
      nameDisplayMode: () => this.nameDisplayMode(),
      layerVisible: () => this.layerVisibility().entities ?? true,
    });
```

With:
```typescript
    this.canvasLayer = new EntityCanvasLayer(this.map, {
      armaToLatLng: (c) => this.armaToLatLng(c),
      iconCache: this.iconCache,
      getZoom: () => this.map.getZoom(),
      isMapLibreMode: this.useMapLibreMode,
      nameDisplayMode: () => this.nameDisplayMode(),
      layerVisible: () => this.layerVisibility().entities ?? true,
      worldSize: world.worldSize,
      latLngToArma: (ll) => this.latLngToArma(ll),
    });
```

**Step 3: Override setLayerVisible to intercept grid toggle (after removeLine, before closing brace)**

```typescript
  override setLayerVisible(layer: import("../renderer.types").RenderLayer, visible: boolean): void {
    if (layer === "grid") {
      this.canvasLayer?.setGridVisible(visible);
    }
    super.setLayerVisible(layer, visible);
  }
```

Note: We still call `super.setLayerVisible` so the signal updates and UI stays in sync. The base class will try to toggle the Leaflet grid layer, but since the base `init()` already created it, we need to suppress that. Simplest approach: let the base class do its thing (it's a no-op if the grid layer exists but is never shown on the map — our canvas draws it instead). Actually — the base class creates `this.gridLayer` in `init()` but doesn't add it to the map by default (`grid: false` in initial visibility). The base toggle code checks `this.gridLayer` existence and adds/removes from map. If a user toggles grid ON, the base class would add the DOM grid AND our canvas draws one. We need to suppress the DOM grid.

**Step 4: Suppress DOM grid layer creation**

Override the grid layer to null after `super.init()`. Add after `super.init(container, world);` (line 48):

```typescript
    // Suppress DOM-based grid — canvas layer handles grid rendering
    if (this.gridLayer && this.map.hasLayer(this.gridLayer)) {
      this.map.removeLayer(this.gridLayer);
    }
    this.gridLayer = null;
```

For this to work, `gridLayer` must be `protected`. In `leafletRenderer.ts`, change from `private` to `protected` (line 167):

```typescript
  protected gridLayer: L.LayerGroup | null = null;
```

**Step 5: Update JSDoc (canvasLeafletRenderer.ts line 40)**

Change:
```
 * (map tiles, briefing markers, grid, styles, events) is inherited unchanged.
```
To:
```
 * (map tiles, briefing markers, styles, events) is inherited unchanged.
 * The coordinate grid is also drawn on canvas.
```

**Step 6: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: No new errors (only pre-existing map-manager error)

**Step 7: Run tests**

Run: `cd ui && npx vitest run`
Expected: All tests pass

**Step 8: Commit**

```bash
git add -u
git commit -m "feat: wire up canvas grid in CanvasLeafletRenderer"
```

---

### Task 4: Add tests for grid visibility

**Files:**
- Modify: `ui/src/renderers/leaflet/__tests__/entityCanvasLayer.test.ts`

**Step 1: Update makeConfig to include new required fields**

In the `makeConfig` function, add:

```typescript
    worldSize: 30720,
    latLngToArma: (ll) => [ll.lng, ll.lat] as ArmaCoord,
```

**Step 2: Add grid visibility tests (new describe block before removeEntity)**

```typescript
  describe("setGridVisible", () => {
    it("grid is hidden by default", () => {
      expect((layer as any).gridVisible).toBe(false);
    });

    it("setGridVisible toggles the flag", () => {
      layer.setGridVisible(true);
      expect((layer as any).gridVisible).toBe(true);
      layer.setGridVisible(false);
      expect((layer as any).gridVisible).toBe(false);
    });
  });
```

**Step 3: Run tests**

Run: `cd ui && npx vitest run src/renderers/leaflet/__tests__/entityCanvasLayer.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add ui/src/renderers/leaflet/__tests__/entityCanvasLayer.test.ts
git commit -m "test: add grid visibility tests"
```

---

### Task 5: Manual verification

**Step 1:** Start dev server: `cd ui && npm run dev`

**Step 2:** Open a recording with `?canvas` — toggle grid visibility in the UI

**Step 3:** Verify:
- Grid lines have dark outline + light line (visible on both light and dark maps)
- Labels are readable with text outline
- Grid interval adapts to zoom level (5km → 1km → 500m → 100m)
- Zoom animation keeps grid lines in sync with map tiles
- Grid toggle in UI shows/hides the canvas grid
- Non-canvas renderer still shows the original DOM grid

---

## Verification Summary

1. TypeScript compiles: `cd ui && npx tsc --noEmit`
2. Tests pass: `cd ui && npx vitest run`
3. Visual: grid lines visible on both light and dark maps
4. Toggle: grid visibility toggle works in UI
5. No regressions: non-canvas renderer unchanged
