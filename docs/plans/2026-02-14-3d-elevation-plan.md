# 3D Elevation Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render entities at their actual Z elevation when 3D mode is toggled on, combining pitched MapLibre buildings with CSS-offset Leaflet markers.

**Architecture:** Rename "3D Buildings" toggle to "3D". When enabled: pitch the MapLibre GL map to 45°, and offset entity markers vertically based on their Z coordinate using a `_setPos` monkey-patch. The offset scales with zoom and pitch via `elevationPx = elevation_m * pixelsPerMeter * sin(pitch)`. When disabled: pitch=0, no offset.

**Tech Stack:** Leaflet, MapLibre GL JS (via maplibre-gl-leaflet adapter), SolidJS (TopBar UI)

---

### Task 1: Rename RenderLayer and i18n from "buildings3D" to "3d"

**Files:**
- Modify: `ui/src/renderers/renderer.types.ts:84-91`
- Modify: `ui/src/i18n/locales.ts:850-857`

**Step 1: Update the RenderLayer type**

In `ui/src/renderers/renderer.types.ts`, change the `"buildings3D"` variant to `"3d"`:

```typescript
export type RenderLayer =
  | "entities"
  | "briefingMarkers"
  | "systemMarkers"
  | "projectileMarkers"
  | "grid"
  | "mapIcons"
  | "3d";
```

**Step 2: Rename i18n key and update labels**

In `ui/src/i18n/locales.ts`, rename `layer_buildings_3d` to `layer_3d` and update the labels:

```typescript
  layer_3d: {
    ru: "3D",
    en: "3D",
    de: "3D",
    cs: "3D",
    it: "3D",
    fr: "3D",
  },
```

**Step 3: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit 2>&1 | head -30`
Expected: Errors about `"buildings3D"` references in TopBar.tsx and leaflet-renderer.ts (we fix those in subsequent tasks).

---

### Task 2: Update TopBar UI to use "3d" layer key

**Files:**
- Modify: `ui/src/pages/recording-playback/components/TopBar.tsx:69-117`

**Step 1: Rename layer key in default state**

Change `buildings3D: true` to `3d: true` in the `layers` signal initializer (line 76):

```typescript
  const [layers, setLayers] = createSignal<Record<string, boolean>>({
    entities: true,
    systemMarkers: true,
    briefingMarkers: true,
    projectileMarkers: true,
    grid: false,
    mapIcons: true,
    "3d": true,
  });
```

**Step 2: Update the layerItems memo**

Change the `buildings3D` push to `3d` (line 114):

```typescript
    items.push({ key: "3d", label: t("layer_3d") });
```

**Step 3: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit 2>&1 | head -30`
Expected: Only errors from leaflet-renderer.ts (fixed next).

---

### Task 3: Add 3D mode state and pitch control to LeafletRenderer

**Files:**
- Modify: `ui/src/renderers/leaflet/leaflet-renderer.ts:140-180` (state fields)
- Modify: `ui/src/renderers/leaflet/leaflet-renderer.ts:1270-1333` (overlay/visibility methods)
- Modify: `ui/src/renderers/leaflet/leaflet-renderer.ts:1120-1132` (setLayerVisible "buildings3D" → "3d")

**Step 1: Add 3D state fields**

After the existing `private buildings3DLayer` field (line 171), add:

```typescript
  // 3D mode state
  private is3DMode = false;
  private elevationScale = 0; // pixels per meter of elevation, cached
  private static readonly PITCH_3D = 45; // fixed pitch angle in degrees
```

**Step 2: Rename buildings3DLayer to threeDLayer and update references**

Rename all occurrences of `buildings3DLayer` to `threeDLayer` in the file. Update all references:
- Field declaration (line 171): `private threeDLayer: L.LayerGroup | null = null;`
- `addOverlayControl()` (line 1280): `this.threeDLayer = this.createMapLibreToggleLayer(...)`
- Lines 1283, 1358-1359, 1369-1371: all `buildings3DLayer` → `threeDLayer`

**Step 3: Change the toggle layer callback to handle full 3D mode**

In `addOverlayControl()`, change the `threeDLayer` toggle callback to enable/disable the full 3D mode instead of just building visibility:

```typescript
    this.threeDLayer = this.createMapLibreToggleLayer((vis) => {
      const enable = vis === "visible";
      this.is3DMode = enable;
      this.setBuildings3DVisibility(vis);
      this.setMapPitch(enable ? LeafletRenderer.PITCH_3D : 0);
      this.updateElevationScale();
    });
```

**Step 4: Add pitch and elevation scale methods**

After `setBuildings3DVisibility()` (line 1333), add:

```typescript
  private setMapPitch(pitch: number): void {
    if (!this.maplibreLayer) return;
    const glMap = this.maplibreLayer.getMaplibreMap?.();
    if (!glMap) return;
    glMap.setPitch(pitch);
  }

  private updateElevationScale(): void {
    if (!this.is3DMode) {
      this.elevationScale = 0;
      return;
    }
    // Compute pixels-per-meter at current zoom using two points 1 meter apart
    const p1 = this.map.latLngToContainerPoint(L.latLng(0, 0));
    const p2 = this.map.latLngToContainerPoint(
      L.latLng(1 / METERS_PER_DEGREE, 0),
    );
    const pixelsPerMeter = Math.abs(p2.y - p1.y);
    const pitchRad = (LeafletRenderer.PITCH_3D * Math.PI) / 180;
    this.elevationScale = pixelsPerMeter * Math.sin(pitchRad);
  }
```

