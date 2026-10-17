import { describe, it, expect } from "vitest";
import {
  niceScaleDistance,
  formatScaleLabel,
  scaleBarWidthPx,
  armaMetersBetween,
  SCALE_MIN_METERS,
  SCALE_MAX_WIDTH_PX,
} from "../scaleBar";

/**
 * Leaflet Control.Scale's integer-only rounder. Copied so these tests keep
 * documenting why we cannot use it: every span under 1 m collapses to 1.
 */
function leafletGetRoundNum(num: number): number {
  const pow10 = Math.pow(10, (Math.floor(num) + "").length - 1);
  let d = num / pow10;
  d = d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1;
  return pow10 * d;
}

/**
 * Horizontal metres covered by `widthPx` in the legacy Simple CRS:
 * 1 arma metre = multiplier * 2^(zoom - maxNativeZoom) pixels.
 */
function legacyHorizontalMeters(
  widthPx: number,
  zoom: number,
  maxNativeZoom: number,
  multiplier = 1,
): number {
  return widthPx / (multiplier * 2 ** (zoom - maxNativeZoom));
}

/**
 * Horizontal Arma metres for `widthPx` on EPSG:3857. Δlng per pixel is
 * 360 / (256 * 2^zoom), independent of latitude; we multiply by the same
 * METERS_PER_DEGREE the renderer uses.
 */
function mapLibreHorizontalMeters(
  widthPx: number,
  zoom: number,
  metersPerDegree: number,
): number {
  return widthPx * (360 / (256 * 2 ** zoom)) * metersPerDegree;
}

describe("niceScaleDistance", () => {
  it("picks 1-2-5 values in kilometres", () => {
    expect(niceScaleDistance(15000)).toBe(10000);
    expect(niceScaleDistance(3500)).toBe(2000);
    expect(niceScaleDistance(5000)).toBe(5000);
  });

  it("picks 1-2-5 values in metres", () => {
    expect(niceScaleDistance(100)).toBe(100);
    expect(niceScaleDistance(99)).toBe(50);
    expect(niceScaleDistance(3.1)).toBe(2);
    expect(niceScaleDistance(1.5)).toBe(1);
  });

  it("keeps shrinking below 1 m instead of sticking at 1 m", () => {
    expect(niceScaleDistance(0.8)).toBe(0.5);
    expect(niceScaleDistance(0.4)).toBe(0.2);
    expect(niceScaleDistance(0.03)).toBe(0.02);
    expect(niceScaleDistance(0.015)).toBe(0.01);
  });

  it("floors at 1 cm", () => {
    expect(niceScaleDistance(0.004)).toBe(SCALE_MIN_METERS);
    expect(niceScaleDistance(0)).toBe(SCALE_MIN_METERS);
    expect(niceScaleDistance(-1)).toBe(SCALE_MIN_METERS);
    expect(niceScaleDistance(Number.NaN)).toBe(SCALE_MIN_METERS);
    expect(niceScaleDistance(Number.POSITIVE_INFINITY)).toBe(SCALE_MIN_METERS);
  });

  it("lands on the 1-2-5 step just below each threshold", () => {
    const cases: Array<[number, number]> = [
      [0.019, 0.01],
      [0.02, 0.02],
      [0.049, 0.02],
      [0.05, 0.05],
      [0.099, 0.05],
      [0.1, 0.1],
      [0.199, 0.1],
      [0.2, 0.2],
      [0.499, 0.2],
      [0.5, 0.5],
      [0.999, 0.5],
      [1, 1],
      [1.999, 1],
      [2, 2],
      [4.999, 2],
      [5, 5],
      [9.999, 5],
      [10, 10],
      [19.99, 10],
      [20, 20],
      [49.99, 20],
      [50, 50],
      [199, 100],
      [200, 200],
      [499, 200],
      [999, 500],
      [1000, 1000],
      [1600, 1000],
      [1999, 1000],
      [4999, 2000],
      [6250, 5000],
      [9999, 5000],
      [10000, 10000],
    ];
    for (const [span, expected] of cases) {
      expect(niceScaleDistance(span), `span ${span}`).toBe(expected);
    }
  });

  it("never returns Leaflet's stuck-at-1-m answer for sub-metre spans", () => {
    for (const span of [0.01, 0.03, 0.08, 0.2, 0.5, 0.8, 0.99]) {
      expect(leafletGetRoundNum(span)).toBe(1);
      expect(niceScaleDistance(span)).toBeLessThan(1);
    }
  });
});

