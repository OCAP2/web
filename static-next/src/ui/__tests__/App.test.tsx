import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { App } from "../../App";

// Mock storage factory to avoid actual OPFS/IndexedDB access in tests
vi.mock("../../data/storage/storage-factory", () => ({
  createStorage: vi.fn().mockRejectedValue(new Error("not available in test")),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    const { container } = render(() => <App />);
    expect(container).toBeDefined();
  });

  it("renders the map container", () => {
    const { getByTestId } = render(() => <App />);
    expect(getByTestId("map-container")).toBeDefined();
  });

  it("renders placeholder panel divs", () => {
    const { getByTestId } = render(() => <App />);
    expect(getByTestId("left-panel-placeholder")).toBeDefined();
    expect(getByTestId("right-panel-placeholder")).toBeDefined();
  });
});
