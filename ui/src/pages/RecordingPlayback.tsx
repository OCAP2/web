import { onMount, onCleanup, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import type { WorldConfig, Operation } from "../data/types";
import type { MarkerHandle, LineHandle } from "../renderers/renderer.types";
import { SIDE_COLORS_DARK } from "../config/side-colors";
import { ApiClient } from "../data/api-client";
import { JsonDecoder } from "../data/decoders/json-decoder";
import { ProtobufDecoder } from "../data/decoders/protobuf-decoder";
import type { DecoderStrategy } from "../data/decoders/decoder.interface";
import { ChunkManager } from "../data/chunk-manager";
import { PlaybackEngine } from "../playback/engine";
import { MarkerManager } from "../playback/marker-manager";
import { LeafletRenderer } from "../renderers/leaflet/leaflet-renderer";
import type { MapRenderer } from "../renderers/renderer.interface";
import { EngineProvider } from "../ui/hooks/useEngine";
import { RendererProvider } from "../ui/hooks/useRenderer";
import { MapContainer } from "../ui/components/MapContainer";
import { TopPanel } from "../ui/components/TopPanel";
import { LeftPanel } from "../ui/components/LeftPanel";
import { RightPanel } from "../ui/components/RightPanel";
import { BottomPanel } from "../ui/components/BottomPanel";
import { AboutModal } from "../ui/components/AboutModal";
import { CounterDisplay } from "../ui/components/CounterDisplay";
import { CustomizeLogo } from "../ui/components/CustomizeLogo";
import { Hint, showHint, hintMessage, hintVisible } from "../ui/components/Hint";
import { registerShortcuts, unregisterShortcuts, leftPanelVisible } from "../ui/shortcuts";

/**
 * Playback page at `/recording/:id`.
 *
 * Creates engine + renderer on mount, loads the operation identified
 * by the route param, and disposes everything on unmount.
 */
export function RecordingPlayback(): JSX.Element {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [extensionVersion, setExtensionVersion] = createSignal<string | undefined>(undefined);
  const [addonVersion, setAddonVersion] = createSignal<string | undefined>(undefined);

  async function loadOperation(op: Operation): Promise<void> {
    try {
      const world = await api.getWorldConfig(op.worldName);
      setWorldConfig(world);

      const filename = op.filename ?? String(op.id);
      let decoder: DecoderStrategy;
      let manifest;

      if (op.storageFormat === "protobuf") {
        decoder = new ProtobufDecoder();
        const chunkMgr = new ChunkManager(decoder, api);
        manifest = await chunkMgr.loadManifest(filename);
        await chunkMgr.loadChunk(0);
        engine.loadOperation(manifest, chunkMgr);
      } else {
        decoder = new JsonDecoder();
        const buffer = await api.getMissionData(filename);
        manifest = decoder.decodeManifest(buffer);
        engine.loadOperation(manifest);
      }

      markerManager.loadMarkers(manifest.markers);
      setMissionName(op.missionName);
      setOperationId(op.id);
      setOperationFilename(filename);
      setExtensionVersion(manifest.extensionVersion);
      setAddonVersion(manifest.addonVersion);
    } catch (err) {
      console.error("Failed to load operation:", err);
      showHint("Failed to load operation");
      throw err;
    }
  }

  // ─── Render bridge: sync engine snapshots → renderer markers ───
  const markerHandles = new Map<number, MarkerHandle>();
  let firelineHandles: LineHandle[] = [];

  createEffect(() => {
    const snapshots = engine.entitySnapshots();

    for (const handle of firelineHandles) {
      renderer.removeLine(handle);
    }
    firelineHandles = [];

    for (const [id, handle] of markerHandles) {
      if (!snapshots.has(id)) {
        renderer.removeEntityMarker(handle);
        markerHandles.delete(id);
      }
    }

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

  // Sync left panel visibility to CSS custom property
  createEffect(() => {
    const offset = leftPanelVisible()
      ? "calc(var(--left-panel-width) + 10px)"
      : "10px";
    document.documentElement.style.setProperty("--leaflet-left-offset", offset);
  });

  onMount(() => {
    registerShortcuts(engine);

    const id = decodeURIComponent(params.id);
    void (async () => {
      try {
        const op = await api.getOperation(id);
        await loadOperation(op);
      } catch {
        showHint("Operation not found");
      }
    })();
  });

  onCleanup(() => {
    unregisterShortcuts();
    markerManager.clear();
    engine.dispose();
    renderer.dispose();
  });

  return (
    <EngineProvider engine={engine}>
      <RendererProvider renderer={renderer}>
        <MapContainer renderer={renderer} worldConfig={worldConfig()} />
        <TopPanel
          missionName={missionName}
          operationId={operationId}
          operationFilename={operationFilename}
          onInfoClick={() => setAboutOpen(true)}
          onBack={() => navigate("/")}
        />
        <LeftPanel />
        <RightPanel />
        <BottomPanel />
        <CustomizeLogo />
        <CounterDisplay />
        <AboutModal
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          extensionVersion={extensionVersion}
          addonVersion={addonVersion}
        />
        <Hint message={hintMessage} visible={hintVisible} />
      </RendererProvider>
    </EngineProvider>
  );
}
