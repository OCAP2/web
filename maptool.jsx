import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

// ─── Implementation Notes ────────────────────────────────────────────────────
// Navigation: This page is rendered at /maptool route. The nav link in the
// recording selector only renders when GET /api/v1/maptool/tools returns 200
// (maptool is enabled). If maptool is disabled, the route and link are both
// hidden — users cannot reach this page.
//
// API mapping:
//   GET  /api/v1/maptool/tools        → ToolStatus
//   GET  /api/v1/maptool/maps         → Map library
//   POST /api/v1/maptool/maps/import  → ImportDialog upload (XHR w/ onprogress)
//   POST /api/v1/maptool/maps/restyle → Restyle All button
//   DELETE /api/v1/maptool/maps/:name → Delete confirmation
//   GET  /api/v1/maptool/jobs         → JobHistory + PipelineProgress
//   GET  /api/v1/maptool/jobs/:id/sse → Real-time stage updates
//   POST /api/v1/maptool/jobs/:id/cancel → Cancel button on running jobs
//   Static: /maps/{name}/preview_*.png → Card + detail hero images

// ─── Mock Data ───────────────────────────────────────────────────────────────
const TOOLS = [
  { name: "pmtiles", required: true, found: true, path: "/usr/local/bin/pmtiles" },
  { name: "tippecanoe", required: true, found: true, path: "/usr/local/bin/tippecanoe" },
  { name: "gdal_translate", required: false, found: true, path: "/usr/bin/gdal_translate" },
  { name: "gdaldem", required: false, found: true, path: "/usr/bin/gdaldem" },
  { name: "gdal_contour", required: false, found: true, path: "/usr/bin/gdal_contour" },
  { name: "gdal_calc.py", required: false, found: true, path: "/usr/bin/gdal_calc.py" },
  { name: "gdaladdo", required: false, found: true, path: "/usr/bin/gdaladdo" },
  { name: "gdalbuildvrt", required: false, found: true, path: "/usr/bin/gdalbuildvrt" },
  { name: "gdal_fillnodata.py", required: false, found: false, path: "" },
  { name: "tile-join", required: false, found: true, path: "/usr/local/bin/tile-join" },
];

const MAPS = [
  { name: "altis", displayName: "Altis", worldSize: 30720, status: "complete", hasPreview: true, author: "Bohemia Interactive", elevation: { min: -37.45, max: 813.21, avg: 142.56, stddev: 145.89 }, featureLayers: ["sea", "forest", "house", "road", "main_road", "contours10", "contours50", "rocks", "trail", "track"], files: { "satellite.pmtiles": 1420, "features.pmtiles": 7.2, "heightmap.pmtiles": 48, "hillshade.pmtiles": 120, "color-relief.pmtiles": 85, "bathymetry.pmtiles": 32 } },
  { name: "cup_chernarus_a3", displayName: "Chernarus", worldSize: 15360, status: "complete", hasPreview: true, author: "CUP Team", elevation: { min: -12.3, max: 723.8, avg: 198.4, stddev: 132.1 }, featureLayers: ["sea", "forest", "house", "road", "main_road", "contours10", "railway"], files: { "satellite.pmtiles": 680, "features.pmtiles": 4.1, "heightmap.pmtiles": 22, "hillshade.pmtiles": 58, "color-relief.pmtiles": 41 } },
  { name: "d41_ruegen", displayName: "Rügen", worldSize: 16384, status: "incomplete", hasPreview: false, author: "D41", elevation: null, featureLayers: ["sea", "forest", "house", "road"], files: { "satellite.pmtiles": 420 } },
  { name: "esseker", displayName: "Esseker", worldSize: 12288, status: "complete", hasPreview: true, author: "Tobur", elevation: { min: 80.2, max: 412.6, avg: 178.9, stddev: 65.3 }, featureLayers: ["forest", "house", "road", "main_road", "contours10", "contours50"], files: { "satellite.pmtiles": 380, "features.pmtiles": 3.5, "heightmap.pmtiles": 18, "hillshade.pmtiles": 42, "color-relief.pmtiles": 30 } },
  { name: "gulfcoast", displayName: "Gulf Coast", worldSize: 15360, status: "complete", hasPreview: true, author: "ColinM9991", elevation: { min: -8.1, max: 45.2, avg: 12.3, stddev: 8.7 }, featureLayers: ["sea", "forest", "house", "road", "main_road", "bridge"], files: { "satellite.pmtiles": 520, "features.pmtiles": 2.8, "heightmap.pmtiles": 14, "hillshade.pmtiles": 35, "color-relief.pmtiles": 24 } },
  { name: "k9s_djalka", displayName: "Djalka", worldSize: 32768, status: "complete", hasPreview: false, author: "K9S", elevation: { min: 0, max: 2140.5, avg: 890.3, stddev: 420.2 }, featureLayers: ["sea", "forest", "house", "road", "rocks", "contours10", "contours50", "contours100"], files: { "satellite.pmtiles": 1850, "features.pmtiles": 12.4, "heightmap.pmtiles": 64, "hillshade.pmtiles": 160, "color-relief.pmtiles": 110, "bathymetry.pmtiles": 45 } },
  { name: "tanoa", displayName: "Tanoa", worldSize: 15360, status: "complete", hasPreview: true, author: "Bohemia Interactive", elevation: { min: -45.0, max: 682.4, avg: 89.7, stddev: 98.4 }, featureLayers: ["sea", "forest", "house", "road", "main_road", "bridge", "trail"], files: { "satellite.pmtiles": 640, "features.pmtiles": 5.1, "heightmap.pmtiles": 24, "hillshade.pmtiles": 52, "color-relief.pmtiles": 38, "bathymetry.pmtiles": 18 } },
  { name: "livonia", displayName: "Livonia", worldSize: 12800, status: "complete", hasPreview: true, author: "Bohemia Interactive", elevation: { min: 120.0, max: 410.5, avg: 205.8, stddev: 55.2 }, featureLayers: ["forest", "house", "road", "main_road", "railway", "contours10"], files: { "satellite.pmtiles": 440, "features.pmtiles": 3.9, "heightmap.pmtiles": 16, "hillshade.pmtiles": 38, "color-relief.pmtiles": 28 } },
];

