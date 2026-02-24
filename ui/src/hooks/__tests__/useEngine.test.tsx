import { describe, it, expect } from "vitest";
import { render, renderHook } from "@solidjs/testing-library";
import { PlaybackEngine } from "../../playback/engine";
import { MockRenderer } from "../../renderers/mockRenderer";
import { EngineProvider, useEngine } from "../useEngine";

function createEngine(): PlaybackEngine {
  return new PlaybackEngine(new MockRenderer());
}

describe("useEngine", () => {
  it("throws when used outside EngineProvider", () => {
    expect(() => {
      renderHook(() => useEngine());
    }).toThrow("useEngine must be used within an EngineProvider");
  });

  it("returns engine instance when inside EngineProvider", () => {
    const engine = createEngine();
    const { result } = renderHook(() => useEngine(), {
      wrapper: (props) => (
        <EngineProvider engine={engine}>{props.children}</EngineProvider>
      ),
    });
    expect(result).toBe(engine);
  });

  it("EngineProvider passes engine to children", () => {
    const engine = createEngine();
    let receivedEngine: PlaybackEngine | undefined;

    render(
      () => (
        <EngineProvider engine={engine}>
          {(() => {
            receivedEngine = useEngine();
            return <div />;
          })()}
        </EngineProvider>
      ),
    );

    expect(receivedEngine).toBe(engine);
  });
});
