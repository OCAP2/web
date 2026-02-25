import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { RecordingRow } from "../RecordingRow";
import type { Recording } from "../../../data/types";

const baseRec: Recording = {
  id: "rec-1",
  worldName: "Altis",
  missionName: "Op Alpha",
  missionDuration: 3600,
  date: "2024-01-01",
  tag: "TvT",
};

function renderRow(
  rec: Recording = baseRec,
  opts: {
    selected?: boolean;
    showPlayers?: boolean;
    showKills?: boolean;
    gridColumns?: string;
  } = {},
) {
  const onSelect = vi.fn();
  const onLaunch = vi.fn();

  const result = render(() => (
    <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
      <Route path="/" component={() => (
        <RecordingRow
          rec={rec}
          selected={opts.selected ?? false}
          onSelect={onSelect}
          onLaunch={onLaunch}
          index={0}
          showPlayers={opts.showPlayers}
          showKills={opts.showKills}
          gridColumns={opts.gridColumns}
        />
      )} />
    </Router>
  ));

  return { ...result, onSelect, onLaunch };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RecordingRow basic rendering", () => {
  it("renders the mission name and world name", () => {
    renderRow();
    const row = screen.getByTestId("recording-rec-1");
    expect(row.textContent).toContain("Op Alpha");
    expect(row.textContent).toContain("Altis");
  });

  it("renders duration", () => {
    renderRow();
    const row = screen.getByTestId("recording-rec-1");
    expect(row.textContent).toContain("1h 0m 0s");
  });

  it("renders tag badge when tag is present", () => {
    renderRow();
    const row = screen.getByTestId("recording-rec-1");
    expect(row.textContent).toContain("TvT");
  });

  it("calls onSelect when row is clicked", () => {
    const { onSelect } = renderRow();
    const row = screen.getByTestId("recording-rec-1");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("rec-1");
  });

  it("shows play button when selected and ready", () => {
    const { container } = renderRow(baseRec, { selected: true });
    // baseRec has no conversionStatus, so it's "ready"
    const playBtn = container.querySelector("button");
    expect(playBtn).not.toBeNull();
  });

  it("calls onLaunch when play button is clicked", () => {
    const { container, onLaunch } = renderRow(baseRec, { selected: true });
    const buttons = container.querySelectorAll("button");
    // Find the play button — it contains an SVG with the play icon path
    const playBtn = Array.from(buttons).find((b) =>
      b.querySelector('path[d="M8 5v14l11-7z"]')
    );
    expect(playBtn).toBeDefined();
    fireEvent.click(playBtn!);
    expect(onLaunch).toHaveBeenCalledWith(baseRec);
  });

  it("does not show play button when not selected", () => {
    const { container } = renderRow(baseRec, { selected: false });
    // The row itself has buttons (TagBadge is a button), but no play button
    // The play button is inside .rowPlay and only rendered when selected+ready
    const row = screen.getByTestId("recording-rec-1");
    // The play button svg has a specific path, check for absence of the Play icon container
    const buttons = container.querySelectorAll("button");
    const playBtns = Array.from(buttons).filter((b) => {
      // Play button has an svg with a polygon path "M8 5v14l11-7z"
      return b.querySelector('path[d="M8 5v14l11-7z"]');
    });
    expect(playBtns.length).toBe(0);
  });

  it("applies custom gridColumns style", () => {
    renderRow(baseRec, { gridColumns: "1fr 1fr" });
    const row = screen.getByTestId("recording-rec-1");
    expect(row.style.gridTemplateColumns).toBe("1fr 1fr");
  });
});

describe("RecordingRow players column", () => {
  it("renders player count when showPlayers is true and playerCount > 0", () => {
    const rec: Recording = { ...baseRec, playerCount: 12 };
    const { container } = renderRow(rec, { showPlayers: true });
    expect(container.textContent).toContain("12");
  });

  it("renders dash when showPlayers is true and playerCount is 0", () => {
    const rec: Recording = { ...baseRec, playerCount: 0 };
    const { container } = renderRow(rec, { showPlayers: true });
    expect(container.textContent).toContain("\u2014");
  });

  it("renders dash when showPlayers is true and playerCount is absent", () => {
    const { container } = renderRow(baseRec, { showPlayers: true });
    expect(container.textContent).toContain("\u2014");
  });

  it("does not render players column when showPlayers is false", () => {
    const rec: Recording = { ...baseRec, playerCount: 12 };
    const { container } = renderRow(rec, { showPlayers: false });
    // The "12" from playerCount should not appear (it's not part of duration/date)
    // Duration is "1h 0m 0s", date format varies, so check for the Users icon SVG
    const usersIcons = container.querySelectorAll('svg path[d*="M17 21v-2"]');
    // Users icon appears in stats grid but not when showPlayers is false
    expect(usersIcons.length).toBe(0);
  });
});

describe("RecordingRow kills column", () => {
  it("renders kill count when showKills is true and killCount > 0", () => {
    const rec: Recording = { ...baseRec, killCount: 25 };
    const { container } = renderRow(rec, { showKills: true });
    expect(container.textContent).toContain("25");
  });

  it("renders dash when showKills is true and killCount is 0", () => {
    const rec: Recording = { ...baseRec, killCount: 0 };
    const { container } = renderRow(rec, { showKills: true });
    // Should contain a dash character
    expect(container.textContent).toContain("\u2014");
  });

  it("renders dash when showKills is true and killCount is absent", () => {
    const { container } = renderRow(baseRec, { showKills: true });
    expect(container.textContent).toContain("\u2014");
  });

  it("does not render kills column when showKills is false", () => {
    const rec: Recording = { ...baseRec, killCount: 25 };
    const { container } = renderRow(rec, { showKills: false });
    // Crosshair icon should not be present
    const crosshairCircles = container.querySelectorAll('svg circle[r="10"]');
    // The Globe icon also has circles but the Crosshair one is specific
    // Just verify 25 is not in text (it's not part of other fields)
    // Duration is 3600 = "1h 0m 0s", date is "1 Jan 2024" or similar
    expect(container.textContent).not.toContain("25");
  });
});

describe("RecordingRow status", () => {
  it("does not show play button for a non-ready recording", () => {
    const rec: Recording = { ...baseRec, conversionStatus: "converting" };
    const { container } = renderRow(rec, { selected: true });
    const buttons = container.querySelectorAll("button");
    const playBtns = Array.from(buttons).filter((b) => {
      return b.querySelector('path[d="M8 5v14l11-7z"]');
    });
    expect(playBtns.length).toBe(0);
  });
});
