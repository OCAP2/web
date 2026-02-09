import { onMount, onCleanup, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { WorldConfig, Operation } from "./data/types";
import type { MarkerHandle } from "./renderers/renderer.types";
import { ApiClient } from "./data/api-client";
import { JsonDecoder } from "./data/decoders/json-decoder";
import { PlaybackEngine } from "./playback/engine";
import { LeafletRenderer } from "./renderers/leaflet/leaflet-renderer";
import type { MapRenderer } from "./renderers/renderer.interface";
import { EngineProvider } from "./ui/hooks/useEngine";
import { RendererProvider } from "./ui/hooks/useRenderer";
import { MapContainer } from "./ui/components/MapContainer";
import { TopPanel } from "./ui/components/TopPanel";
import { LeftPanel } from "./ui/components/LeftPanel";
import { RightPanel } from "./ui/components/RightPanel";
import { BottomPanel } from "./ui/components/BottomPanel";
import { MissionModal } from "./ui/components/MissionModal";
import { CounterDisplay } from "./ui/components/CounterDisplay";
import { Hint, showHint } from "./ui/components/Hint";
import { hintMessage, hintVisible } from "./ui/components/Hint";
import { registerShortcuts, unregisterShortcuts } from "./ui/shortcuts";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./ui/styles/index.css";
import "./ui/styles/entities.css";

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
 * Wires together the API client, playback engine, and renderer.
 * Renders the MapContainer filling the viewport with panel overlays.
 */
export function App(): JSX.Element {
  const api = new ApiClient();
  const renderer: MapRenderer = new LeafletRenderer();
  const engine = new PlaybackEngine(renderer);
  const [worldConfig, setWorldConfig] = createSignal<WorldConfig | undefined>(
    undefined,
  );
  const [missionName, setMissionName] = createSignal("");
  const [operationId, setOperationId] = createSignal<string | null>(null);
  const [modalOpen, setModalOpen] = createSignal(true);

  /**
   * Load an operation: fetch world config, then fetch + decode mission data,
   * then wire into the playback engine.
   */
  async function loadOperation(op: Operation): Promise<void> {
    try {
      // Determine filename: use op.filename if available, fall back to id-based
      const filename = op.filename ?? `${op.id}.json`;

      // 1. Fetch world config for the map
      const world = await api.getWorldConfig(op.worldName);
      setWorldConfig(world);

      // 2. Fetch the mission data (gzipped JSON from /data/{filename})
      const buffer = await api.getMissionData(filename);

      // 3. Decode the JSON into a manifest (includes entity positions)
      const decoder = new JsonDecoder();
      const manifest = decoder.decodeManifest(buffer);

      // 4. Load into playback engine (no chunk manager needed for JSON format)
      engine.loadOperation(manifest);

      // 5. Update UI state
      setMissionName(op.missionName);
      setOperationId(op.id);
    } catch (err) {
      console.error("Failed to load operation:", err);
      showHint("Failed to load operation");
    }
  }

  // ─── Render bridge: sync engine snapshots → renderer markers ───
  const markerHandles = new Map<number, MarkerHandle>();

  createEffect(() => {
    const snapshots = engine.entitySnapshots();

    // Remove markers for entities no longer in snapshots
    for (const [id, handle] of markerHandles) {
      if (!snapshots.has(id)) {
        renderer.removeEntityMarker(handle);
        markerHandles.delete(id);
      }
    }

    // Create or update markers
    for (const [id, snap] of snapshots) {
      let handle = markerHandles.get(id);
      if (!handle) {
        handle = renderer.createEntityMarker(id, {
          iconType: snap.iconType,
          side: snap.side,
          name: snap.name,
          isPlayer: false,
        });
        markerHandles.set(id, handle);
      }
      renderer.updateEntityMarker(handle, {
        position: snap.position,
        direction: snap.direction,
        alive: snap.alive,
        side: snap.side,
        name: snap.name,
        iconType: snap.iconType,
        isInVehicle: snap.isInVehicle,
      });
    }
  });

  onMount(() => {
    registerShortcuts(engine);

    const urlParams = parseUrlParams();
    if (urlParams.op) {
      // Auto-load operation from URL param
      void (async () => {
        try {
          // Fetch operations list and find the matching one
          const ops = await api.getOperations();
          const match = ops.find(
            (o) => o.filename === urlParams.op || o.id === urlParams.op,
          );
          if (match) {
            setModalOpen(false);
            await loadOperation(match);
          }
        } catch {
          // URL param load failure is non-fatal
        }
      })();
    }
  });

  onCleanup(() => {
    unregisterShortcuts();
    engine.dispose();
    renderer.dispose();
  });

  return (
    <EngineProvider engine={engine}>
      <RendererProvider renderer={renderer}>
        <MapContainer renderer={renderer} worldConfig={worldConfig()} />
        <TopPanel missionName={missionName} operationId={operationId} />
        <LeftPanel />
        <RightPanel />
        <BottomPanel />
        <CounterDisplay />
        <MissionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelectOperation={(op) => {
            setModalOpen(false);
            void loadOperation(op);
          }}
        />
        <Hint message={hintMessage} visible={hintVisible} />
      </RendererProvider>
    </EngineProvider>
  );
}
