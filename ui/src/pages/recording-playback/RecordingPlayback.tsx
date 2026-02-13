import { onMount, onCleanup, createSignal, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import type { WorldConfig } from "../../data/types";
import { ApiClient } from "../../data/api-client";
import { PlaybackEngine } from "../../playback/engine";
import { MarkerManager } from "../../playback/marker-manager";
import { formatElapsedTime } from "../../playback/time";
import { LeafletRenderer } from "../../renderers/leaflet/leaflet-renderer";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { EngineProvider } from "../../hooks/useEngine";
import { RendererProvider } from "../../hooks/useRenderer";
import { MapContainer } from "./components/MapContainer";
import { TopBar } from "./components/TopBar";
import { SidePanel } from "./components/SidePanel";
import { BottomBar } from "./components/BottomBar";
import { MapControls } from "./components/MapControls";
import { KeyboardHints } from "./components/KeyboardHints";
import { AboutModal } from "./components/AboutModal";
import { CounterDisplay } from "./components/CounterDisplay";
import { CustomizeLogo } from "./components/CustomizeLogo";
import { Hint, showHint, hintMessage, hintVisible } from "./components/Hint";
import {
  registerShortcuts,
  unregisterShortcuts,
  leftPanelVisible,
  activePanelTab,
  setActivePanelTab,
  setLeftPanelVisible,
} from "./shortcuts";
import { loadOperation } from "./load-operation";
import { useRenderBridge } from "./useRenderBridge";

export function RecordingPlayback(): JSX.Element {
  const params = useParams<{ id: string; name: string }>();
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

  const mapName = createMemo(() => worldConfig()?.worldName ?? "");
  const duration = createMemo(() =>
    formatElapsedTime(engine.endFrame(), engine.captureDelayMs()),
  );

  useRenderBridge(engine, renderer, markerManager);

  onMount(() => {
    registerShortcuts(engine);

    const id = decodeURIComponent(params.id);
    void (async () => {
      let op;
      try {
        op = await api.getOperation(id);
      } catch {
        showHint("Operation not found");
        return;
      }
      try {
        const result = await loadOperation(
          api, engine, markerManager, op,
          (world) => setWorldConfig(world),
        );
        setWorldConfig(result.worldConfig);
        setMissionName(result.missionName);
        setOperationId(result.operationId);
        setOperationFilename(result.operationFilename);
        setExtensionVersion(result.extensionVersion);
        setAddonVersion(result.addonVersion);
      } catch (err) {
        console.error("Failed to load operation:", err);
        showHint("Failed to load operation data");
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
        <TopBar
          missionName={missionName}
          mapName={mapName}
          duration={duration}
          operationId={operationId}
          operationFilename={operationFilename}
          worldConfig={worldConfig}
          onInfoClick={() => setAboutOpen(true)}
          onBack={() => navigate("/")}
        />
        <Show when={leftPanelVisible()}>
          <SidePanel
            activeTab={activePanelTab}
            onTabChange={setActivePanelTab}
          />
        </Show>
        <BottomBar
          panelOpen={leftPanelVisible}
          onTogglePanel={() => setLeftPanelVisible((v) => !v)}
        />
        <MapControls />
        <KeyboardHints />
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