const PIPELINE_STAGES = [
  { id: "parse_gradmeh", label: "Parse grad_meh", short: "Parse", group: 1, optional: false, deps: [] },
  { id: "generate_preview", label: "Generate preview", short: "Preview", group: 2, optional: true, deps: [] },
  { id: "prepare_dem", label: "Prepare DEM", short: "DEM", group: 2, optional: true, deps: ["gdal_translate", "gdal_fillnodata.py"] },
  { id: "process_satellite", label: "Process satellite", short: "Satellite", group: 2, optional: false, deps: [] },
  { id: "generate_satellite_tiles", label: "Generate satellite tiles", short: "Sat tiles", group: 3, optional: false, deps: ["gdal_translate", "pmtiles"] },
  { id: "generate_heightmap", label: "Generate heightmap", short: "Heightmap", group: 3, optional: true, deps: ["gdal_translate", "pmtiles", "gdaladdo"] },
  { id: "generate_hillshade", label: "Generate hillshade", short: "Hillshade", group: 3, optional: true, deps: ["gdaldem", "gdal_translate", "pmtiles", "gdal_calc.py", "gdalbuildvrt"] },
  { id: "generate_bathymetry", label: "Generate bathymetry", short: "Bathymetry", group: 3, optional: true, deps: ["gdaldem", "gdal_translate", "pmtiles"] },
  { id: "generate_colorrelief", label: "Generate color relief", short: "Color relief", group: 3, optional: true, deps: ["gdaldem", "gdal_translate", "pmtiles"] },
  { id: "generate_contours", label: "Generate contours", short: "Contours", group: 3, optional: true, deps: ["gdal_contour"] },
  { id: "process_geojson", label: "Process GeoJSON", short: "GeoJSON", group: 4, optional: false, deps: [] },
  { id: "generate_vector_tiles", label: "Generate vector tiles", short: "Vectors", group: 5, optional: true, deps: ["tippecanoe", "tile-join", "pmtiles"] },
  { id: "generate_styles", label: "Generate styles", short: "Styles", group: 6, optional: false, deps: [] },
  { id: "generate_metadata", label: "Generate metadata", short: "Metadata", group: 7, optional: false, deps: [] },
];

const MOCK_JOBS = [
  { id: "stratis-1708961234567", worldName: "stratis", status: "running", stage: "generate_hillshade", stageNum: 7, totalStages: 14, startedAt: new Date(Date.now() - 127000).toISOString(), message: "" },
  { id: "sahrani-1708961300000", worldName: "sahrani", status: "pending", stage: "", stageNum: 0, totalStages: 14, startedAt: null, message: "" },
  { id: "altis-1708951100000", worldName: "altis", status: "done", stage: "generate_metadata", stageNum: 14, totalStages: 14, startedAt: new Date(Date.now() - 3600000).toISOString(), finishedAt: new Date(Date.now() - 2400000).toISOString(), message: "" },
  { id: "tanoa-1708941000000", worldName: "tanoa", status: "done", stage: "generate_metadata", stageNum: 14, totalStages: 14, startedAt: new Date(Date.now() - 7200000).toISOString(), finishedAt: new Date(Date.now() - 5400000).toISOString(), message: "" },
  { id: "malden-1708931000000", worldName: "malden", status: "failed", stage: "process_satellite", stageNum: 4, totalStages: 14, startedAt: new Date(Date.now() - 10800000).toISOString(), error: "satellite tiles not found: sat/ directory contains 0 tiles (expected grid of 512x512 PNGs)" },
];

const STATUS_COLORS = {
  complete: "#2DD4A0", incomplete: "#FFB84A", none: "#556677",
  running: "#4A9EFF", done: "#2DD4A0", failed: "#FF6B6B", pending: "#8899aa", cancelled: "#667788",
};

const OUTPUT_FILES = [
  { name: "satellite.pmtiles", label: "Satellite", required: true, deps: [] },
  { name: "features.pmtiles", label: "Vector features", required: false, deps: ["tippecanoe"] },
  { name: "heightmap.pmtiles", label: "Heightmap (Terrain-RGB)", required: false, deps: ["gdal_translate", "gdaladdo"] },
  { name: "hillshade.pmtiles", label: "Hillshade", required: false, deps: ["gdaldem", "gdal_calc.py", "gdalbuildvrt"] },
  { name: "color-relief.pmtiles", label: "Color relief", required: false, deps: ["gdaldem"] },
  { name: "bathymetry.pmtiles", label: "Bathymetry", required: false, deps: ["gdaldem"] },
];

const STYLE_VARIANTS = [
  { id: "topo", label: "Topo", desc: "Satellite + hillshade + vector" },
  { id: "topo-dark", label: "Topo Dark", desc: "Dark satellite variant" },
  { id: "topo-relief", label: "Relief", desc: "Elevation-focused view" },
  { id: "color-relief", label: "Color", desc: "Pure elevation coloring" },
];

