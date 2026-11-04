// MapLibre 6 loads its worker from `./maplibre-gl-worker.mjs` relative to its
// own module URL. Vite bundles maplibre-gl into a hashed chunk and does not
// emit that file, so the request falls through to the SPA's index.html and
// every worker fails ("Worker failed to load"). Raster layers still draw, but
// vector tiles (roads, buildings, labels) are never parsed.
//
// Importing the worker with `?url` makes Vite emit it as an asset and gives us
// its final URL, which we hand to MapLibre before any map is created.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

type MaplibreModule = typeof import("maplibre-gl");

/** Load maplibre-gl with its worker URL set. Use this instead of `import("maplibre-gl")`. */
export async function loadMaplibre(): Promise<MaplibreModule> {
  const maplibregl = await import("maplibre-gl");
  if (maplibregl.getWorkerUrl() !== workerUrl) {
    maplibregl.setWorkerUrl(workerUrl);
  }
  return maplibregl;
}