describe("formatScaleLabel", () => {
  it("uses km at and above 1 km", () => {
    expect(formatScaleLabel(1000)).toBe("1 km");
    expect(formatScaleLabel(2000)).toBe("2 km");
    expect(formatScaleLabel(5000)).toBe("5 km");
    expect(formatScaleLabel(10000)).toBe("10 km");
    expect(formatScaleLabel(50000)).toBe("50 km");
  });

  it("uses metres from 1 m up to 1 km", () => {
    expect(formatScaleLabel(1)).toBe("1 m");
    expect(formatScaleLabel(2)).toBe("2 m");
    expect(formatScaleLabel(20)).toBe("20 m");
    expect(formatScaleLabel(50)).toBe("50 m");
    expect(formatScaleLabel(100)).toBe("100 m");
    expect(formatScaleLabel(200)).toBe("200 m");
    expect(formatScaleLabel(500)).toBe("500 m");
  });

  it("switches to centimetres below 1 m", () => {
    expect(formatScaleLabel(0.5)).toBe("50 cm");
    expect(formatScaleLabel(0.2)).toBe("20 cm");
    expect(formatScaleLabel(0.1)).toBe("10 cm");
    expect(formatScaleLabel(0.05)).toBe("5 cm");
    expect(formatScaleLabel(0.02)).toBe("2 cm");
    expect(formatScaleLabel(0.01)).toBe("1 cm");
  });

  it("labels every 1-2-5 step from 1 cm to 50 km", () => {
    const expected: Array<[number, string]> = [
      [0.01, "1 cm"],
      [0.02, "2 cm"],
      [0.05, "5 cm"],
      [0.1, "10 cm"],
      [0.2, "20 cm"],
      [0.5, "50 cm"],
      [1, "1 m"],
      [2, "2 m"],
      [5, "5 m"],
      [10, "10 m"],
      [20, "20 m"],
      [50, "50 m"],
      [100, "100 m"],
      [200, "200 m"],
      [500, "500 m"],
      [1000, "1 km"],
      [2000, "2 km"],
      [5000, "5 km"],
      [10000, "10 km"],
      [20000, "20 km"],
      [50000, "50 km"],
    ];
    for (const [meters, label] of expected) {
      expect(formatScaleLabel(meters)).toBe(label);
    }
  });
});

describe("scaleBarWidthPx", () => {
  it("is the fraction of maxWidth that niceMeters occupies", () => {
    expect(scaleBarWidthPx(50, 100, 100)).toBe(50);
    expect(scaleBarWidthPx(100, 100, 100)).toBe(100);
    expect(scaleBarWidthPx(5, 6.25, 100)).toBe(80);
    expect(scaleBarWidthPx(20, 25, 100)).toBe(80);
    expect(scaleBarWidthPx(10, 12.5, 100)).toBe(80);
    expect(scaleBarWidthPx(200, 400, 100)).toBe(50);
    expect(scaleBarWidthPx(1000, 1600, 100)).toBe(63);
  });

  it("never returns less than 1 px", () => {
    expect(scaleBarWidthPx(0.01, 100, 100)).toBe(1);
  });

  it("defaults the max width to the Leaflet 100 px target", () => {
    expect(scaleBarWidthPx(50, 100)).toBe(SCALE_MAX_WIDTH_PX / 2);
  });

  it("grows past maxWidth when the 1 cm floor exceeds the span", () => {
    // 100 px = 4 mm, labelled 1 cm → bar is 2.5× the 100 px target.
    expect(scaleBarWidthPx(0.01, 0.004, 100)).toBe(250);
  });
});

