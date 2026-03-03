/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(__dirname, "..");
const componentsDir = resolve(__dirname, "..", "..", "pages", "recording-playback", "components");

describe("CSS style files", () => {
  describe("variables.css", () => {
    const css = readFileSync(resolve(stylesDir, "variables.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("defines accent color custom properties", () => {
      expect(css).toContain("--accent-primary");
      expect(css).toContain("--accent-danger");
      expect(css).toContain("--accent-success");
      expect(css).toContain("--accent-purple");
      expect(css).toContain("--accent-warning");
    });

    it("defines base color custom properties", () => {
      expect(css).toContain("--bg-dark");
      expect(css).toContain("--bg-panel");
      expect(css).toContain("--bg-surface");
      expect(css).toContain("--text-primary");
      expect(css).toContain("--text-muted");
      expect(css).toContain("--highlight");
    });

    it("defines font custom properties", () => {
      expect(css).toContain("--font-mono");
      expect(css).toContain("--font-heading");
    });

    it("defines bright side color custom properties", () => {
      expect(css).toContain("--side-blufor: #00a8ff");
      expect(css).toContain("--side-opfor: #ff0000");
      expect(css).toContain("--side-ind: #00cc00");
      expect(css).toContain("--side-civ: #c900ff");
    });

    it("defines dark side color custom properties", () => {
      expect(css).toContain("--side-blufor-dark: #004D99");
      expect(css).toContain("--side-opfor-dark: #800000");
      expect(css).toContain("--side-ind-dark: #007F00");
      expect(css).toContain("--side-civ-dark: #650080");
    });

    it("defines state color custom properties", () => {
      expect(css).toContain("--color-dead");
      expect(css).toContain("--color-hit");
    });
  });

  describe("base.css", () => {
    const css = readFileSync(resolve(stylesDir, "base.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains reset styles", () => {
      expect(css).toContain("box-sizing: border-box");
    });

    it("contains map container styles", () => {
      expect(css).toContain(".map-container");
    });
  });

  describe("global.css", () => {
    const css = readFileSync(resolve(stylesDir, "global.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains side colour classes using custom properties", () => {
      expect(css).toContain(".blufor");
      expect(css).toMatch(/\.blufor\s*\{[^}]*var\(--side-blufor\)/);

      expect(css).toContain(".opfor");
      expect(css).toMatch(/\.opfor\s*\{[^}]*var\(--side-opfor\)/);

      expect(css).toContain(".ind");
      expect(css).toMatch(/\.ind\s*\{[^}]*var\(--side-ind\)/);

      expect(css).toContain(".civ");
      expect(css).toMatch(/\.civ\s*\{[^}]*var\(--side-civ\)/);
    });

    it("contains utility text weight classes", () => {
      expect(css).toContain(".bold");
      expect(css).toContain(".medium");
    });

    it("contains event item state classes", () => {
      expect(css).toContain(".reveal");
      expect(css).toContain(".action");
    });
  });

  describe("leaflet.css", () => {
    const css = readFileSync(resolve(stylesDir, "leaflet.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains leaflet overrides", () => {
      expect(css).toContain(".leaflet-popup");
      expect(css).toContain(".leaflet-div-icon");
    });

    it("contains scale ruler dark theme", () => {
      expect(css).toContain(".leaflet-control-scale-line");
    });
  });

  describe("responsive.css", () => {
    const css = readFileSync(resolve(stylesDir, "responsive.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains responsive breakpoints", () => {
      expect(css).toContain("@media");
      expect(css).toContain("max-width");
    });
  });

  describe("CSS Modules", () => {
    const moduleFiles = [
      "Hint.module.css",
      "CounterDisplay.module.css",
      "TopBar.module.css",
      "BottomBar.module.css",
      "SidePanel.module.css",
      "MapControls.module.css",
    ];

    for (const file of moduleFiles) {
      it(`${file} exists and is non-empty`, () => {
        const path = resolve(componentsDir, file);
        expect(existsSync(path)).toBe(true);
        const content = readFileSync(path, "utf-8");
        expect(content.length).toBeGreaterThan(0);
      });
    }
  });

  describe("entities.css", () => {
    const css = readFileSync(resolve(stylesDir, "entities.css"), "utf-8");

    it("exists and is non-empty", () => {
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains side colour utilities using custom properties", () => {
      expect(css).toMatch(/\.side-blufor\s*\{[^}]*var\(--side-blufor-dark\)/);
      expect(css).toMatch(/\.side-opfor\s*\{[^}]*var\(--side-opfor-dark\)/);
      expect(css).toMatch(/\.side-ind\s*\{[^}]*var\(--side-ind-dark\)/);
      expect(css).toMatch(/\.side-civ\s*\{[^}]*var\(--side-civ-dark\)/);
    });

    it("contains side background colour utilities", () => {
      expect(css).toContain(".side-bg-blufor");
      expect(css).toContain(".side-bg-opfor");
      expect(css).toContain(".side-bg-ind");
      expect(css).toContain(".side-bg-civ");
    });

    it("contains dead and hit state colours using custom properties", () => {
      expect(css).toMatch(/\.side-dead\s*\{[^}]*var\(--color-dead\)/);
      expect(css).toMatch(/\.side-hit\s*\{[^}]*var\(--color-hit\)/);
    });
  });

  describe("all partial files exist", () => {
    const partials = [
      "variables.css",
      "base.css",
      "global.css",
      "entities.css",
      "leaflet.css",
      "responsive.css",
    ];

    for (const file of partials) {
      it(`${file} exists and is non-empty`, () => {
        const path = resolve(stylesDir, file);
        expect(existsSync(path)).toBe(true);
        const content = readFileSync(path, "utf-8");
        expect(content.length).toBeGreaterThan(0);
      });
    }
  });
});
