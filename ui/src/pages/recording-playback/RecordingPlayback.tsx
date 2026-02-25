import { onMount, onCleanup, createSignal, createMemo, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useParams, useNavigate, useLocation } from "@solidjs/router";
import type { WorldConfig } from "../../data/types";
import { ApiClient } from "../../data/apiClient";
import { useAuth } from "../../hooks/useAuth";
import { PlaybackEngine } from "../../playback/engine";
import { MarkerManager } from "../../playback/markerManager";
import { formatElapsedTime } from "../../playback/time";
import { LeafletRenderer } from "../../renderers/leaflet/leafletRenderer";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { EngineProvider } from "../../hooks/useEngine";
import { RendererProvider } from "../../hooks/useRenderer";
import { useI18n } from "../../hooks/useLocale";
import { OcapLogoSvg } from "../recording-selector/OcapLogoSvg";
import { formatDuration } from "../recording-selector/helpers";
import loadingStyles from "../LoadingTransition.module.css";
import { MapContainer } from "./components/MapContainer";
import { TopBar } from "./components/TopBar";
import { SidePanel } from "./components/SidePanel";
import { BottomBar } from "./components/BottomBar";
import { MapControls } from "./components/MapControls";
import { AboutModal } from "./components/AboutModal";
import { CounterDisplay } from "./components/CounterDisplay";
import { FollowIndicator } from "./components/FollowIndicator";
import { Hint, showHint, hintMessage, hintVisible } from "./components/Hint";
import { BlacklistIndicator } from "./components/BlacklistIndicator";
import {
  registerShortcuts,
  unregisterShortcuts,
  leftPanelVisible,
  activePanelTab,
  setActivePanelTab,
  setLeftPanelVisible,
} from "./shortcuts";
import { loadRecording } from "./loadRecording";
import { useRenderBridge } from "./useRenderBridge";

interface LocationState {
  missionName?: string;
  worldName?: string;
  missionDuration?: number;
}

export function RecordingPlayback(): JSX.Element {
  const params = useParams<{ id: string; name: string }>();
  const navigate = useNavigate();
  const location = useLocation<LocationState>();
  const { t } = useI18n();
  const { authenticated } = useAuth();
  const api = new ApiClient();
  const renderer: MapRenderer = new LeafletRenderer();
  const engine = new PlaybackEngine(renderer);
  const markerManager = new MarkerManager(renderer);
  const [worldConfig, setWorldConfig] = createSignal<WorldConfig | undefined>(
    undefined,
  );
  const [missionName, setMissionName] = createSignal("");
  const [recordingId, setRecordingId] = createSignal<string | null>(null);
  const [recordingFilename, setRecordingFilename] = createSignal<string | null>(null);
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [extensionVersion, setExtensionVersion] = createSignal<string | undefined>(undefined);
  const [addonVersion, setAddonVersion] = createSignal<string | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);
  const [blacklist, setBlacklist] = createSignal<Set<number>>(new Set());
  const [markerCounts, setMarkerCounts] = createSignal<Map<number, number>>(new Map());

  const locState = () => location.state as LocationState | undefined;

  const mapName = createMemo(() => worldConfig()?.worldName ?? "");
  const duration = createMemo(() =>
    formatElapsedTime(engine.endFrame(), engine.captureDelayMs()),
  );

  const toggleBlacklist = async (playerEntityId: number) => {
    const rid = recordingId();
    if (!rid) return;

    const current = blacklist();
    const isBlacklisted = current.has(playerEntityId);

    try {
      if (isBlacklisted) {
        await api.removeMarkerBlacklist(rid, playerEntityId);
      } else {
        await api.addMarkerBlacklist(rid, playerEntityId);
      }

      const next = new Set(current);
      if (isBlacklisted) {
        next.delete(playerEntityId);
      } else {
        next.add(playerEntityId);
      }
      setBlacklist(next);
      markerManager.setBlacklist(next);
    } catch {
      // API call failed — leave state unchanged
    }
  };

  useRenderBridge(engine, renderer, markerManager);

  onMount(() => {
    registerShortcuts(engine);

    const id = decodeURIComponent(params.id);
    void (async () => {
      let rec;
      try {
        rec = await api.getRecording(id);
      } catch {
        showHint(t("recording_not_found"));
        setLoading(false);
        return;
      }
      try {
        const result = await loadRecording(
          api, engine, markerManager, rec,
          (world) => setWorldConfig(world),
        );
        setWorldConfig(result.worldConfig);
        setMissionName(result.missionName);
        setRecordingId(result.recordingId);
        setRecordingFilename(result.recordingFilename);
        setExtensionVersion(result.extensionVersion);
        setAddonVersion(result.addonVersion);

        // Fetch marker blacklist (non-fatal)
        try {
          const ids = await api.getMarkerBlacklist(result.recordingId);
          const blSet = new Set(ids);
          setBlacklist(blSet);
          markerManager.setBlacklist(blSet);
          setMarkerCounts(markerManager.getMarkerCountsByPlayer());
        } catch {
          // Blacklist unavailable — not critical
        }
      } catch (err) {
        console.error("Failed to load recording:", err);
        showHint(t("load_failed"));
      } finally {
        setLoading(false);
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
          recordingId={recordingId}
          recordingFilename={recordingFilename}
          worldConfig={worldConfig}
          onInfoClick={() => setAboutOpen(true)}
          onBack={() => navigate("/")}
        />
        <Show when={leftPanelVisible()}>
          <SidePanel
            activeTab={activePanelTab}
            onTabChange={setActivePanelTab}
            blacklist={blacklist}
            markerCounts={markerCounts}
            isAdmin={authenticated}
            onToggleBlacklist={toggleBlacklist}
          />
        </Show>
        <BottomBar
          panelOpen={leftPanelVisible}
          onTogglePanel={() => setLeftPanelVisible((v) => !v)}
        />
        <MapControls />
        <CounterDisplay />
        <AboutModal
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          extensionVersion={extensionVersion}
          addonVersion={addonVersion}
        />
        <FollowIndicator />
        <Show when={authenticated() && blacklist().size > 0}>
          <BlacklistIndicator
            blacklist={blacklist}
            markerCounts={markerCounts}
          />
        </Show>
        <Hint message={hintMessage} visible={hintVisible} />
        <div
          class={loadingStyles.loadingScreen}
          data-testid="loading-screen"
          style={{
            opacity: loading() ? 1 : 0,
            "pointer-events": loading() ? "auto" : "none",
          }}
        >
          <div class={loadingStyles.loadingContent}>
            <div class={loadingStyles.loadingLogo}>
              <OcapLogoSvg size={56} />
            </div>
            <div class={loadingStyles.loadingTitle}>
              {t("loading_mission")} {locState()?.missionName ?? ""}
            </div>
            <div class={loadingStyles.loadingSubtitle}>
              {locState()?.worldName ?? ""} &middot; {formatDuration(locState()?.missionDuration ?? 0)}
            </div>
            <div class={loadingStyles.loadingBarTrack}>
              <div class={loadingStyles.loadingBarFill} />
            </div>
            <div class={loadingStyles.loadingHint}>{t("initializing_engine")}</div>
          </div>
        </div>
      </RendererProvider>
    </EngineProvider>
  );
}
