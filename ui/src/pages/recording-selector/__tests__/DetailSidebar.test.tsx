import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { DetailSidebar } from "../DetailSidebar";
import type { Recording } from "../../../data/types";

const baseRec: Recording = {
  id: "1",
  worldName: "Altis",
  missionName: "Op Alpha",
  missionDuration: 3600,
  date: "2024-01-01",
  tag: "TvT",
};

function renderSidebar(initial: Recording = baseRec) {
  const [rec, setRec] = createSignal(initial);
  const onLaunch = vi.fn();
  const onClose = vi.fn();

  const result = render(() => (
    <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
      <Route path="/" component={() => (
        <DetailSidebar rec={rec()} onLaunch={onLaunch} onClose={onClose} />
      )} />
    </Router>
  ));

  return { ...result, setRec, onLaunch, onClose };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("DetailSidebar preview", () => {
  it("renders an img element for the map preview", () => {
    renderSidebar();
    const img = screen.getByTestId("map-preview");
    expect(img.getAttribute("src")).toContain("Altis/preview_512.png");
  });

  it("shows SVG fallback when preview image fails to load", async () => {
    const { container } = renderSidebar();
    const img = screen.getByTestId("map-preview");

    // Simulate image load error
    fireEvent.error(img);

    await vi.waitFor(() => {
      // Image should be gone, fallback SVGs should appear
      expect(screen.queryByTestId("map-preview")).toBeNull();
      // Check for contour ellipses in fallback SVG
      expect(container.querySelector("ellipse")).not.toBeNull();
    });
  });

  it("resets preview when switching to a different map", async () => {
    const { setRec } = renderSidebar();
    const img = screen.getByTestId("map-preview");

    // Fail the preview for Altis
    fireEvent.error(img);
    await vi.waitFor(() => {
      expect(screen.queryByTestId("map-preview")).toBeNull();
    });

    // Switch to a different map — preview should be attempted again
    setRec({ ...baseRec, id: "2", worldName: "Stratis" });

    await vi.waitFor(() => {
      const newImg = screen.getByTestId("map-preview");
      expect(newImg.getAttribute("src")).toContain("Stratis/preview_512.png");
    });
  });

  it("restores preview when switching back to a map with preview", async () => {
    const { setRec } = renderSidebar();

    // Fail preview for Altis
    fireEvent.error(screen.getByTestId("map-preview"));
    await vi.waitFor(() => expect(screen.queryByTestId("map-preview")).toBeNull());

    // Switch to Stratis (which also fails)
    setRec({ ...baseRec, id: "2", worldName: "Stratis" });
    await vi.waitFor(() => {
      expect(screen.getByTestId("map-preview")).toBeDefined();
    });
    fireEvent.error(screen.getByTestId("map-preview"));
    await vi.waitFor(() => expect(screen.queryByTestId("map-preview")).toBeNull());

    // Switch back to Altis — img should be attempted again (reset)
    setRec({ ...baseRec, id: "1", worldName: "Altis" });
    await vi.waitFor(() => {
      const img = screen.getByTestId("map-preview");
      expect(img.getAttribute("src")).toContain("Altis/preview_512.png");
    });
  });

  it("keeps preview when switching between ops on the same map", async () => {
    const { setRec } = renderSidebar();
    expect(screen.getByTestId("map-preview")).toBeDefined();

    // Switch to a different op on the same map
    setRec({ ...baseRec, id: "2", worldName: "Altis", missionName: "Op Bravo" });

    // img should still be present (same worldName, no reset needed)
    await vi.waitFor(() => {
      const img = screen.getByTestId("map-preview");
      expect(img.getAttribute("src")).toContain("Altis/preview_512.png");
    });
  });
});
