import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { OcapLogoSvg } from "../OcapLogoSvg";

afterEach(() => { cleanup(); });

describe("OcapLogoSvg", () => {
  it("renders an SVG with default size 42", () => {
    const { container } = render(() => <OcapLogoSvg />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("width")).toBe("42");
    expect(svg!.getAttribute("height")).toBe("42");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 42 42");
  });

  it("renders an SVG with custom size", () => {
    const { container } = render(() => <OcapLogoSvg size={64} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("width")).toBe("64");
    expect(svg!.getAttribute("height")).toBe("64");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 64 64");
  });

  it("contains the expected number of circle elements", () => {
    const { container } = render(() => <OcapLogoSvg />);
    // 8 visible circles + 1 low-opacity background circle = 9 total
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(9);
  });

  it("contains the expected number of line elements", () => {
    const { container } = render(() => <OcapLogoSvg />);
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBe(6);
  });

  it("contains a linearGradient definition", () => {
    const { container } = render(() => <OcapLogoSvg />);
    const gradient = container.querySelector("linearGradient#logoGrad");
    expect(gradient).not.toBeNull();
    const stops = gradient!.querySelectorAll("stop");
    expect(stops.length).toBe(2);
  });

  it("positions circles relative to the given size", () => {
    const { container } = render(() => <OcapLogoSvg size={100} />);
    const circles = container.querySelectorAll("circle");
    // Center circle should be at (50, 50)
    const centerCircle = circles[1]; // second circle is the filled center dot
    expect(centerCircle.getAttribute("cx")).toBe("50");
    expect(centerCircle.getAttribute("cy")).toBe("50");
  });
});
