import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(__dirname, "..");

describe("CSS style files", () => {
  describe("index.css", () => {
    const css = readFileSync(resolve(stylesDir, "index.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains map container styles", () => {
      expect(css).toContain(".map-container");
    });

    it("contains top panel styles", () => {
      expect(css).toContain(".top-panel");
    });

    it("contains left panel styles", () => {
      expect(css).toContain(".left-panel");
    });

    it("contains right panel styles", () => {
      expect(css).toContain(".right-panel");
    });

    it("contains bottom panel styles", () => {
      expect(css).toContain(".bottom-panel");
    });

    it("contains panel collapsing transitions", () => {
      expect(css).toContain(".collapsed");
      expect(css).toContain("transition");
    });

    it("contains unit list styling", () => {
      expect(css).toContain(".unit-list");
      expect(css).toContain(".unit-item");
      expect(css).toContain(".group-item");
    });

    it("contains side colour classes for event log text (matching old frontend)", () => {
      // Bright colours for event log readability on dark background
      // These match the old frontend's static/style/index.css
      expect(css).toContain(".blufor");
      expect(css).toMatch(/\.blufor\s*\{[^}]*color:\s*#00a8ff/i);

      expect(css).toContain(".opfor");
      expect(css).toMatch(/\.opfor\s*\{[^}]*color:\s*#ff0000/i);

      expect(css).toContain(".ind");
      expect(css).toMatch(/\.ind\s*\{[^}]*color:\s*#00cc00/i);

      expect(css).toContain(".civ");
      expect(css).toMatch(/\.civ\s*\{[^}]*color:\s*#c900ff/i);
    });

    it("contains event list styling", () => {
      expect(css).toContain(".event-item");
      expect(css).toContain(".event-details");
    });

    it("contains playback control styles", () => {
      expect(css).toContain(".play-pause-btn");
      expect(css).toContain(".timecode");
      expect(css).toContain(".frame-slider");
    });

    it("contains modal overlay styles", () => {
      expect(css).toContain(".modal-overlay");
      expect(css).toContain(".modal-header");
      expect(css).toContain(".modal-body");
    });

    it("contains speed slider styles", () => {
      expect(css).toContain(".speed-slider");
      expect(css).toContain(".speed-value");
    });

    it("contains counter display styles", () => {
      expect(css).toContain(".counter-display");
    });

    it("contains hint toast styles", () => {
      expect(css).toContain(".hint-toast");
    });

    it("contains responsive breakpoints", () => {
      expect(css).toContain("@media");
      expect(css).toContain("max-width");
    });

    it("contains range input styling", () => {
      expect(css).toContain('input[type="range"]');
    });

    it("contains event timeline styles", () => {
      expect(css).toContain(".event-timeline");
      expect(css).toContain(".event-timeline-tick");
    });

    it("contains loading indicator styles", () => {
      expect(css).toContain(".loading-indicator");
      expect(css).toContain(".loading-spinner");
    });

    it("contains leaflet overrides", () => {
      expect(css).toContain(".leaflet-popup");
      expect(css).toContain(".leaflet-div-icon");
    });
  });

  describe("entities.css", () => {
    const css = readFileSync(resolve(stylesDir, "entities.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("defines --marker-speed custom property", () => {
      expect(css).toContain("--marker-speed");
    });

    it("contains marker transition rules", () => {
      expect(css).toContain(".marker-transition .leaflet-marker-icon.animation");
      expect(css).toContain(".marker-transition .leaflet-popup.animation");
    });

    it("disables transitions during zoom", () => {
      expect(css).toContain(".marker-transition.zooming");
      expect(css).toContain("transition: none !important");
    });

    it("defines speed classes from speed-1 to speed-10", () => {
      for (let i = 1; i <= 10; i++) {
        expect(css).toContain(`.speed-${i}`);
      }
    });

    it("has correct speed durations", () => {
      // speed-1 = 1s, speed-2 = 0.9s, ..., speed-10 = 0.15s
      expect(css).toMatch(/\.speed-1\s*\{[^}]*--marker-speed:\s*1s/);
      expect(css).toMatch(/\.speed-2\s*\{[^}]*--marker-speed:\s*0\.9s/);
      expect(css).toMatch(/\.speed-5\s*\{[^}]*--marker-speed:\s*0\.6s/);
      expect(css).toMatch(/\.speed-9\s*\{[^}]*--marker-speed:\s*0\.2s/);
      expect(css).toMatch(/\.speed-10\s*\{[^}]*--marker-speed:\s*0\.15s/);
    });

    it("contains side colour utilities matching unit.ts SIDE_COLOUR values", () => {
      // WEST -> #004D99, EAST -> #800000, GUER -> #007F00, CIV -> #650080
      expect(css).toMatch(/\.side-blufor\s*\{[^}]*color:\s*#004D99/i);
      expect(css).toMatch(/\.side-opfor\s*\{[^}]*color:\s*#800000/i);
      expect(css).toMatch(/\.side-ind\s*\{[^}]*color:\s*#007F00/i);
      expect(css).toMatch(/\.side-civ\s*\{[^}]*color:\s*#650080/i);
    });

    it("contains side background colour utilities", () => {
      expect(css).toContain(".side-bg-blufor");
      expect(css).toContain(".side-bg-opfor");
      expect(css).toContain(".side-bg-ind");
      expect(css).toContain(".side-bg-civ");
    });

    it("contains dead and hit state colours", () => {
      expect(css).toContain(".side-dead");
      expect(css).toContain(".side-hit");
    });
  });
});
