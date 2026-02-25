import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES,
  OUTPUT_FILES,
  STYLE_VARIANTS,
  STATUS_COLORS,
  MAP_STATUS_COLORS,
} from "../constants";

describe("PIPELINE_STAGES", () => {
  it("has stages with unique ids", () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each stage has id, label, and short", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(stage.id).toBeTruthy();
      expect(stage.label).toBeTruthy();
      expect(stage.short).toBeTruthy();
    }
  });

  it("includes expected stages", () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    expect(ids).toContain("parse_gradmeh");
    expect(ids).toContain("render");
    expect(ids).toContain("generate_styles");
  });
});

describe("OUTPUT_FILES", () => {
  it("has files with name and label", () => {
    expect(OUTPUT_FILES.length).toBeGreaterThan(0);
    for (const f of OUTPUT_FILES) {
      expect(f.name).toBeTruthy();
      expect(f.label).toBeTruthy();
    }
  });

  it("includes satellite.pmtiles", () => {
    expect(OUTPUT_FILES.find((f) => f.name === "satellite.pmtiles")).toBeTruthy();
  });
});

describe("STYLE_VARIANTS", () => {
  it("has variants with file, label, and desc", () => {
    expect(STYLE_VARIANTS.length).toBeGreaterThan(0);
    for (const v of STYLE_VARIANTS) {
      expect(v.file).toBeTruthy();
      expect(v.label).toBeTruthy();
      expect(v.desc).toBeTruthy();
    }
  });
});

describe("STATUS_COLORS", () => {
  it("has entries for all job statuses", () => {
    expect(STATUS_COLORS.pending).toBeTruthy();
    expect(STATUS_COLORS.running).toBeTruthy();
    expect(STATUS_COLORS.done).toBeTruthy();
    expect(STATUS_COLORS.failed).toBeTruthy();
    expect(STATUS_COLORS.cancelled).toBeTruthy();
  });
});

describe("MAP_STATUS_COLORS", () => {
  it("has entries for all map statuses", () => {
    expect(MAP_STATUS_COLORS.none).toBeTruthy();
    expect(MAP_STATUS_COLORS.incomplete).toBeTruthy();
    expect(MAP_STATUS_COLORS.complete).toBeTruthy();
  });
});
