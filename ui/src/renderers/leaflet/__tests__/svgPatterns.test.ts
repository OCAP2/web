import { describe, it, expect, vi, beforeEach } from "vitest";
import L from "leaflet";
import {
  ensureDefs,
  nextPatternId,
  createStripePattern,
  createGridPattern,
  removePattern,
  patchSVGUpdateStyle,
} from "../svgPatterns";

function makeSVG(): SVGSVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg");
}

function makeDefs(): SVGDefsElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "defs");
}

describe("ensureDefs", () => {
  it("creates <defs> if missing", () => {
    const svg = makeSVG();
    const renderer = { _container: svg } as unknown as L.SVG;
    const defs = ensureDefs(renderer);
    expect(defs.tagName).toBe("defs");
    expect(svg.contains(defs)).toBe(true);
  });

  it("reuses existing <defs>", () => {
    const svg = makeSVG();
    const existing = makeDefs();
    svg.appendChild(existing);
    const renderer = { _container: svg } as unknown as L.SVG;
    const defs = ensureDefs(renderer);
    expect(defs).toBe(existing);
    expect(svg.querySelectorAll("defs").length).toBe(1);
  });
});

describe("nextPatternId", () => {
  it("returns incrementing IDs", () => {
    const a = nextPatternId();
    const b = nextPatternId();
    expect(a).toMatch(/^ocap-pat-\d+$/);
    expect(b).toMatch(/^ocap-pat-\d+$/);
    expect(a).not.toBe(b);
  });
});

describe("createStripePattern", () => {
  it("generates SVG pattern with line and rotation", () => {
    const defs = makeDefs();
    createStripePattern(defs, "test-stripe", "#FF0000", 45, 2, 6, 0.8);

    const pat = defs.querySelector("#test-stripe") as SVGPatternElement;
    expect(pat).not.toBeNull();
    expect(pat.getAttribute("width")).toBe("8"); // weight + spaceWeight
    expect(pat.getAttribute("height")).toBe("8");
    expect(pat.getAttribute("patternTransform")).toBe("rotate(45)");
    expect(pat.getAttribute("patternUnits")).toBe("userSpaceOnUse");

    const line = pat.querySelector("line")!;
    expect(line.getAttribute("stroke")).toBe("#FF0000");
    expect(line.getAttribute("stroke-width")).toBe("2");
    expect(line.getAttribute("stroke-opacity")).toBe("0.8");
    expect(line.getAttribute("y1")).toBe("1"); // weight / 2
  });
});

describe("createGridPattern", () => {
  it("generates SVG pattern with bg rect and H+V lines", () => {
    const defs = makeDefs();
    createGridPattern(defs, "test-grid", "#00FF00", 2, 6, 0.5, 0.3);

    const pat = defs.querySelector("#test-grid") as SVGPatternElement;
    expect(pat).not.toBeNull();
    expect(pat.getAttribute("width")).toBe("8");
    expect(pat.getAttribute("height")).toBe("8");
    expect(pat.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    // No rotation for grid
    expect(pat.getAttribute("patternTransform")).toBeNull();

    const rect = pat.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("#00FF00");
    expect(rect.getAttribute("fill-opacity")).toBe("0.3");

    const lines = pat.querySelectorAll("line");
    expect(lines.length).toBe(2);

    // Horizontal line
    expect(lines[0].getAttribute("y1")).toBe("1");
    expect(lines[0].getAttribute("y2")).toBe("1");
    expect(lines[0].getAttribute("x1")).toBe("0");
    expect(lines[0].getAttribute("x2")).toBe("8");

    // Vertical line
    expect(lines[1].getAttribute("x1")).toBe("1");
    expect(lines[1].getAttribute("x2")).toBe("1");
    expect(lines[1].getAttribute("y1")).toBe("0");
    expect(lines[1].getAttribute("y2")).toBe("8");
  });
});

describe("removePattern", () => {
  it("removes the pattern element from defs", () => {
    const defs = makeDefs();
    createStripePattern(defs, "to-remove", "#000", 0, 2, 6, 1);
    expect(defs.querySelector("#to-remove")).not.toBeNull();

    removePattern(defs, "to-remove");
    expect(defs.querySelector("#to-remove")).toBeNull();
  });

  it("does nothing if pattern does not exist", () => {
    const defs = makeDefs();
    expect(() => removePattern(defs, "nonexistent")).not.toThrow();
  });
});

describe("patchSVGUpdateStyle", () => {
  it("re-applies pattern fill after _updateStyle", () => {
    // Reset patch flag so we can test fresh
    const proto = L.SVG.prototype as any;
    delete proto._ocapPatched;
    // Save and restore original to avoid polluting other tests
    const origFn = proto._updateStyle;

    // Mock the original _updateStyle
    proto._updateStyle = vi.fn();

    patchSVGUpdateStyle();

    const mockPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mockLayer = {
      options: { _fillPatternId: "my-pat" },
      _path: mockPath,
    };

    const instance = {} as any;
    proto._updateStyle.call(instance, mockLayer);

    expect(mockPath.getAttribute("fill")).toBe("url(#my-pat)");

    // Restore
    proto._updateStyle = origFn;
    delete proto._ocapPatched;
  });

  it("does not set fill when no _fillPatternId", () => {
    const proto = L.SVG.prototype as any;
    delete proto._ocapPatched;
    const origFn = proto._updateStyle;

    proto._updateStyle = vi.fn();
    patchSVGUpdateStyle();

    const mockPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mockLayer = {
      options: {},
      _path: mockPath,
    };

    const instance = {} as any;
    proto._updateStyle.call(instance, mockLayer);

    expect(mockPath.getAttribute("fill")).toBeNull();

    proto._updateStyle = origFn;
    delete proto._ocapPatched;
  });
});