describe("armaMetersBetween", () => {
  it("is planar hypot in world metres", () => {
    expect(armaMetersBetween([0, 0], [3, 4])).toBe(5);
    expect(armaMetersBetween([1000, 2000], [1000, 2100])).toBe(100);
    expect(armaMetersBetween([50, 50], [50, 50])).toBe(0);
  });
});

describe("legacy CRS metres-per-pixel formula", () => {
  // multiplier=1, maxNativeZoom=4: 100 px spans 100 / 2^(z-4) metres.
  const expectedByZoom: Array<[number, number, string, number]> = [
    [0, 1600, "1 km", 63],
    [1, 800, "500 m", 63],
    [2, 400, "200 m", 50],
    [3, 200, "200 m", 100],
    [4, 100, "100 m", 100],
    [5, 50, "50 m", 100],
    [6, 25, "20 m", 80],
    [7, 12.5, "10 m", 80],
    [8, 6.25, "5 m", 80],
  ];

  it("matches 1-2-5 labels at every zoom 0..native+4", () => {
    for (const [zoom, span, label, width] of expectedByZoom) {
      const measured = legacyHorizontalMeters(100, zoom, 4, 1);
      expect(measured, `zoom ${zoom} span`).toBe(span);
      expect(formatScaleLabel(niceScaleDistance(measured)), `zoom ${zoom}`).toBe(label);
      expect(scaleBarWidthPx(niceScaleDistance(measured), measured), `zoom ${zoom} width`).toBe(width);
    }
  });

  it("scales with a non-1 tile multiplier", () => {
    // multiplier=2: at native zoom, 1 m = 2 px, so 100 px = 50 m.
    expect(legacyHorizontalMeters(100, 4, 4, 2)).toBe(50);
    expect(formatScaleLabel(niceScaleDistance(50))).toBe("50 m");
    // multiplier=0.5: at native zoom, 1 m = 0.5 px, so 100 px = 200 m.
    expect(legacyHorizontalMeters(100, 4, 4, 0.5)).toBe(200);
    expect(formatScaleLabel(niceScaleDistance(200))).toBe("200 m");
  });

  it("reaches centimetres once 100 px is under 1 m of world", () => {
    // native+7: 1 m = 128 px, 100 px ≈ 0.781 m → 50 cm.
    const span = legacyHorizontalMeters(100, 11, 4, 1);
    expect(span).toBeCloseTo(100 / 128, 10);
    expect(formatScaleLabel(niceScaleDistance(span))).toBe("50 cm");
    // native+10: 1 m = 1024 px, 100 px ≈ 0.0977 m → 5 cm.
    const tight = legacyHorizontalMeters(100, 14, 4, 1);
    expect(formatScaleLabel(niceScaleDistance(tight))).toBe("5 cm");
  });
});

describe("MapLibre / EPSG:3857 100 px span", () => {
  const METERS_PER_DEGREE = 111320;

  it("is Δlng * 111320, matching the renderer's Arma conversion", () => {
    // 100 px * 360° / (256 * 2^z) * 111320 m/°
    expect(mapLibreHorizontalMeters(100, 12, METERS_PER_DEGREE)).toBeCloseTo(3821.87, 1);
    expect(formatScaleLabel(niceScaleDistance(3821.87))).toBe("2 km");

    expect(mapLibreHorizontalMeters(100, 18, METERS_PER_DEGREE)).toBeCloseTo(59.72, 1);
    expect(formatScaleLabel(niceScaleDistance(59.72))).toBe("50 m");

    // MapLibre's own max zoom is 22: still metres, not yet centimetres.
    expect(mapLibreHorizontalMeters(100, 22, METERS_PER_DEGREE)).toBeCloseTo(3.73, 2);
    expect(formatScaleLabel(niceScaleDistance(3.73))).toBe("2 m");
  });
});
