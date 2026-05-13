import { createSignal } from "solid-js";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  EventFilters,
  DEFAULT_EVENT_FILTERS,
  type EventFilterState,
} from "../components/EventFilters";
import { I18nProvider } from "../../../hooks/useLocale";

afterEach(() => {
  cleanup();
});

function renderEventFilters(initial?: Partial<EventFilterState>) {
  const [state, setStateSignal] = createSignal<EventFilterState>({
    ...DEFAULT_EVENT_FILTERS,
    ...initial,
  });
  const setState = (updater: (prev: EventFilterState) => EventFilterState) => {
    setStateSignal((prev) => updater(prev));
  };

  const result = render(() => (
    <I18nProvider locale="en">
      <EventFilters state={state} setState={setState} />
    </I18nProvider>
  ));

  return { state, ...result };
}

function openPanel() {
  fireEvent.click(screen.getByLabelText("Event filters"));
}

describe("EventFilters - panel open/close", () => {
  it("panel is closed by default", () => {
    renderEventFilters();
    expect(screen.queryByText("EVENT TYPES")).toBeNull();
    expect(screen.queryByText("SIDE FILTER")).toBeNull();
  });

  it("opens on button click and shows both sections", () => {
    renderEventFilters();
    openPanel();
    expect(screen.getByText("EVENT TYPES")).toBeTruthy();
    expect(screen.getByText("SIDE FILTER")).toBeTruthy();
  });

  it("closes on second button click", () => {
    renderEventFilters();
    openPanel();
    expect(screen.getByText("EVENT TYPES")).toBeTruthy();
    openPanel();
    expect(screen.queryByText("EVENT TYPES")).toBeNull();
  });

  it("renders all six event-type rows", () => {
    renderEventFilters();
    openPanel();
    expect(screen.getByText("Kills")).toBeTruthy();
    expect(screen.getByText("Hits")).toBeTruthy();
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.getByText("Captures")).toBeTruthy();
    expect(screen.getByText("Terminal hacks")).toBeTruthy();
    expect(screen.getByText("Mission events")).toBeTruthy();
  });

  it("renders all three side-filter rows", () => {
    renderEventFilters();
    openPanel();
    expect(screen.getByText("All sides")).toBeTruthy();
    expect(screen.getByText("Friendly fire only")).toBeTruthy();
    expect(screen.getByText("Hide friendly fire")).toBeTruthy();
  });
});

describe("EventFilters - event-type toggles", () => {
  it("toggling an event type updates state", () => {
    const { state } = renderEventFilters();
    openPanel();

    expect(state().showHits).toBe(false);
    fireEvent.click(screen.getByText("Hits"));
    expect(state().showHits).toBe(true);

    fireEvent.click(screen.getByText("Hits"));
    expect(state().showHits).toBe(false);
  });

  it("toggling Kills (default on) turns it off", () => {
    const { state } = renderEventFilters();
    openPanel();

    expect(state().showKills).toBe(true);
    fireEvent.click(screen.getByText("Kills"));
    expect(state().showKills).toBe(false);
  });

  it("toggling one event type does not affect others", () => {
    const { state } = renderEventFilters();
    openPanel();

    fireEvent.click(screen.getByText("Hits"));
    expect(state().showHits).toBe(true);
    expect(state().showKills).toBe(true);
    expect(state().showConnections).toBe(false);
    expect(state().showCaptures).toBe(true);
  });
});

describe("EventFilters - side filter", () => {
  it("selecting a side filter option updates state", () => {
    const { state } = renderEventFilters();
    openPanel();

    expect(state().sideFilter).toBe("all");
    fireEvent.click(screen.getByText("Friendly fire only"));
    expect(state().sideFilter).toBe("friendlyFireOnly");

    fireEvent.click(screen.getByText("Hide friendly fire"));
    expect(state().sideFilter).toBe("hideFriendlyFire");

    fireEvent.click(screen.getByText("All sides"));
    expect(state().sideFilter).toBe("all");
  });

  it("side filter is mutually exclusive with itself", () => {
    const { state } = renderEventFilters();
    openPanel();

    fireEvent.click(screen.getByText("Friendly fire only"));
    fireEvent.click(screen.getByText("Hide friendly fire"));
    // Only the most recent selection wins; this is radio behavior.
    expect(state().sideFilter).toBe("hideFriendlyFire");
  });
});

describe("EventFilters - active indicator", () => {
  it("shows no active dot when state matches defaults", () => {
    const { container } = renderEventFilters();
    // The activeDot has aria-hidden="true"; query via querySelector on the wrapper.
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).toBeNull();
  });

  it("shows an active dot when any event type differs from default", () => {
    const { container } = renderEventFilters({ showHits: true });
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
  });

  it("shows an active dot when side filter differs from default", () => {
    const { container } = renderEventFilters({ sideFilter: "friendlyFireOnly" });
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
  });

  it("hides the active dot while the panel is open", () => {
    const { container } = renderEventFilters({ showHits: true });
    // Dot visible while closed.
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    openPanel();
    // Hidden while open (so users see the panel itself).
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("button has the active style while open AND when filters differ from default", () => {
    // Covers both halves of the `open() || isNonDefault()` branch:
    // 1. open=true, defaults=true (open the panel from default state)
    const { container } = renderEventFilters();
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    // Initially closed + default -> not active style.
    expect(btn?.className).not.toMatch(/_filterBtnActive_/);

    openPanel();
    // open=true contributes -> active style.
    expect(btn?.className).toMatch(/_filterBtnActive_/);

    // Close again, now toggle a filter -> isNonDefault contributes -> active style.
    openPanel();
    expect(btn?.className).not.toMatch(/_filterBtnActive_/);
    openPanel();
    fireEvent.click(screen.getByText("Hits"));
    // Panel still open, both conditions true.
    expect(btn?.className).toMatch(/_filterBtnActive_/);
  });
});
