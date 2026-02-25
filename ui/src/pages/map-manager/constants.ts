export const PIPELINE_STAGES = [
  "parse_gradmeh",
  "prepare",
  "render",
  "process_geojson",
  "generate_vector_tiles",
  "generate_styles",
  "generate_metadata",
];

export const OUTPUT_FILES = [
  { name: "satellite.pmtiles", label: "Satellite" },
  { name: "heightmap.pmtiles", label: "Heightmap" },
  { name: "hillshade.pmtiles", label: "Hillshade" },
  { name: "bathymetry.pmtiles", label: "Bathymetry" },
  { name: "color-relief.pmtiles", label: "Color Relief" },
  { name: "features.pmtiles", label: "Vector Features" },
];

export const STYLE_VARIANTS = [
  { file: "topo.json", label: "Topo", desc: "Satellite + hillshade + vector" },
  { file: "topo-dark.json", label: "Topo Dark", desc: "Dark satellite variant" },
  { file: "topo-relief.json", label: "Relief", desc: "Elevation-focused view" },
  { file: "color-relief.json", label: "Color", desc: "Pure elevation coloring" },
];

export const STATUS_COLORS: Record<string, string> = {
  pending: "var(--text-muted)",
  running: "var(--accent-primary)",
  done: "var(--accent-success)",
  failed: "var(--accent-danger)",
  cancelled: "var(--text-dim)",
};

export const MAP_STATUS_COLORS: Record<string, string> = {
  none: "var(--accent-danger)",
  incomplete: "var(--accent-warning)",
  complete: "var(--accent-success)",
};
