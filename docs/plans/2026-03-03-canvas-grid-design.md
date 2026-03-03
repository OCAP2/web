# Canvas Coordinate Grid

## Problem

The coordinate grid creates `L.Polyline` + `L.Marker` (divIcon) DOM elements on every zoom/pan, tears them all down, and rebuilds. Additionally, the current white-on-transparent color (`rgba(255,255,255,0.3)`) is invisible on light maps.

## Solution

Draw the grid on the existing entity canvas (first in the rAF loop, before fire lines and entities). Use a double-stroke technique (dark outline + light line) for visibility on both light and dark maps.

**Data flow:**
- `EntityCanvasLayer` receives grid config (worldSize, coordinate converters, mapLibreMode) at construction
- Each frame, if grid visible: `getGridInterval()` → `computeGridLines()` → `ctx.moveTo/lineTo` + `ctx.fillText`
- `gridUtils.ts` reused unchanged (pure functions)

**Line style:** Double stroke — wider dark line (`rgba(0,0,0,0.3)`) then thinner light line (`rgba(255,255,255,0.4)`) on top. Visible on any background.

**Labels:** `ctx.fillText` with dark outline stroke behind white fill, matching the double-stroke approach. Bottom-edge for X, left-edge for Y.

**Visibility toggle:** `CanvasLeafletRenderer` overrides `setLayerVisible('grid')` to set a flag on `EntityCanvasLayer`. Suppresses Leaflet's grid layer creation.

**Zoom animation:** Grid uses cached positions during zoom (same pattern as entities/fire lines).

### Files modified

| File | Change |
|------|--------|
| `entityCanvasLayer.ts` | Add grid config, `setGridVisible()`, grid drawing in render loop |
| `canvasLeafletRenderer.ts` | Pass grid config at init, override `setLayerVisible` for grid, suppress Leaflet grid layer |
