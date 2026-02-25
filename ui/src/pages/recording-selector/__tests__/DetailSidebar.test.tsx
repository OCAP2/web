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

interface AdminOpts {
  isAdmin?: boolean;
  onEdit?: ReturnType<typeof vi.fn>;
  onDelete?: ReturnType<typeof vi.fn>;
  onRetry?: ReturnType<typeof vi.fn>;
}

function renderSidebarWithAdmin(initial: Recording = baseRec, admin: AdminOpts = {}) {
  const [rec, setRec] = createSignal(initial);
  const onLaunch = vi.fn();
  const onClose = vi.fn();
  const onEdit = admin.onEdit ?? vi.fn();
  const onDelete = admin.onDelete ?? vi.fn();
  const onRetry = admin.onRetry ?? vi.fn();

  const result = render(() => (
    <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
      <Route path="/" component={() => (
        <DetailSidebar
          rec={rec()}
          onLaunch={onLaunch}
          onClose={onClose}
          isAdmin={admin.isAdmin}
          onEdit={onEdit}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      )} />
    </Router>
  ));

  return { ...result, setRec, onLaunch, onClose, onEdit, onDelete, onRetry };
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

describe("DetailSidebar force composition", () => {
  const recWithSides: Recording = {
    ...baseRec,
    sideComposition: {
      WEST: { units: 40, dead: 10, kills: 15, players: 8 },
      EAST: { units: 35, dead: 20, kills: 12, players: 0 },
      GUER: { units: 10, dead: 2, kills: 3, players: 1 },
      CIV: { units: 5, dead: 0, kills: 0, players: 0 },
    },
  };

  it("renders side cards for each side in sideComposition", () => {
    const { container } = renderSidebarWithAdmin(recWithSides);
    // Should show the section label
    expect(container.textContent).toContain("FORCE COMPOSITION");
    // All four side names should appear
    expect(container.textContent).toContain("WEST");
    expect(container.textContent).toContain("EAST");
    expect(container.textContent).toContain("GUER");
    expect(container.textContent).toContain("CIV");
  });

  it("displays units, alive, dead, kills stats for each side", () => {
    const { container } = renderSidebarWithAdmin(recWithSides);
    // WEST: units=40, alive=30, dead=10, kills=15
    expect(container.textContent).toContain("40");
    expect(container.textContent).toContain("30"); // alive = 40 - 10
    expect(container.textContent).toContain("15"); // kills

    // Check i18n labels
    expect(container.textContent).toContain("TOTAL");
    expect(container.textContent).toContain("ALIVE");
    expect(container.textContent).toContain("DEAD");
    expect(container.textContent).toContain("KILLS");
  });

  it("shows AI only badge when players is 0", () => {
    const { container } = renderSidebarWithAdmin(recWithSides);
    // EAST has 0 players — should show "AI only"
    expect(container.textContent).toContain("AI only");
  });

  it("shows player count badge when players > 0", () => {
    const { container } = renderSidebarWithAdmin(recWithSides);
    // WEST has 8 players
    expect(container.textContent).toContain("8 players");
    // GUER has 1 player (singular)
    expect(container.textContent).toContain("1 player");
  });

  it("does not render force composition when sideComposition is absent", () => {
    const { container } = renderSidebarWithAdmin(baseRec);
    expect(container.textContent).not.toContain("FORCE COMPOSITION");
  });

  it("does not render force composition when sideComposition is empty", () => {
    const rec: Recording = { ...baseRec, sideComposition: {} };
    const { container } = renderSidebarWithAdmin(rec);
    expect(container.textContent).not.toContain("FORCE COMPOSITION");
  });

  it("sorts sides in canonical order (EAST, WEST, GUER, CIV)", () => {
    // Pass sides in non-standard order — component should sort them
    const rec: Recording = {
      ...baseRec,
      sideComposition: {
        CIV: { units: 1, dead: 0, kills: 0, players: 0 },
        WEST: { units: 2, dead: 0, kills: 0, players: 1 },
        EAST: { units: 3, dead: 0, kills: 0, players: 2 },
      },
    };
    const { container } = renderSidebarWithAdmin(rec);
    const text = container.textContent!;
    const eastIdx = text.indexOf("EAST");
    const westIdx = text.indexOf("WEST");
    const civIdx = text.indexOf("CIV");
    expect(eastIdx).toBeLessThan(westIdx);
    expect(westIdx).toBeLessThan(civIdx);
  });
});

describe("DetailSidebar combat summary", () => {
  it("renders kills and kills per minute when killCount > 0", () => {
    const rec: Recording = {
      ...baseRec,
      killCount: 50,
      missionDuration: 600, // 10 minutes
    };
    const { container } = renderSidebarWithAdmin(rec);
    // Total kills
    expect(container.textContent).toContain("50");
    // Kills per minute: 50 / 10 = 5.0
    expect(container.textContent).toContain("5.0");
    // Labels
    expect(container.textContent).toContain("Kills");
    expect(container.textContent).toContain("KILLS/MIN");
  });

  it("renders player kills when playerKillCount > 0", () => {
    const rec: Recording = {
      ...baseRec,
      killCount: 30,
      playerKillCount: 20,
      missionDuration: 300,
    };
    const { container } = renderSidebarWithAdmin(rec);
    expect(container.textContent).toContain("20");
    expect(container.textContent).toContain("PLAYER KILLS");
  });

  it("does not render player kills cell when playerKillCount is 0", () => {
    const rec: Recording = {
      ...baseRec,
      killCount: 10,
      playerKillCount: 0,
      missionDuration: 300,
    };
    const { container } = renderSidebarWithAdmin(rec);
    expect(container.textContent).not.toContain("PLAYER KILLS");
  });

  it("does not render combat summary when killCount is 0", () => {
    const rec: Recording = {
      ...baseRec,
      killCount: 0,
      missionDuration: 300,
    };
    const { container } = renderSidebarWithAdmin(rec);
    expect(container.textContent).not.toContain("KILLS/MIN");
  });

  it("does not render combat summary when killCount is absent", () => {
    const { container } = renderSidebarWithAdmin(baseRec);
    expect(container.textContent).not.toContain("KILLS/MIN");
  });

  it("shows dash for kills per minute when duration is 0", () => {
    const rec: Recording = {
      ...baseRec,
      killCount: 10,
      missionDuration: 0,
    };
    const { container } = renderSidebarWithAdmin(rec);
    // killsPerMin should be "—" when duration is 0
    expect(container.textContent).toContain("\u2014");
  });
});

describe("DetailSidebar admin actions", () => {
  it("does not render admin actions when isAdmin is false", () => {
    const { container } = renderSidebarWithAdmin(baseRec, { isAdmin: false });
    expect(container.textContent).not.toContain("ADMIN ACTIONS");
  });

  it("renders Edit and Delete buttons when isAdmin is true", () => {
    const { container } = renderSidebarWithAdmin(baseRec, { isAdmin: true });
    expect(container.textContent).toContain("ADMIN ACTIONS");
    expect(container.textContent).toContain("Edit");
    expect(container.textContent).toContain("Delete");
  });

  it("calls onEdit with rec when Edit button is clicked", () => {
    const onEdit = vi.fn();
    const { container } = renderSidebarWithAdmin(baseRec, { isAdmin: true, onEdit });
    const buttons = container.querySelectorAll("button");
    const editBtn = Array.from(buttons).find((b) => b.textContent?.includes("Edit"));
    expect(editBtn).toBeDefined();
    fireEvent.click(editBtn!);
    expect(onEdit).toHaveBeenCalledWith(baseRec);
  });

  it("calls onDelete with rec when Delete button is clicked", () => {
    const onDelete = vi.fn();
    const { container } = renderSidebarWithAdmin(baseRec, { isAdmin: true, onDelete });
    const buttons = container.querySelectorAll("button");
    const deleteBtn = Array.from(buttons).find((b) => b.textContent?.includes("Delete"));
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);
    expect(onDelete).toHaveBeenCalledWith(baseRec);
  });

  it("shows Retry button only when conversionStatus is failed", () => {
    const failedRec: Recording = { ...baseRec, conversionStatus: "failed" };
    const { container } = renderSidebarWithAdmin(failedRec, { isAdmin: true });
    expect(container.textContent).toContain("Retry");
  });

  it("does not show Retry button when conversionStatus is not failed", () => {
    const { container } = renderSidebarWithAdmin(baseRec, { isAdmin: true });
    expect(container.textContent).not.toContain("Retry");
  });

  it("calls onRetry with rec id when Retry button is clicked", () => {
    const onRetry = vi.fn();
    const failedRec: Recording = { ...baseRec, conversionStatus: "failed" };
    const { container } = renderSidebarWithAdmin(failedRec, { isAdmin: true, onRetry });
    const buttons = container.querySelectorAll("button");
    const retryBtn = Array.from(buttons).find((b) => b.textContent?.includes("Retry"));
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn!);
    expect(onRetry).toHaveBeenCalledWith("1");
  });
});
