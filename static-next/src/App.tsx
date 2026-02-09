import { onMount, onCleanup, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { WorldConfig } from "./data/types";
import { ApiClient } from "./data/api-client";
import { PlaybackEngine } from "./playback/engine";
import { MockRenderer } from "./renderers/mock-renderer";
import type { MapRenderer } from "./renderers/renderer.interface";
import { EngineProvider } from "./ui/hooks/useEngine";
import { RendererProvider } from "./ui/hooks/useRenderer";
import { MapContainer } from "./ui/components/MapContainer";
import { registerShortcuts, unregisterShortcuts } from "./ui/shortcuts";

/**
 * Parse URL parameters for operation loading and initial view.
 */
function parseUrlParams(): {
  op?: string;
  zoom?: number;
  x?: number;
  y?: number;
} {
  const params = new URLSearchParams(window.location.search);
  const result: { op?: string; zoom?: number; x?: number; y?: number } = {};

  const op = params.get("op");
  if (op) result.op = op;

  const zoom = params.get("zoom");
  if (zoom) {
    const n = Number(zoom);
    if (!Number.isNaN(n)) result.zoom = n;
  }

  const x = params.get("x");
  if (x) {
    const n = Number(x);
    if (!Number.isNaN(n)) result.x = n;
  }

  const y = params.get("y");
  if (y) {
    const n = Number(y);
    if (!Number.isNaN(n)) result.y = n;
  }

  return result;
}

/**
 * Root application component.
 *
 * Wires together the API client, storage backend, playback engine,
 * and renderer. Renders the MapContainer filling the viewport with
 * placeholder panel overlays.
 */
export function App(): JSX.Element {
  const renderer: MapRenderer = new MockRenderer();
  const engine = new PlaybackEngine(renderer);
  const [worldConfig, setWorldConfig] = createSignal<WorldConfig | undefined>(
    undefined,
  );

  onMount(() => {
    // Create API client
    const api = new ApiClient();

    // Register keyboard shortcuts
    registerShortcuts(engine);

    // Parse URL params
    const urlParams = parseUrlParams();

    // If an operation filename is provided, start loading it
    if (urlParams.op) {
      // Load world config for the operation (async, non-blocking)
      // This will be expanded in later tasks when operation loading is wired up
      void (async () => {
        try {
          // Placeholder: actual operation loading will be wired in later tasks
          // For now, just demonstrate that URL params are parsed
          void api;
          void urlParams;
        } catch {
          // Graceful error handling — storage/network failures are not fatal
        }
      })();
    }

    // Create storage backend (async, non-blocking, errors handled gracefully)
    void (async () => {
      try {
        const { createStorage } = await import(
          "./data/storage/storage-factory"
        );
        await createStorage();
      } catch {
        // Storage creation failure is non-fatal (e.g. no OPFS/IndexedDB support)
      }
    })();
  });

  onCleanup(() => {
    unregisterShortcuts();
    engine.dispose();
  });

  return (
    <EngineProvider engine={engine}>
      <RendererProvider renderer={renderer}>
        <MapContainer renderer={renderer} worldConfig={worldConfig()} />
        {/* Placeholder panels — implemented in tasks 17-21 */}
        <div data-testid="left-panel-placeholder" />
        <div data-testid="right-panel-placeholder" />
      </RendererProvider>
    </EngineProvider>
  );
}
