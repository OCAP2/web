import L from "leaflet";

let patternCounter = 0;

/** Get or create <defs> inside the SVG renderer container. */
export function ensureDefs(svgRenderer: L.SVG): SVGDefsElement {
  const container = (svgRenderer as any)._container as SVGSVGElement;
  let defs = container.querySelector("defs") as SVGDefsElement | null;
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    container.insertBefore(defs, container.firstChild);
  }
  return defs;
}

/** Generate a unique pattern ID. */
export function nextPatternId(): string {
  return `ocap-pat-${++patternCounter}`;
}

/** Create a stripe <pattern> (for horizontal, vertical, fdiagonal, bdiagonal, diaggrid). */
export function createStripePattern(
  defs: SVGDefsElement,
  id: string,
  color: string,
  angle: number,
  weight: number,
  spaceWeight: number,
  opacity: number,
): void {
  const size = weight + spaceWeight;
  const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
  pat.setAttribute("id", id);
  pat.setAttribute("width", String(size));
  pat.setAttribute("height", String(size));
  pat.setAttribute("patternTransform", `rotate(${angle})`);
  pat.setAttribute("patternUnits", "userSpaceOnUse");

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", String(weight / 2));
  line.setAttribute("x2", String(size));
  line.setAttribute("y2", String(weight / 2));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", String(weight));
  line.setAttribute("stroke-opacity", String(opacity));
  pat.appendChild(line);

  defs.appendChild(pat);
}

/** Create a grid <pattern> (for grid, cross — orthogonal H+V lines). */
export function createGridPattern(
  defs: SVGDefsElement,
  id: string,
  color: string,
  weight: number,
  spaceWeight: number,
  opacity: number,
  bgOpacity: number,
): void {
  const size = weight + spaceWeight;
  const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
  pat.setAttribute("id", id);
  pat.setAttribute("width", String(size));
  pat.setAttribute("height", String(size));
  pat.setAttribute("patternUnits", "userSpaceOnUse");

  // Background rect
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", String(size));
  rect.setAttribute("height", String(size));
  rect.setAttribute("fill", color);
  rect.setAttribute("fill-opacity", String(bgOpacity));
  pat.appendChild(rect);

  // Horizontal line
  const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  hLine.setAttribute("x1", "0");
  hLine.setAttribute("y1", String(weight / 2));
  hLine.setAttribute("x2", String(size));
  hLine.setAttribute("y2", String(weight / 2));
  hLine.setAttribute("stroke", color);
  hLine.setAttribute("stroke-width", String(weight));
  hLine.setAttribute("stroke-opacity", String(opacity));
  pat.appendChild(hLine);

  // Vertical line
  const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  vLine.setAttribute("x1", String(weight / 2));
  vLine.setAttribute("y1", "0");
  vLine.setAttribute("x2", String(weight / 2));
  vLine.setAttribute("y2", String(size));
  vLine.setAttribute("stroke", color);
  vLine.setAttribute("stroke-width", String(weight));
  vLine.setAttribute("stroke-opacity", String(opacity));
  pat.appendChild(vLine);

  defs.appendChild(pat);
}

/** Remove a pattern element from defs. */
export function removePattern(defs: SVGDefsElement, id: string): void {
  const el = defs.querySelector(`#${id}`);
  if (el) {
    defs.removeChild(el);
  }
}

/**
 * Monkey-patch L.SVG._updateStyle to preserve pattern fills.
 * Leaflet resets `fill` on every style update — this re-applies url(#patternId).
 * Must be called once during renderer init.
 */
export function patchSVGUpdateStyle(): void {
  const proto = L.SVG.prototype as any;
  if (proto._ocapPatched) return;
  const orig = proto._updateStyle;
  proto._updateStyle = function (layer: any) {
    orig.call(this, layer);
    if (layer.options?._fillPatternId && layer._path) {
      layer._path.setAttribute("fill", `url(#${layer.options._fillPatternId})`);
    }
  };
  proto._ocapPatched = true;
}
