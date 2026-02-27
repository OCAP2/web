import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { MapContainer } from "../components/MapContainer";
import { MockRenderer } from "../../../renderers/mockRenderer";
import type { WorldConfig } from "../../../data/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapContainer", () => {
  it("renders the container div", () => {
    const renderer = new MockRenderer();

    render(() => <MapContainer renderer={renderer} />);

    expect(screen.getByTestId("map-container")).toBeTruthy();
  });

  it("calls renderer.init when worldConfig is provided", () => {
    const renderer = new MockRenderer();
    const initSpy = vi.spyOn(renderer, "init");
    const worldConfig: WorldConfig = {
      worldName: "Altis",
      worldSize: 30720,
      imageSize: 30720,
      maxZoom: 18,
      minZoom: 10,
    };

    render(() => <MapContainer renderer={renderer} worldConfig={worldConfig} />);

    expect(initSpy).toHaveBeenCalledOnce();
    expect(initSpy.mock.calls[0][1]).toBe(worldConfig);
  });

  it("does not call renderer.init when worldConfig is undefined", () => {
    const renderer = new MockRenderer();
    const initSpy = vi.spyOn(renderer, "init");

    render(() => <MapContainer renderer={renderer} />);

    expect(initSpy).not.toHaveBeenCalled();
  });

  it("registers a window resize listener", () => {
    const renderer = new MockRenderer();
    const addSpy = vi.spyOn(window, "addEventListener");

    render(() => <MapContainer renderer={renderer} />);

    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("removes resize listener on cleanup", () => {
    const renderer = new MockRenderer();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(() => <MapContainer renderer={renderer} />);
    unmount();

    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("dispatches resize event on the container when window resizes", () => {
    const renderer = new MockRenderer();

    render(() => <MapContainer renderer={renderer} />);

    const container = screen.getByTestId("map-container");
    const dispatchSpy = vi.spyOn(container, "dispatchEvent");

    window.dispatchEvent(new Event("resize"));

    expect(dispatchSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy.mock.calls[0][0]).toBeInstanceOf(Event);
  });
});