**Step 5: Update setLayerVisible to use "3d" key**

Change the `"buildings3D"` block (lines 1120-1132) to use `"3d"`:

```typescript
    if (layer === "3d") {
      if (!this.threeDLayer) return;
      if (visible) {
        if (!this.map.hasLayer(this.threeDLayer)) {
          this.threeDLayer.addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(this.threeDLayer)) {
          this.map.removeLayer(this.threeDLayer);
        }
      }
      return;
    }
```

**Step 6: Recompute elevation scale on zoom change**

In `initMapLibreMode()`, after the `this.map` is created (around line 264), add a zoom listener:

```typescript
    this.map.on("zoomend", () => {
      this.updateElevationScale();
    });
```

**Step 7: Restore pitch after style switch**

In the `styledata` event handler (lines 364-374), add pitch restoration:

```typescript
        glMap.on("styledata", () => {
            if (this.mapIconsLayer && !this.map.hasLayer(this.mapIconsLayer)) {
              this.setMapLibreIconVisibility("none");
            }
            if (this.threeDLayer && !this.map.hasLayer(this.threeDLayer)) {
              this.setBuildings3DVisibility("none");
            }
            // Restore pitch after style switch
            if (this.is3DMode) {
              this.setMapPitch(LeafletRenderer.PITCH_3D);
            }
          });
```

**Step 8: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

---

### Task 4: Apply elevation offset to entity markers

**Files:**
- Modify: `ui/src/renderers/leaflet/leaflet-renderer.ts:708-791` (createEntityMarker, updateEntityMarker)

**Step 1: Monkey-patch `_setPos` in createEntityMarker**

After the marker is created (line 716), patch its `_setPos` to account for elevation:

```typescript
    // Patch _setPos to offset marker vertically by elevation in 3D mode
    const origSetPos = (marker as any)._setPos.bind(marker);
    (marker as any)._setPos = function (pos: L.Point) {
      const ep: number = (this as any)._elevationPx || 0;
      origSetPos(ep ? L.point(pos.x, pos.y - ep) : pos);
    };
```

**Step 2: Apply elevation offset in updateEntityMarker**

After `marker.setLatLng(latlng)` (line 747), add the elevation calculation:

```typescript
    // Apply elevation offset for 3D mode
    if (this.elevationScale > 0 && state.position.length > 2) {
      (marker as any)._elevationPx = state.position[2] * this.elevationScale;
    } else {
      (marker as any)._elevationPx = 0;
    }
```

Note: The offset takes effect on the next `_setPos` call. Since `setLatLng` triggers `_setPos`, we need to set `_elevationPx` BEFORE `setLatLng`. Reorder to:

```typescript
    // Compute elevation offset for 3D mode (must be set before setLatLng triggers _setPos)
    if (this.elevationScale > 0 && state.position.length > 2) {
      (marker as any)._elevationPx = state.position[2] * this.elevationScale;
    } else {
      (marker as any)._elevationPx = 0;
    }

    // Update position
    const latlng = this.armaToLatLng(state.position);
    marker.setLatLng(latlng);
```

**Step 3: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

---

### Task 5: Write tests for elevation offset logic

**Files:**
- Modify: `ui/src/renderers/leaflet/__tests__/leaflet-renderer.test.ts`

**Step 1: Add test for armaToLatLngMapLibre preserving altitude**

```typescript
describe("armaToLatLngMapLibre with altitude", () => {
  it("preserves Z coordinate as alt on LatLng", () => {
    const ll = armaToLatLngMapLibre([5000, 10000, 150]);
    expect(ll.lat).toBeCloseTo(10000 / METERS_PER_DEGREE, 8);
    expect(ll.lng).toBeCloseTo(5000 / METERS_PER_DEGREE, 8);
    expect(ll.alt).toBe(150);
  });

  it("works without Z coordinate (backward compatible)", () => {
    const ll = armaToLatLngMapLibre([5000, 10000]);
    expect(ll.lat).toBeCloseTo(10000 / METERS_PER_DEGREE, 8);
    expect(ll.lng).toBeCloseTo(5000 / METERS_PER_DEGREE, 8);
    expect(ll.alt).toBeUndefined();
  });
});
```

**Step 2: Update armaToLatLngMapLibre to pass altitude**

In `leaflet-renderer.ts`, modify `armaToLatLngMapLibre` (line 127-129):

```typescript
export function armaToLatLngMapLibre(coords: ArmaCoord): L.LatLng {
  return L.latLng(
    coords[1] / METERS_PER_DEGREE,
    coords[0] / METERS_PER_DEGREE,
    coords.length > 2 ? coords[2] : undefined,
  );
}
```

**Step 3: Run tests**

Run: `cd ui && npx vitest run src/renderers/leaflet/__tests__/leaflet-renderer.test.ts`
Expected: All tests pass, including the new altitude tests.

**Step 4: Commit**

```bash
git add ui/src/renderers/renderer.types.ts ui/src/i18n/locales.ts \
  ui/src/pages/recording-playback/components/TopBar.tsx \
  ui/src/renderers/leaflet/leaflet-renderer.ts \
  ui/src/renderers/leaflet/__tests__/leaflet-renderer.test.ts
git commit -m "feat: add 3D mode with entity elevation rendering

Rename '3D Buildings' toggle to '3D'. When enabled, pitches the MapLibre
map to 45° and applies CSS elevation offsets to entity markers based on
their Z coordinate. The offset scales with zoom level for proportional
visual effect at all zoom levels."
```
