import { onMount, onCleanup, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { WorldConfig, Manifest, Operation } from "./data/types";
import type { MarkerHandle, LineHandle } from "./renderers/renderer.types";
import { SIDE_COLORS_DARK } from "./config/side-colors";
import { ApiClient } from "./data/api-client";
import { JsonDecoder } from "./data/decoders/json-decoder";
import { ProtobufDecoder } from "./data/decoders/protobuf-decoder";
import type { DecoderStrategy } from "./data/decoders/decoder.interface";
import { ChunkManager } from "./data/chunk-manager";
import { PlaybackEngine } from "./playback/engine";
import { MarkerManager } from "./playback/marker-manager";
import { LeafletRenderer } from "./renderers/leaflet/leaflet-renderer";
import type { MapRenderer } from "./renderers/renderer.interface";
import { EngineProvider } from "./ui/hooks/useEngine";
import { RendererProvider } from "./ui/hooks/useRenderer";
import { I18nProvider } from "./ui/hooks/useLocale";
import { MapContainer } from "./ui/components/MapContainer";
import { TopPanel } from "./ui/components/TopPanel";
import { LeftPanel } from "./ui/components/LeftPanel";
import { RightPanel } from "./ui/components/RightPanel";
import { BottomPanel } from "./ui/components/BottomPanel";
import { MissionModal } from "./ui/components/MissionModal";
import { AboutModal } from "./ui/components/AboutModal";
import { CounterDisplay } from "./ui/components/CounterDisplay";
import { Hint, showHint } from "./ui/components/Hint";
import { hintMessage, hintVisible } from "./ui/components/Hint";
import { registerShortcuts, unregisterShortcuts } from "./ui/shortcuts";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./ui/styles/variables.css";
import "./ui/styles/base.css";
import "./ui/styles/global.css";
import "./ui/styles/entities.css";
import "./ui/styles/leaflet.css";
import "./ui/styles/responsive.css";

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
  const markerManager = new MarkerManager(renderer);
  const [worldConfig, setWorldConfig] = createSignal<WorldConfig | undefined>(
    undefined,
  );
  const [missionName, setMissionName] = createSignal("");
  const [operationId, setOperationId] = createSignal<string | null>(null);
  const [operationFilename, setOperationFilename] = createSignal<string | null>(null);
  const [modalOpen, setModalOpen] = createSignal(true);
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [extensionVersion, setExtensionVersion] = createSignal<string | undefined>(undefined);
  const [addonVersion, setAddonVersion] = createSignal<string | undefined>(undefined);

  /**
   * Load an operation: fetch world config, then fetch + decode mission data,
   * then wire into the playback engine.
   */
  async function loadOperation(op: Operation): Promise<void> {
    try {
      // 1. Fetch world config for the map
      const world = await api.getWorldConfig(op.worldName);
      setWorldConfig(world);

      // 2. Choose decoder and fetch data based on storage format
      const filename = op.filename ?? String(op.id);
      let decoder: DecoderStrategy;
      let manifest;

      if (op.storageFormat === "protobuf") {
        decoder = new ProtobufDecoder();

        // Create chunk manager for on-demand chunk loading
        const chunkMgr = new ChunkManager(decoder, api);
        manifest = await chunkMgr.loadManifest(filename);

        // Pre-load chunk 0 so initial frame has position data
        await chunkMgr.loadChunk(0);

        // 3. Load into playback engine with chunk manager
        engine.loadOperation(manifest, chunkMgr);
      } else {
        decoder = new JsonDecoder();
        const buffer = await api.getMissionData(filename);
        manifest = decoder.decodeManifest(buffer);

        // 3. Load into playback engine (JSON has positions embedded)
        engine.loadOperation(manifest);
      }

      // 4. Load briefing markers
      markerManager.loadMarkers(manifest.markers);

      // 5. Update UI state
      setMissionName(op.missionName);
      setOperationId(op.id);
      setOperationFilename(filename);
      setExtensionVersion(manifest.extensionVersion);
      setAddonVersion(manifest.addonVersion);
    } catch (err) {
      console.error("Failed to load operation:", err);
      showHint("Failed to load operation");
    }
  }

  // ─── Render bridge: sync engine snapshots → renderer markers ───
  const markerHandles = new Map<number, MarkerHandle>();
  let firelineHandles: LineHandle[] = [];

  createEffect(() => {
    const snapshots = engine.entitySnapshots();

    // Clear previous frame's fire lines
    for (const handle of firelineHandles) {
      renderer.removeLine(handle);
    }
    firelineHandles = [];

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
          position: snap.position,
          iconType: snap.iconType,
          side: snap.side,
          name: snap.name,
          isPlayer: snap.isPlayer,
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
        isPlayer: snap.isPlayer,
        isInVehicle: snap.isInVehicle,
      });

      // Draw fire line if unit fired this frame
      if (snap.firedTarget) {
        const color = snap.side ? SIDE_COLORS_DARK[snap.side] : "#FFFFFF";
        firelineHandles.push(
          renderer.addLine(snap.position, snap.firedTarget, {
            color,
            weight: 2,
            opacity: 0.4,
          }),
        );
      }
    }
  });

  // ─── Render bridge: sync engine frame → briefing markers ───
  createEffect(() => {
    const frame = engine.currentFrame();
    markerManager.updateFrame(frame);
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
    markerManager.clear();
    engine.dispose();
    renderer.dispose();
  });

  return (
    <I18nProvider>
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <MapContainer renderer={renderer} worldConfig={worldConfig()} />
          <TopPanel missionName={missionName} operationId={operationId} operationFilename={operationFilename} onInfoClick={() => { setModalOpen(false); setAboutOpen(true); }} />
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
          <AboutModal
            open={aboutOpen}
            onClose={() => setAboutOpen(false)}
            extensionVersion={extensionVersion}
            addonVersion={addonVersion}
          />
          <Hint message={hintMessage} visible={hintVisible} />
        </RendererProvider>
      </EngineProvider>
    </I18nProvider>
  );
}
