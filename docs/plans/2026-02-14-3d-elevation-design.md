# 3D Elevation Rendering Design

## Goal

Render entities (units/vehicles) at their actual Z elevation on the map when 3D mode is enabled. The Z coordinate already flows through the entire pipeline (PR #211) but is currently dropped at the renderer level.

## Attempted Approach: CSS Transform Elevation (REJECTED)

Renamed the "3D Buildings" toggle to a general "3D" toggle. When enabled:

1. Pitch the MapLibre GL map to 45° — buildings become visually 3D via fill-extrusion
2. Apply CSS `translateY` offset to Leaflet entity markers proportional to Z elevation
3. Apply CSS `rotateX(35deg)` tilt to markers for isometric appearance

### Why This Doesn't Work

The `maplibre-gl-leaflet` adapter explicitly does not support pitch/bearing. The fundamental problem:

- **MapLibre GL** renders a pitched 3D scene on its canvas (buildings, terrain, tiles)
- **Leaflet** positions markers using 2D `latLng → containerPoint` projection (no pitch awareness)
- When the GL map is pitched, markers **misalign with the ground** — they're placed based on top-down coordinates while the ground is rendered in perspective

Specific issues observed:
- Markers at the center of the viewport are approximately correct
- Markers toward the top/bottom edges are visibly offset from their ground positions
- The offset increases with pitch angle and distance from viewport center
- CSS `rotateX` tilt on markers doesn't match MapLibre's perspective projection
- The `_setPos` monkey-patch for elevation offset (`translateY`) is in screen space, not in the GL scene's 3D space

**Conclusion:** The Leaflet overlay architecture is fundamentally incompatible with pitched/3D rendering. CSS hacks cannot bridge the gap between Leaflet's 2D coordinate system and MapLibre's 3D perspective.

## Alternative Approaches (Future)

### MapLibre GeoJSON Source Layers

Instead of Leaflet markers, render entities as MapLibre `circle` + `symbol` layers backed by a GeoJSON source updated each frame. Entities would natively participate in MapLibre's 3D scene.

**Pros:**
- Native 3D positioning — no CSS hacks
- Smooth integration with existing 3D buildings
- MapLibre handles perspective, occlusion, and z-ordering
- `symbol-z-offset` (v4+) provides pixel-accurate elevation rendering

**Cons:**
- Requires porting all entity marker styling (icons, rotation, opacity, popups) to MapLibre expressions
- GeoJSON source updates every frame — performance needs testing with 100+ entities
- Popups and interactions must be reimplemented on MapLibre's event system
- Larger refactor scope

### deck.gl Overlay

Use deck.gl's `IconLayer` or `ScatterplotLayer` with 3D positions for entity rendering. This aligns with Phase 3 of the map rendering migration plan.

**Pros:**
- True 3D rendering with WebGL
- Best visual quality — proper depth, perspective, shadows possible
- GPU-accelerated — handles thousands of entities
- Future-proof: deck.gl is the target for full 3D migration
- Can render 3D terrain mesh underneath

**Cons:**
- Large dependency (~500KB)
- Significant refactor — entirely new rendering pipeline
- Requires the PMTiles infrastructure (Phase 1) to be complete
- Overkill if only elevation offsets are needed

### Recommendation for Future

If CSS elevation proves insufficient, skip straight to deck.gl (Phase 3) rather than the intermediate MapLibre GeoJSON approach. The MapLibre approach trades one set of limitations for another, while deck.gl provides a clean 3D rendering path.
