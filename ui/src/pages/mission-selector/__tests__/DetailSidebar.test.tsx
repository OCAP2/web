import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../ui/hooks/useLocale";
import { CustomizeProvider } from "../../../ui/hooks/useCustomize";
import { DetailSidebar } from "../DetailSidebar";
import type { Operation } from "../../../data/types";

const baseOp: Operation = {
  id: "1",
  worldName: "Altis",
  missionName: "Op Alpha",
  missionDuration: 3600,
  date: "2024-01-01",
  tag: "TvT",
};

function renderSidebar(initialOp: Operation = baseOp) {
  const [op, setOp] = createSignal(initialOp);
  const onLaunch = vi.fn();
  const onClose = vi.fn();

  const result = render(() => (
    <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
      <Route path="/" component={() => (
        <DetailSidebar op={op()} onLaunch={onLaunch} onClose={onClose} />
      )} />
    </Router>
  ));

  return { ...result, setOp, onLaunch, onClose };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("DetailSidebar preview", () => {
  it("renders an img element for the map preview", () => {
    const { container } = renderSidebar();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("Altis/preview_512.png");
  });

  it("shows SVG fallback when preview image fails to load", async () => {
    const { container } = renderSidebar();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();

    // Simulate image load error
    fireEvent.error(img!);

    await vi.waitFor(() => {
      // Image should be gone, fallback SVGs should appear
      expect(container.querySelector("img")).toBeNull();
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThanOrEqual(2);
      // Check for contour ellipses
      expect(container.querySelector("ellipse")).not.toBeNull();
    });
  });

  it("resets preview when switching to a different map", async () => {
    const { container, setOp } = renderSidebar();
    const img = container.querySelector("img");

    // Fail the preview for Altis
    fireEvent.error(img!);
    await vi.waitFor(() => {
      expect(container.querySelector("img")).toBeNull();
    });

    // Switch to a different map — preview should be attempted again
    setOp({ ...baseOp, id: "2", worldName: "Stratis" });

    await vi.waitFor(() => {
      const newImg = container.querySelector("img");
      expect(newImg).not.toBeNull();
      expect(newImg!.getAttribute("src")).toContain("Stratis/preview_512.png");
    });
  });

  it("restores preview when switching back to a map with preview", async () => {
    const { container, setOp } = renderSidebar();

    // Fail preview for Altis
    fireEvent.error(container.querySelector("img")!);
    await vi.waitFor(() => expect(container.querySelector("img")).toBeNull());

    // Switch to Stratis (which also fails)
    setOp({ ...baseOp, id: "2", worldName: "Stratis" });
    await vi.waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });
    fireEvent.error(container.querySelector("img")!);
    await vi.waitFor(() => expect(container.querySelector("img")).toBeNull());

    // Switch back to Altis — img should be attempted again (reset)
    setOp({ ...baseOp, id: "1", worldName: "Altis" });
    await vi.waitFor(() => {
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toContain("Altis/preview_512.png");
    });
  });

  it("keeps preview when switching between ops on the same map", async () => {
    const { container, setOp } = renderSidebar();
    expect(container.querySelector("img")).not.toBeNull();

    // Switch to a different op on the same map
    setOp({ ...baseOp, id: "2", worldName: "Altis", missionName: "Op Bravo" });

    // img should still be present (same worldName, no reset needed)
    await vi.waitFor(() => {
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toContain("Altis/preview_512.png");
    });
  });
});
