import { describe, it, expect } from "vitest";
import { render, renderHook } from "@solidjs/testing-library";
import { MockRenderer } from "../../renderers/mockRenderer";
import { RendererProvider, useRenderer } from "../useRenderer";
import type { MapRenderer } from "../../renderers/renderer.interface";

describe("useRenderer", () => {
  it("throws when used outside RendererProvider", () => {
    expect(() => {
      renderHook(() => useRenderer());
    }).toThrow("useRenderer must be used within a RendererProvider");
  });

  it("returns renderer instance when inside RendererProvider", () => {
    const renderer = new MockRenderer();
    const { result } = renderHook(() => useRenderer(), {
      wrapper: (props) => (
        <RendererProvider renderer={renderer}>
          {props.children}
        </RendererProvider>
      ),
    });
    expect(result).toBe(renderer);
  });

  it("RendererProvider passes renderer to children", () => {
    const renderer = new MockRenderer();
    let receivedRenderer: MapRenderer | undefined;

    render(
      () => (
        <RendererProvider renderer={renderer}>
          {(() => {
            receivedRenderer = useRenderer();
            return <div />;
          })()}
        </RendererProvider>
      ),
    );

    expect(receivedRenderer).toBe(renderer);
  });
});
