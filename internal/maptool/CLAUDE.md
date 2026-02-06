# internal/maptool

Processes Arma 3 map data (grad_meh exports) into PMTiles + MapLibre styles for the OCAP2 web viewer.

## Package Layout

| File | Purpose |
|---|---|
| `pipeline.go` | `Pipeline` and `Job` structs, stage runner. `Job.SubDirs` controls output layout (tiles/, styles/ subdirs). |
| `jobmanager.go` | Queue-based job manager. `processJob` sets `SubDirs=true` for web uploads. Cleans up `filepath.Dir(job.InputPath)` on success. |
| `gradmeh.go` | `ValidateGradMehDir()`, `ReadGradMehMeta()`, `WorldNameFromDir()`. Validates meta.json + sat/ exist. |
| `satellite_gradmeh.go` | Reads grad_meh satellite PNGs, builds VRT, runs GDAL pipeline to satellite.pmtiles. |
| `vector_gradmeh.go` | Discovers GeoJSON layers from grad_meh export, processes into features.pmtiles via tippecanoe. |
| `styles.go` | All MapLibre style definitions. Generates standard/satellite/hybrid style documents. |
| `metadata.go` | Generates map.json and style JSON files as final pipeline stage. |
| `dem.go`, `dem_pipeline.go` | DEM/elevation grid handling. |
| `contour.go`, `contours_gdal.go` | Contour line generation (4-interval: 0.5m, 10m, 50m, 100m). |
| `hillshade.go`, `heightmap.go`, `colorrelief.go` | Terrain visualization layers. |
| `raster_tiles.go`, `tiles.go` | GDAL-based tile generation to PMTiles. |
| `scanner.go` | `ScanMaps()` for discovering installed maps in the maps directory. |
| `tools.go` | External tool detection (gdal, tippecanoe, etc.). |

## styles.go — Key Design Decisions

### Layer Render Order
`categoryRenderOrder` in `buildVectorFeatureLayers()` sorts layers to match Arma 3's engine paint order, bottom to top:

sea → contours → forest → rocks → buildings → trail → track → road → main_road → runway → railway → powerline → bridges → vegetation → icons → labels

This is critical because `VectorLayers` arrives in arbitrary directory-listing order from grad_meh. Without sorting, labels can end up below roads.

### Layer Categories
`categorizeLayer()` maps layer names to categories. Roads return their own name (`trail`, `track`, etc.) for sub-ordering. `isLayerVisible()` still groups them under `vis.roads`.

### Style Variants
Three variants share the same vector layers but differ in raster base:
- **standard**: color-relief + hillshade + hidden satellite toggle
- **satellite**: hillshade + satellite, no forest/sea-land fills
- **hybrid**: native hillshade from DEM + 60% satellite + all vector features

### Label Readability
All label types need text halos. The halo styles:
- `namecity`, `namevillage`, `namecitycapital`: white text + black halo
- `hill`, `namemarine`, `namelocal`, `citycenter`: colored text + semi-transparent white halo `rgba(255,255,255,0.7)`

### Runway Geometry
grad_meh exports runways as **polygons**, not lines. Style type must be `fill`, not `line`.

### Known Layer Types
`knownLayerStyles` map covers: fills (sea, forest, rocks, house), roads (trail/track/road/main_road with outline+fill pairs), bridges (fill-extrusion), infrastructure (railway, runway, powerline), contours (legacy single-layer + 4-interval GDAL), object icons (20+ types), location labels (7 types), vegetation (4 types).

## Web Server (cmd/ocap-maptool)

- `handler.go`: Echo routes. Upload endpoint `POST /api/maps/import` accepts multipart ZIP, extracts with zip-slip protection, finds grad_meh dir (root or one level deep), submits to JobManager.
- `static/`: Embedded SPA (index.html + app.js + style.css). No build step.
- ZIP extraction cleanup: JobManager's `processJob` calls `os.RemoveAll(filepath.Dir(job.InputPath))` which removes the per-upload extraction directory.
