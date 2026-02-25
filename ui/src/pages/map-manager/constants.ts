export interface PipelineStage {
  id: string;
  label: string;
  short: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "parse_gradmeh", label: "Parse grad_meh", short: "Parse" },
  { id: "prepare", label: "Prepare sources", short: "Prepare" },
  { id: "render", label: "Render tile layers", short: "Render" },
  { id: "process_geojson", label: "Process GeoJSON", short: "GeoJSON" },
  { id: "generate_vector_tiles", label: "Generate vector tiles", short: "Vectors" },
  { id: "generate_styles", label: "Generate styles", short: "Styles" },
  { id: "generate_metadata", label: "Generate metadata", short: "Metadata" },
];

export const OUTPUT_FILES = [
  { name: "satellite.pmtiles", label: "Satellite" },
  { name: "heightmap.pmtiles", label: "Heightmap" },
  { name: "hillshade.pmtiles", label: "Hillshade" },
  { name: "color-relief.pmtiles", label: "Color Relief" },
  { name: "features.pmtiles", label: "Vector Features" },
  { name: "color-relief.json", label: "Style" },
  { name: "map.json", label: "Metadata" },
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