// ─── Icons ───────────────────────────────────────────────────────────────────
const I = {
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Globe: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Layers: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  AlertTriangle: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  ChevronDown: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>,
  Terminal: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  Grid: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  List: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  FilePlus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  Paintbrush: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M18.37 2.63L14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/></svg>,
  Clock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  HardDrive: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>,
  XCircle: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  CheckCircle: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  Square: () => <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>,
  Hourglass: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>,
  Upload: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const mono = (size) => ({ fontSize: size, fontFamily: "'JetBrains Mono', monospace" });
const outfit = (size) => ({ fontSize: size, fontFamily: "'Outfit', sans-serif" });
const formatWorldSize = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
const formatFileSize = (mb) => mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
const elapsed = (start, end) => {
  const s = Math.floor(((end ? new Date(end) : Date.now()) - new Date(start).getTime()) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};
const totalDiskMB = (files) => files ? Object.values(files).reduce((a, b) => a + b, 0) : 0;
const mapHue = (name) => { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; };

// ─── Status Strip ────────────────────────────────────────────────────────────
// Unified bar: tools health | active job progress | queue + history
function StatusStrip({ tools, jobs, onCancel }) {
  const [openPanel, setOpenPanel] = useState(null); // "tools" | "jobs" | null
  const [tick, setTick] = useState(0);
  const stripRef = useRef(null);

  const found = tools.filter(t => t.found).length;
  const allReqOk = tools.filter(t => t.required).every(t => t.found);
  const missingOpt = tools.filter(t => !t.required && !t.found);
  const degraded = PIPELINE_STAGES.filter(s => s.optional && s.deps.some(d => !tools.find(t => t.name === d)?.found));

  const activeJob = jobs.find(j => j.status === "running");
  const pending = jobs.filter(j => j.status === "pending");
  const past = jobs.filter(j => j.status !== "running" && j.status !== "pending");
  const currentIdx = activeJob ? PIPELINE_STAGES.findIndex(s => s.id === activeJob.stage) : -1;

  useEffect(() => {
    if (!activeJob) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [activeJob?.id]);

  // Close panel on outside click
  useEffect(() => {
    if (!openPanel) return;
    const handler = (e) => { if (stripRef.current && !stripRef.current.contains(e.target)) setOpenPanel(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openPanel]);

  const toggle = (panel) => setOpenPanel(p => p === panel ? null : panel);

  return (
    <div ref={stripRef} style={{ position: "relative", marginBottom: 12 }}>
      {/* Strip bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        height: 36, borderRadius: 8,
        background: "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}>
        {/* ── Tools section ── */}
        <button onClick={() => toggle("tools")} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 12px", height: "100%",
          background: openPanel === "tools" ? "rgba(255,255,255,0.02)" : "transparent",
          border: "none", borderRight: "1px solid rgba(255,255,255,0.04)",
          cursor: "pointer", transition: "background 0.15s",
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: allReqOk ? "#2DD4A0" : "#FF6B6B",
            boxShadow: allReqOk ? "0 0 6px rgba(45,212,160,0.3)" : "0 0 6px rgba(255,74,74,0.3)",
          }} />
          <span style={{ ...mono(9), color: allReqOk ? "#8899aa" : "#FF6B6B", fontWeight: 600 }}>{found}/{tools.length} tools</span>
          {missingOpt.length > 0 && (
            <span style={{ ...mono(8), color: "#FFB84A", fontWeight: 500 }}>({missingOpt.length} degraded)</span>
          )}
        </button>

        {/* ── Active job section ── */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minWidth: 0 }}>
          {activeJob ? (
            <>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4A9EFF", animation: "pulse 1.5s ease-in-out infinite", flexShrink: 0 }} />
              <span style={{ ...mono(10), color: "#c8d4e0", fontWeight: 600, whiteSpace: "nowrap" }}>{activeJob.worldName}</span>

              {/* Inline stage bar */}
              <div style={{ flex: 1, display: "flex", gap: 1, alignItems: "center", minWidth: 60 }}>
                {PIPELINE_STAGES.map((s, i) => {
                  const done = i < currentIdx;
                  const active = i === currentIdx;
                  return (
                    <div key={s.id} title={s.label} style={{
                      flex: 1, height: 3, borderRadius: 1, position: "relative", overflow: "hidden",
                      background: done ? "#2DD4A0" : active ? "rgba(74,158,255,0.25)" : "rgba(255,255,255,0.04)",
                      transition: "background 0.3s",
                    }}>
                      {active && (
                        <div style={{
                          position: "absolute", top: 0, height: "100%", width: "40%",
                          background: "linear-gradient(90deg, transparent, #4A9EFF, transparent)",
                          borderRadius: 1,
                          animation: "shimmer 1.5s ease-in-out infinite",
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>

              <span style={{ ...mono(9), color: "#4A9EFF", fontWeight: 600, whiteSpace: "nowrap" }}>
                {PIPELINE_STAGES[currentIdx]?.short || activeJob.stage}
              </span>
              <span style={{ ...mono(9), color: "#445566", whiteSpace: "nowrap" }}>{elapsed(activeJob.startedAt)}</span>

              <button onClick={(e) => { e.stopPropagation(); onCancel?.(activeJob.id); }} title="Cancel import" style={{
                width: 22, height: 22, borderRadius: 4, border: "1px solid rgba(255,74,74,0.12)",
                background: "rgba(255,74,74,0.04)", cursor: "pointer", color: "#FF6B6B77",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}><I.Square /></button>
            </>
          ) : (
            <span style={{ ...mono(9), color: "#334455" }}>No active imports</span>
          )}
        </div>

        {/* ── Jobs section ── */}
        <button onClick={() => toggle("jobs")} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 12px", height: "100%",
          background: openPanel === "jobs" ? "rgba(255,255,255,0.02)" : "transparent",
          border: "none", borderLeft: "1px solid rgba(255,255,255,0.04)",
          cursor: "pointer", transition: "background 0.15s",
        }}>
          {pending.length > 0 && (
            <span style={{
              ...mono(8), fontWeight: 700, padding: "1px 5px", borderRadius: 3,
              background: "rgba(74,158,255,0.1)", color: "#4A9EFF",
            }}>{pending.length}</span>
          )}
          <span style={{ ...mono(9), color: "#556677", fontWeight: 500 }}>
            {past.length} past
          </span>
          <span style={{ display: "flex", color: "#445566", transform: openPanel === "jobs" ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}><I.ChevronDown /></span>
        </button>
      </div>

      {/* ── Tools dropdown ── */}
      {openPanel === "tools" && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          width: 420, maxHeight: 360, overflowY: "auto",
          background: "#111920", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          padding: 12, zIndex: 50, animation: "fadeIn 0.12s ease-out",
        }}>
          <div style={{ ...mono(9), color: "#556677", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 8 }}>CLI TOOLS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {tools.map(t => (
              <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                <span style={{ color: t.found ? "#2DD4A0" : t.required ? "#FF6B6B" : "#FFB84A", display: "flex", width: 14 }}>
                  {t.found ? <I.Check /> : <I.X />}
                </span>
                <span style={{ ...mono(10), color: t.found ? "#99aabb" : t.required ? "#FF6B6B" : "#FFB84A", fontWeight: 500, minWidth: 130 }}>{t.name}</span>
                {t.found && <span style={{ ...mono(8), color: "#2a3a4a" }}>{t.path}</span>}
                {!t.found && <span style={{ ...mono(8), color: t.required ? "#FF6B6B88" : "#FFB84A66" }}>{t.required ? "required" : "optional"}</span>}
              </div>
            ))}
          </div>
          {degraded.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(255,184,74,0.04)", border: "1px solid rgba(255,184,74,0.06)" }}>
              <div style={{ ...mono(8), color: "#FFB84A", fontWeight: 600, marginBottom: 4 }}>DEGRADED OUTPUTS</div>
              {degraded.map(s => (
                <div key={s.id} style={{ ...mono(8), color: "#667788", padding: "1px 0" }}>
                  • {s.label} — needs {s.deps.filter(d => !tools.find(t => t.name === d)?.found).join(", ")}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Jobs dropdown ── */}
      {openPanel === "jobs" && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0,
          width: 380, maxHeight: 360, overflowY: "auto",
          background: "#111920", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          padding: 12, zIndex: 50, animation: "fadeIn 0.12s ease-out",
        }}>
          {/* Queued */}
          {pending.length > 0 && (
            <>
              <div style={{ ...mono(9), color: "#556677", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 6 }}>QUEUED</div>
              {pending.map(j => (
                <div key={j.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 5,
                  background: "rgba(136,153,170,0.03)", border: "1px solid rgba(136,153,170,0.05)",
                  marginBottom: 3,
                }}>
                  <span style={{ display: "flex", color: "#8899aa" }}><I.Hourglass /></span>
                  <span style={{ ...mono(10), color: "#99aabb", fontWeight: 500, flex: 1 }}>{j.worldName}</span>
                  <span style={{ ...mono(8), fontWeight: 600, color: "#667788" }}>PENDING</span>
                </div>
              ))}
            </>
          )}
          {/* Past */}
          {past.length > 0 && (
            <>
              <div style={{ ...mono(9), color: "#556677", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 6, marginTop: pending.length > 0 ? 10 : 0 }}>HISTORY</div>
              {past.map(j => (
                <div key={j.id} style={{ marginBottom: 3 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 5,
                    background: "rgba(255,255,255,0.01)", border: `1px solid ${j.status === "failed" ? "rgba(255,74,74,0.06)" : "rgba(255,255,255,0.025)"}`,
                  }}>
                    <span style={{ display: "flex", color: STATUS_COLORS[j.status] }}>
                      {j.status === "done" ? <I.CheckCircle /> : <I.XCircle />}
                    </span>
                    <span style={{ ...mono(10), color: "#c8d4e0", fontWeight: 500, flex: 1 }}>{j.worldName}</span>
                    {j.finishedAt && <span style={{ ...mono(8), color: "#3a4a5a" }}>{elapsed(j.startedAt, j.finishedAt)}</span>}
                    <span style={{ ...mono(8), fontWeight: 600, color: STATUS_COLORS[j.status] }}>{j.status.toUpperCase()}</span>
                  </div>
                  {j.status === "failed" && j.error && (
                    <div style={{ padding: "3px 8px 3px 30px", ...mono(8), color: "#FF6B6B77", lineHeight: 1.4 }}>
                      Stage {j.stageNum}: {j.stage} — {j.error}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {pending.length === 0 && past.length === 0 && (
            <div style={{ ...mono(10), color: "#334455", textAlign: "center", padding: 16 }}>No job history</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Import Dialog ───────────────────────────────────────────────────────────
function ImportDialog({ onClose, onImport }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileRef = useRef(null);

  const handleFile = (f) => {
    if (f && (f.name.endsWith(".zip"))) setFile(f);
  };

  const handleImport = () => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    // Simulate XHR upload progress — real impl uses XMLHttpRequest.upload.onprogress
    const iv = setInterval(() => {
      setUploadProgress(p => {
        if (p >= 95) { clearInterval(iv); return p; }
        return p + Math.random() * 12;
      });
    }, 300);
    setTimeout(() => {
      clearInterval(iv);
      setUploadProgress(100);
      setTimeout(() => { onImport?.(file); }, 400);
    }, 3500);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.12s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, background: "#131c28", border: "1px solid rgba(74,158,255,0.12)", borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", animation: "fadeScale 0.2s ease-out" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#4A9EFF", display: "flex" }}><I.FilePlus /></span>
            <span style={{ ...outfit(15), fontWeight: 600, color: "#e0e6ed" }}>Import Map</span>
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "none", cursor: "pointer", color: "#556677", display: "flex", alignItems: "center", justifyContent: "center" }}><I.X /></button>
        </div>

        {/* Content */}
        <div style={{ padding: 20 }}>
          {/* Explanation */}
          <div style={{ ...mono(10), color: "#667788", lineHeight: 1.6, marginBottom: 16 }}>
            Import an Arma 3 map from a{" "}
            <a href="https://github.com/gruppe-adler/grad_meh" target="_blank" rel="noopener noreferrer" style={{ color: "#4A9EFF", textDecoration: "underline" }} onClick={e => e.stopPropagation()}>grad_meh</a>
            {" "}export. Package the output directory as a .zip file.
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{
              padding: file ? "14px 16px" : "28px 16px",
              borderRadius: 10,
              border: `2px dashed ${dragOver ? "#4A9EFF" : file ? "rgba(45,212,160,0.2)" : "rgba(255,255,255,0.06)"}`,
              background: dragOver ? "rgba(74,158,255,0.06)" : file ? "rgba(45,212,160,0.04)" : "rgba(255,255,255,0.015)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            <input ref={fileRef} type="file" accept=".zip" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />

            {file ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                <span style={{ color: "#2DD4A0", display: "flex" }}><I.Check /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ ...mono(11), color: "#c8d4e0", fontWeight: 500 }}>{file.name}</div>
                  <div style={{ ...mono(9), color: "#556677" }}>{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
                <button onClick={e => { e.stopPropagation(); setFile(null); }} style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(255,255,255,0.04)", border: "none", cursor: "pointer", color: "#556677", display: "flex", alignItems: "center", justifyContent: "center" }}><I.X /></button>
              </div>
            ) : (
              <>
                <span style={{ color: "#4A9EFF55", display: "flex" }}><I.FilePlus /></span>
                <div style={{ ...mono(11), color: "#667788", textAlign: "center" }}>
                  Drop <span style={{ color: "#99aabb" }}>.zip</span> here or <span style={{ color: "#4A9EFF", textDecoration: "underline" }}>browse</span>
                </div>
                <span style={{ ...mono(9), color: "#3a4a5a" }}>Max 2 GB</span>
              </>
            )}
          </div>

          {/* Expected structure hint */}
          <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ ...mono(8), color: "#445566", fontWeight: 600, letterSpacing: "0.06em", marginBottom: 4 }}>EXPECTED ZIP STRUCTURE</div>
            <div style={{ ...mono(9), color: "#3a4a5a", lineHeight: 1.6 }}>
              <span style={{ color: "#556677" }}>meta.json</span> — world metadata (required)<br/>
              <span style={{ color: "#556677" }}>sat/</span> — satellite tiles as X/Y.png (required)<br/>
              <span style={{ color: "#445566" }}>dem.asc.gz</span> — elevation data (optional)<br/>
              <span style={{ color: "#445566" }}>geojson/</span> — vector feature layers (optional)<br/>
              <span style={{ color: "#445566" }}>preview.png</span> — preview image (optional)
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {uploading ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ ...mono(10), color: "#4A9EFF", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  <I.Upload /> Uploading...
                </span>
                <span style={{ ...mono(10), color: "#556677" }}>{Math.min(100, Math.round(uploadProgress))}%</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  background: uploadProgress >= 100 ? "#2DD4A0" : "linear-gradient(90deg, #4A9EFF, #2DD4A0)",
                  width: `${Math.min(100, uploadProgress)}%`,
                  transition: "width 0.3s ease-out",
                }} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ ...mono(9), color: file ? "#2DD4A0" : "#3a4a5a" }}>
                {file ? "Ready to import" : "Select a .zip file"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#8899aa", ...mono(11), cursor: "pointer" }}>Cancel</button>
                <button
                  onClick={handleImport}
                  disabled={!file}
                  style={{
                    padding: "7px 14px", borderRadius: 6, border: "none",
                    background: file ? "linear-gradient(135deg, #4A9EFF, #2a7fff)" : "rgba(255,255,255,0.04)",
                    color: file ? "#fff" : "#445566",
                    ...mono(11), fontWeight: 600, cursor: file ? "pointer" : "default",
                    opacity: file ? 1 : 0.5,
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                ><I.FilePlus /> Import</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Map Card ────────────────────────────────────────────────────────────────
function MapCard({ map, selected, onClick }) {
  const hue = mapHue(map.name);
  const st = STATUS_COLORS[map.status];
  const disk = totalDiskMB(map.files);
  const [imgError, setImgError] = useState(false);
  const showImg = map.hasPreview && !imgError;

  return (
    <button onClick={onClick} style={{
      background: selected ? "rgba(74,158,255,0.06)" : "rgba(255,255,255,0.012)",
      border: `1px solid ${selected ? "rgba(74,158,255,0.2)" : "rgba(255,255,255,0.035)"}`,
      borderRadius: 10, overflow: "hidden", cursor: "pointer",
      display: "flex", flexDirection: "column", transition: "all 0.15s", textAlign: "left",
    }}>
      <div style={{
        height: 82, position: "relative", overflow: "hidden",
        background: `linear-gradient(135deg, hsl(${hue},22%,11%), hsl(${(hue + 40) % 360},18%,7%))`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {showImg ? (
          <img
            src={`/maps/${map.name}/preview_256.png`}
            alt={map.displayName || map.name}
            onError={() => setImgError(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <>
            <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.07 }}>
              <defs><pattern id={`g-${map.name}`} width="18" height="18" patternUnits="userSpaceOnUse"><path d="M 18 0 L 0 0 0 18" fill="none" stroke={`hsl(${hue},35%,45%)`} strokeWidth="0.4" /></pattern></defs>
              <rect width="100%" height="100%" fill={`url(#g-${map.name})`} />
            </svg>
            <svg width="100%" height="100%" viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, opacity: 0.1 }}>
              <ellipse cx={55 + (hue % 45)} cy={48 + (hue % 18)} rx={38 + (hue % 28)} ry={22 + (hue % 14)} fill={`hsl(${hue},28%,35%)`} />
              <ellipse cx={145 - (hue % 35)} cy={38 + (hue % 22)} rx={28 + (hue % 18)} ry={18 + (hue % 10)} fill={`hsl(${(hue + 60) % 360},22%,30%)`} />
            </svg>
            <span style={{ ...mono(9), color: "#334455", zIndex: 1 }}>No preview</span>
          </>
        )}
        <span style={{
          position: "absolute", top: 5, right: 5, ...mono(7), fontWeight: 700, letterSpacing: "0.05em",
          padding: "2px 5px", borderRadius: 3, background: `${st}14`, color: st, border: `1px solid ${st}22`,
        }}>
          {map.status === "complete" ? "COMPLETE" : map.status === "incomplete" ? "PARTIAL" : "NONE"}
        </span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ ...outfit(12), fontWeight: 600, color: "#e0e6ed", lineHeight: 1.2, marginBottom: 2 }}>{map.displayName || map.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <span style={{ ...mono(9), color: "#556677" }}>{formatWorldSize(map.worldSize)}</span>
          <span style={{ ...mono(9), color: "#2a3a4a" }}>·</span>
          <span style={{ ...mono(9), color: "#445566", display: "flex", alignItems: "center", gap: 2 }}><I.Layers /> {map.featureLayers?.length || 0}</span>
          {disk > 0 && <><span style={{ ...mono(9), color: "#2a3a4a" }}>·</span><span style={{ ...mono(9), color: "#445566" }}>{formatFileSize(disk)}</span></>}
        </div>
      </div>
    </button>
  );
}

// ─── Map Row ─────────────────────────────────────────────────────────────────
function MapRow({ map, selected, onClick }) {
  const st = STATUS_COLORS[map.status];
  const disk = totalDiskMB(map.files);
  return (
    <button onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "1fr 100px 70px 60px 60px 70px",
      alignItems: "center", width: "100%", textAlign: "left",
      padding: "8px 16px", border: "none", cursor: "pointer",
      background: selected ? "rgba(74,158,255,0.05)" : "transparent",
      borderLeft: selected ? "2px solid #4A9EFF" : "2px solid transparent",
      borderBottom: "1px solid rgba(255,255,255,0.02)", transition: "all 0.12s",
    }}>
      <div>
        <span style={{ ...outfit(12), fontWeight: 600, color: "#e0e6ed" }}>{map.displayName || map.name}</span>
        <span style={{ ...mono(9), color: "#3a4a5a", marginLeft: 8 }}>{map.name}</span>
      </div>
      <span style={{ ...mono(10), color: "#667788" }}>{map.author || "—"}</span>
      <span style={{ ...mono(10), color: "#8899aa" }}>{formatWorldSize(map.worldSize)}</span>
      <span style={{ ...mono(9), color: "#556677", display: "flex", alignItems: "center", gap: 3 }}><I.Layers /> {map.featureLayers?.length || 0}</span>
      <span style={{ ...mono(9), color: "#556677" }}>{disk > 0 ? formatFileSize(disk) : "—"}</span>
      <span style={{ ...mono(9), fontWeight: 600, color: st, textAlign: "right" }}>● {map.status === "complete" ? "Complete" : map.status === "incomplete" ? "Partial" : "None"}</span>
    </button>
  );
}

// ─── Map Detail Panel ────────────────────────────────────────────────────────
function MapDetail({ map, onClose, onDelete }) {
  const [tab, setTab] = useState("info");
  const [heroError, setHeroError] = useState(false);
  if (!map) return null;
  const st = STATUS_COLORS[map.status];
  const hue = mapHue(map.name);
  const disk = totalDiskMB(map.files);
  const showHero = map.hasPreview && !heroError;

  return (
    <div style={{ width: 330, flexShrink: 0, background: "rgba(8,12,17,0.97)", borderLeft: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", animation: "slideInRight 0.2s ease-out", overflow: "hidden" }}>
      {/* Hero */}
      <div style={{ height: 110, position: "relative", flexShrink: 0, background: `linear-gradient(135deg, hsl(${hue},18%,9%), hsl(${(hue + 40) % 360},13%,6%))`, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {showHero ? (
          <img src={`/maps/${map.name}/preview_512.png`} alt={map.displayName || map.name} onError={() => setHeroError(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }} />
        ) : (
          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.04 }}><defs><pattern id="dg" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M 14 0 L 0 0 0 14" fill="none" stroke="#4A9EFF" strokeWidth="0.3" /></pattern></defs><rect width="100%" height="100%" fill="url(#dg)" /></svg>
        )}
        <div style={{ textAlign: "center", zIndex: 1 }}>
          <div style={{ ...outfit(17), fontWeight: 700, color: "#e0e6ed" }}>{map.displayName || map.name}</div>
          <div style={{ ...mono(10), color: "#556677", marginTop: 2 }}>{map.name} · {formatWorldSize(map.worldSize)} · {map.author || "Unknown"}</div>
        </div>
        <button onClick={onClose} style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 6, background: "rgba(0,0,0,0.3)", border: "none", cursor: "pointer", color: "#556677", display: "flex", alignItems: "center", justifyContent: "center" }}><I.X /></button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
        {["info", "files", "styles"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", background: "none", border: "none", cursor: "pointer", ...mono(10), fontWeight: 600, letterSpacing: "0.03em", color: tab === t ? "#4A9EFF" : "#445566", borderBottom: tab === t ? "2px solid #4A9EFF" : "2px solid transparent", transition: "all 0.15s", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {tab === "info" && (
          <div style={{ animation: "fadeIn 0.15s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 12 }}>
              {[
                { l: "STATUS", v: map.status === "complete" ? "Complete" : map.status === "incomplete" ? "Partial" : "None", c: st },
                { l: "DISK", v: disk > 0 ? formatFileSize(disk) : "—", c: "#8899aa" },
                { l: "WORLD SIZE", v: formatWorldSize(map.worldSize), c: "#8899aa" },
                { l: "LAYERS", v: `${map.featureLayers?.length || 0} layers`, c: "#8899aa" },
              ].map(item => (
                <div key={item.l} style={{ padding: "6px 8px", borderRadius: 5, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ ...mono(7), color: "#3a4a5a", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 2 }}>{item.l}</div>
                  <div style={{ ...mono(11), color: item.c, fontWeight: 500 }}>{item.v}</div>
                </div>
              ))}
            </div>

            {map.elevation && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...mono(9), color: "#445566", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 5 }}>ELEVATION</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[
                    { l: "MIN", v: `${map.elevation.min.toFixed(0)}m`, c: "#4A9EFF" },
                    { l: "AVG", v: `${map.elevation.avg.toFixed(0)}m`, c: "#8899aa" },
                    { l: "MAX", v: `${map.elevation.max.toFixed(0)}m`, c: "#FF9F43" },
                    { l: "σ", v: `${map.elevation.stddev.toFixed(0)}m`, c: "#667788" },
                  ].map(e => (
                    <div key={e.l} style={{ flex: 1, textAlign: "center", padding: "5px 2px", borderRadius: 4, background: "rgba(0,0,0,0.2)" }}>
                      <div style={{ ...mono(11), fontWeight: 700, color: e.c, lineHeight: 1 }}>{e.v}</div>
                      <div style={{ ...mono(7), color: "#445566", marginTop: 2, fontWeight: 600 }}>{e.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.03)", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, height: "100%", borderRadius: 2, background: "linear-gradient(90deg, #4A9EFF, #2DD4A0, #FFB84A, #FF9F43)", opacity: 0.4, left: "5%", width: "90%" }} />
                </div>
              </div>
            )}

            {map.featureLayers?.length > 0 && (
              <div>
                <div style={{ ...mono(9), color: "#445566", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 5 }}>FEATURE LAYERS</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {map.featureLayers.map(l => (
                    <span key={l} style={{ ...mono(9), fontWeight: 500, padding: "2px 6px", borderRadius: 3, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.035)", color: "#778899" }}>{l}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "files" && (
          <div style={{ animation: "fadeIn 0.15s ease-out" }}>
            <div style={{ ...mono(9), color: "#445566", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 6 }}>TILE FILES</div>
            {OUTPUT_FILES.map(f => {
              const size = map.files?.[f.name]; const exists = size !== undefined;
              return (
                <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 4, opacity: exists ? 1 : 0.3 }}>
                  <span style={{ color: exists ? "#2DD4A0" : "#334455", display: "flex", width: 14 }}>{exists ? <I.Check /> : <I.X />}</span>
                  <span style={{ ...mono(10), color: exists ? "#99aabb" : "#556677", flex: 1 }}>{f.name}</span>
                  {exists && <span style={{ ...mono(9), color: "#556677" }}>{formatFileSize(size)}</span>}
                </div>
              );
            })}
            <div style={{ ...mono(9), color: "#445566", fontWeight: 600, letterSpacing: "0.08em", marginTop: 12, marginBottom: 6 }}>STYLE FILES</div>
            {["topo.json", "topo-dark.json", "topo-relief.json", "color-relief.json"].map(s => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px" }}>
                <span style={{ color: map.status === "complete" ? "#2DD4A0" : "#334455", display: "flex", width: 14 }}><I.Check /></span>
                <span style={{ ...mono(10), color: "#778899" }}>{s}</span>
              </div>
            ))}
            {["sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"].map(s => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px" }}>
                <span style={{ color: "#2DD4A088", display: "flex", width: 14 }}><I.Check /></span>
                <span style={{ ...mono(9), color: "#445566" }}>{s}</span>
              </div>
            ))}
            {disk > 0 && (
              <div style={{ marginTop: 10, padding: "7px 9px", borderRadius: 5, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: 6 }}>
                <I.HardDrive /><span style={{ ...mono(10), color: "#8899aa" }}>Total: {formatFileSize(disk)}</span>
              </div>
            )}
          </div>
        )}

        {tab === "styles" && (
          <div style={{ animation: "fadeIn 0.15s ease-out" }}>
            <div style={{ ...mono(9), color: "#445566", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 6 }}>MAP STYLE VARIANTS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {STYLE_VARIANTS.map(sv => (
                <div key={sv.id} style={{ padding: "9px 10px", borderRadius: 7, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...mono(11), color: "#c8d4e0", fontWeight: 600 }}>{sv.label}</div>
                    <div style={{ ...mono(9), color: "#556677" }}>{sv.desc}</div>
                  </div>
                  <span style={{ ...mono(8), color: "#334455" }}>{sv.id}.json</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, padding: "7px 9px", borderRadius: 5, background: "rgba(74,158,255,0.03)", border: "1px solid rgba(74,158,255,0.06)", ...mono(9), color: "#556677", lineHeight: 1.4 }}>
              28 built-in sprite icons in normal + dark variants. Styles reference tiles via PMTiles protocol URLs.
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
        <button onClick={() => onDelete?.(map)} style={{ width: "100%", padding: "8px 12px", borderRadius: 7, cursor: "pointer", background: "rgba(255,74,74,0.03)", border: "1px solid rgba(255,74,74,0.08)", color: "#FF6B6B77", ...mono(10), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <I.Trash /> Delete Map
        </button>
      </div>
    </div>
  );
}

// ─── Delete Confirm ──────────────────────────────────────────────────────────
function DeleteConfirm({ map, onConfirm, onCancel }) {
  const disk = totalDiskMB(map.files);
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.12s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 370, background: "#131c28", border: "1px solid rgba(255,74,74,0.12)", borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", animation: "fadeScale 0.2s ease-out" }}>
        <div style={{ padding: "20px 20px 14px", textAlign: "center" }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, margin: "0 auto 12px", background: "rgba(255,74,74,0.08)", border: "1px solid rgba(255,74,74,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FF6B6B" }}><I.AlertTriangle /></div>
          <div style={{ ...outfit(15), fontWeight: 600, color: "#e0e6ed", marginBottom: 6 }}>Delete {map.displayName || map.name}?</div>
          <div style={{ ...mono(11), color: "#8899aa", lineHeight: 1.5 }}>This removes all tiles, styles, previews, and metadata{disk > 0 ? ` (${formatFileSize(disk)})` : ""}. This action cannot be undone.</div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#8899aa", ...mono(11), cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onConfirm(map.name)} style={{ padding: "7px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #FF4A4A, #cc3333)", color: "#fff", ...mono(11), fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><I.Trash /> Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function MapTool() {
  const [maps, setMaps] = useState(MAPS);
  const [jobs] = useState(MOCK_JOBS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const [selectedMap, setSelectedMap] = useState(null);
  const [deletingMap, setDeletingMap] = useState(null);
  const [viewMode, setViewMode] = useState("grid");
  const [showImport, setShowImport] = useState(false);

  const filtered = useMemo(() => {
    let result = [...maps];
    if (search) { const s = search.toLowerCase(); result = result.filter(m => m.name.toLowerCase().includes(s) || (m.displayName || "").toLowerCase().includes(s) || (m.author || "").toLowerCase().includes(s)); }
    if (statusFilter) result = result.filter(m => m.status === statusFilter);
    result.sort((a, b) => {
      if (sortBy === "name") return (a.displayName || a.name).localeCompare(b.displayName || b.name);
      if (sortBy === "size") return b.worldSize - a.worldSize;
      if (sortBy === "disk") return totalDiskMB(b.files) - totalDiskMB(a.files);
      return 0;
    });
    return result;
  }, [maps, search, statusFilter, sortBy]);

  const detail = maps.find(m => m.name === selectedMap);
  const stats = useMemo(() => ({ total: maps.length, complete: maps.filter(m => m.status === "complete").length, totalDisk: maps.reduce((sum, m) => sum + totalDiskMB(m.files), 0) }), [maps]);

  const handleDelete = (name) => { setMaps(prev => prev.filter(m => m.name !== name)); setDeletingMap(null); setSelectedMap(null); };

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#080c11", color: "#c8d4e0", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        *::-webkit-scrollbar { width: 5px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 3px; }
        button:hover { filter: brightness(1.1); }
        input::placeholder { color: #334455; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeScale { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
      `}</style>

      {/* Header */}
      <header style={{ padding: "14px 24px 0", flexShrink: 0, animation: "fadeIn 0.3s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, background: "linear-gradient(135deg, rgba(74,158,255,0.1), rgba(45,212,160,0.06))", border: "1px solid rgba(74,158,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4A9EFF77" }}><I.Globe /></div>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ ...outfit(17), fontWeight: 800, color: "#e0e6ed", letterSpacing: "-0.02em" }}>OCAP</span>
                <span style={{ ...outfit(12), fontWeight: 400, color: "#556677" }}>Map Tool</span>
              </div>
              <div style={{ ...mono(10), color: "#3a4a5a" }}>{stats.total} maps · {stats.complete} complete · {formatFileSize(stats.totalDisk)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowImport(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, cursor: "pointer", background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.15)", color: "#4A9EFF", ...mono(10), fontWeight: 600 }}>
              <I.FilePlus /> Import Map
            </button>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, cursor: "pointer", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", color: "#778899", ...mono(10), fontWeight: 600 }}>
              <I.Paintbrush /> Restyle All
            </button>
          </div>
        </div>

        <StatusStrip tools={TOOLS} jobs={jobs} onCancel={(id) => console.log("cancel", id)} />

        {/* Search + Filters */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 11, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ flex: 1, maxWidth: 300, position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 9, color: "#2a3a4a", display: "flex" }}><I.Search /></span>
            <input type="text" placeholder="Search maps..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 10px 6px 30px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)", color: "#c8d4e0", ...mono(11), outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            {[null, "complete", "incomplete"].map(s => (
              <button key={s || "all"} onClick={() => setStatusFilter(f => f === s ? null : s)} style={{ padding: "4px 9px", borderRadius: 5, cursor: "pointer", ...mono(9), fontWeight: 600, background: statusFilter === s ? "rgba(74,158,255,0.08)" : "rgba(255,255,255,0.012)", color: statusFilter === s ? "#4A9EFF" : "#556677", border: `1px solid ${statusFilter === s ? "rgba(74,158,255,0.12)" : "rgba(255,255,255,0.03)"}` }}>
                {s ? (s === "complete" ? "Complete" : "Partial") : "All"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: 6 }}>
            <span style={{ ...mono(9), color: "#2a3a4a" }}>Sort</span>
            {[{ id: "name", l: "Name" }, { id: "size", l: "Size" }, { id: "disk", l: "Disk" }].map(s => (
              <button key={s.id} onClick={() => setSortBy(s.id)} style={{ padding: "3px 7px", borderRadius: 4, cursor: "pointer", ...mono(9), fontWeight: 600, border: "none", background: sortBy === s.id ? "rgba(74,158,255,0.08)" : "transparent", color: sortBy === s.id ? "#4A9EFF" : "#3a4a5a" }}>{s.l}</button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            {[{ m: "grid", i: <I.Grid /> }, { m: "list", i: <I.List /> }].map(v => (
              <button key={v.m} onClick={() => setViewMode(v.m)} style={{ width: 28, height: 28, borderRadius: 5, cursor: "pointer", background: viewMode === v.m ? "rgba(74,158,255,0.08)" : "transparent", border: `1px solid ${viewMode === v.m ? "rgba(74,158,255,0.12)" : "rgba(255,255,255,0.03)"}`, color: viewMode === v.m ? "#4A9EFF" : "#445566", display: "flex", alignItems: "center", justifyContent: "center" }}>{v.i}</button>
            ))}
          </div>
          <span style={{ ...mono(9), color: "#2a3a4a" }}>{filtered.length}</span>
        </div>
      </header>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: viewMode === "grid" ? "12px 24px" : "0" }}>
          {filtered.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, gap: 10, opacity: 0.35 }}>
              <I.Globe />
              <span style={{ ...mono(12), color: "#556677" }}>{search ? "No maps match your search" : "No maps imported yet"}</span>
              {!search && <button onClick={() => setShowImport(true)} style={{ marginTop: 4, padding: "8px 16px", borderRadius: 7, cursor: "pointer", background: "rgba(74,158,255,0.1)", border: "1px solid rgba(74,158,255,0.2)", color: "#4A9EFF", ...mono(11), fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: 2.5 }}><I.FilePlus /> Import Map</button>}
            </div>
          ) : viewMode === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 8 }}>
              {filtered.map(m => <MapCard key={m.name} map={m} selected={selectedMap === m.name} onClick={() => setSelectedMap(selectedMap === m.name ? null : m.name)} />)}
            </div>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px 60px 60px 70px", padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span />
                {["AUTHOR", "SIZE", "LAYERS", "DISK", "STATUS"].map(h => (
                  <span key={h} style={{ ...mono(8), color: "#2a3a4a", fontWeight: 700, letterSpacing: "0.08em", textAlign: h === "STATUS" ? "right" : "left" }}>{h}</span>
                ))}
              </div>
              {filtered.map(m => <MapRow key={m.name} map={m} selected={selectedMap === m.name} onClick={() => setSelectedMap(selectedMap === m.name ? null : m.name)} />)}
            </div>
          )}
        </div>
        {detail && <MapDetail map={detail} onClose={() => setSelectedMap(null)} onDelete={setDeletingMap} />}
      </div>

      {deletingMap && <DeleteConfirm map={deletingMap} onConfirm={handleDelete} onCancel={() => setDeletingMap(null)} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} onImport={(file) => { console.log("importing", file.name); setShowImport(false); }} />}
    </div>
  );
}
