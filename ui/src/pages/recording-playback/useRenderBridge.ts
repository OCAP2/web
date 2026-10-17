import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  MarkerHandle,
  LineHandle,
  CrewInfo,
  BriefingMarkerHandle,
} from "../../renderers/renderer.types";
import { SIDE_COLORS_BRIGHT, SIDE_COLORS_DARK } from "../../config/sideColors";
import type { PlaybackEngine } from "../../playback/engine";
import type { MarkerManager } from "../../playback/markerManager";
import { Vehicle } from "../../playback/entities/vehicle";
import { Unit } from "../../playback/entities/unit";
import { HitKilledEvent } from "../../playback/events/hitKilledEvent";
import {
  groupZeusPings,
  groupZeusModules,
  zeusPingAlpha,
  zeusPingLifetimeFrames,
  zeusModuleAlpha,
  zeusModuleFadeFrames,
  zeusModuleLifetimeFrames,
  type ZeusPingGroup,
  type ZeusModuleGroup,
} from "../../playback/zeus";
import {
  explosionAlpha,
  explosionColor,
  explosionLifetimeFrames,
} from "../../playback/explosions";
import {
  binDeathSites,
  buildDeathSites,
  busiestCell,
  deathBlobAlpha,
  deathBlobRadius,
  type DeathSite,
} from "../../playback/deathHeatmap";
import {
  fallbackRange,
  matchTransmissionRadio,
  pairTransmissions,
  reachability,
  transmissionsAtFrame,
} from "../../playback/comms";
import { loadWorldDem, type DemGrid } from "../../playback/radioRange/demGrid";
import type { RadioSnapshot } from "../../data/types";
import { formatTime, type TimeMode } from "../../playback/time";
import type { Side } from "../../data/types";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { leftPanelVisible, activeSide } from "./shortcuts";
import {
  DEATH_HEATMAP_CELL_M,
  TRAIL_SAMPLES,
  TRAIL_SECONDS,
  deathHeatmapVisible,
  trailMode,
} from "./viewOptions";

/**
 * Build structured crew info for a vehicle.
 * The renderer decides how to format this for display.
 */
function getCrewInfo(
  vehicle: Vehicle,
  entityManager: PlaybackEngine["entityManager"],
): CrewInfo {
  const names: string[] = [];
  for (const id of vehicle.crew) {
    const member = entityManager.getEntity(id);
    if (member instanceof Unit && member.isPlayer) {
      names.push(member.name || `Unit ${id}`);
    }
  }
  return { count: vehicle.crew.length, names };
}

/** The label is interpolated into a divIcon's HTML, and `name` comes from the game. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marker colour for a ping, as the bare hex the marker image route expects. */
function pingColor(side: string): string {
  const color = SIDE_COLORS_BRIGHT[side as Side] ?? "#ffcc00";
  return color.replace("#", "");
}

/**
 * The text drawn beside a ping icon: one `[Zeus ping] - Name - Time` line per
 * ping, newest first, so repeat pings from the same player are distinguishable
 * at a glance. The name is always shown so a ping is attributable on its own.
 */
function pingLabel(
  group: ZeusPingGroup,
  format: (frame: number) => string,
): string {
  const name = escapeHtml(group.name || `Unit ${group.unitId}`);
  return group.frames
    .map((frame) => `[Zeus ping] - ${name} - ${escapeHtml(format(frame))}`)
    .join("<br>");
}

function moduleColor(): string {
  const color = SIDE_COLORS_BRIGHT.VIRTUAL ?? "#9b59b6";
  return color.replace("#", "");
}

/**
 * Text beside a module icon. The display name is the English string recorded
 * in the event — do not translate it.
 */
function moduleLabel(
  group: ZeusModuleGroup,
  format: (frame: number) => string,
): string {
  const zeus = escapeHtml(group.curatorName || `Zeus ${group.curatorId}`);
  const moduleName = escapeHtml(group.displayName);
  const target = group.attachedName ? ` - ${escapeHtml(group.attachedName)}` : "";
  return group.frames
    .map((frame) => `[Zeus module] - ${zeus} - ${moduleName}${target} - ${escapeHtml(format(frame))}`)
    .join("<br>");
}

interface PingRender {
  icon: BriefingMarkerHandle;
  label: BriefingMarkerHandle;
  labelText: string;
}

interface BlastRender {
  circle: BriefingMarkerHandle;
  position: [number, number];
  frameNum: number;
}

/**
 * Syncs engine snapshots to renderer markers, updates briefing markers
 * per frame, and keeps the CSS left-offset in sync with panel visibility.
 */
export function useRenderBridge(
  engine: PlaybackEngine,
  renderer: MapRenderer,
  markerManager: MarkerManager,
  timeMode: Accessor<TimeMode> = () => "elapsed",
): void {
  const markerHandles = new Map<number, MarkerHandle>();
  let firelineHandles: LineHandle[] = [];

  // Entity snapshot → marker sync
  createEffect(() => {
    const snapshots = engine.entitySnapshots();
    const frame = engine.currentFrame();

    // Build set of entities hit on this exact frame.
    // The canvas layer handles the visual duration (wall-clock fade-out).
    const hitEntityIds = new Set<number>();
    for (const ev of engine.eventManager.getEventsAtFrame(frame)) {
      if (ev instanceof HitKilledEvent && ev.type === "hit") {
        hitEntityIds.add(ev.victimId);
      }
    }

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
      let isPlayer = snap.isPlayer;
      let crew: CrewInfo | undefined;
      const entity = engine.entityManager.getEntity(id);
      if (entity instanceof Vehicle) {
        crew = getCrewInfo(entity, engine.entityManager);
        // In "players" mode, show vehicle popup if any crew member is a player
        isPlayer = crew.names.length > 0;
      }

      let handle = markerHandles.get(id);
      if (!handle) {
        handle = renderer.createEntityMarker(id, {
          position: snap.position,
          direction: snap.direction,
          iconType: snap.iconType,
          side: snap.side,
          name: snap.name,
          isPlayer,
          crew,
          fov: snap.fov,
          pitch: snap.pitch,
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
        isPlayer,
        isInVehicle: snap.isInVehicle,
        hit: hitEntityIds.has(id),
        crew,
        fov: snap.fov,
        pitch: snap.pitch,
      });

      if (snap.firedTargets) {
        const color = snap.side ? SIDE_COLORS_DARK[snap.side] : "#FFFFFF";
        for (const target of snap.firedTargets) {
          firelineHandles.push(
            renderer.addLine(snap.position, target, {
              color,
              weight: 2,
              opacity: 0.4,
            }),
          );
        }
      }
    }
  });

  // Zeus pings → transient map overlay.
  // A ping is drawn for ZEUS_PING_MAP_SECONDS of playback time and then removed
  // from the map; the event itself stays in the event log forever. Recomputing
  // the active set from the frame means scrubbing backwards works for free.
  const pingRenders = new Map<string, PingRender>();

  createEffect(() => {
    const frame = engine.currentFrame();
    const mode = timeMode();
    const lifetime = zeusPingLifetimeFrames(engine.captureDelayMs());
    const groups = groupZeusPings(
      engine.eventManager.getActivePings(frame, lifetime),
    );

    const config = engine.timeConfig;
    const format = (f: number) => formatTime(f, mode, config);

    const live = new Set<string>();

    for (const group of groups) {
      live.add(group.key);
      const labelText = pingLabel(group, format);
      const color = pingColor(group.side);

      let render = pingRenders.get(group.key);
      if (render && render.labelText !== labelText) {
        // The label is baked into the divIcon at creation, so a changed line
        // count (a second ping, or a different clock) needs a fresh marker.
        renderer.removeBriefingMarker(render.label);
        render.label = renderer.createBriefingMarker({
          shape: "ICON",
          type: "Empty",
          color,
          text: labelText,
          side: "GLOBAL",
          layer: "systemMarkers",
          textClass: "zeus-ping-label",
        });
        render.labelText = labelText;
      }

      if (!render) {
        render = {
          icon: renderer.createBriefingMarker({
            shape: "ICON",
            type: "zeus",
            color,
            side: "GLOBAL",
            layer: "systemMarkers",
          }),
          label: renderer.createBriefingMarker({
            shape: "ICON",
            type: "Empty",
            color,
            text: labelText,
            side: "GLOBAL",
            layer: "systemMarkers",
            textClass: "zeus-ping-label",
          }),
          labelText,
        };
        pingRenders.set(group.key, render);
      }

      const alpha = zeusPingAlpha(frame, group.latestFrame, lifetime);
      const state = { position: group.position, direction: 0, alpha };
      renderer.updateBriefingMarker(render.icon, state);
      renderer.updateBriefingMarker(render.label, state);
    }

    for (const [key, render] of pingRenders) {
      if (live.has(key)) continue;
      renderer.removeBriefingMarker(render.icon);
      renderer.removeBriefingMarker(render.label);
      pingRenders.delete(key);
    }
  });

  // Zeus modules → transient map overlay, same pattern as pings but 30 s.
  const moduleRenders = new Map<string, PingRender>();

  createEffect(() => {
    const frame = engine.currentFrame();
    const mode = timeMode();
    const delay = engine.captureDelayMs();
    const lifetime = zeusModuleLifetimeFrames(delay);
    const fade = zeusModuleFadeFrames(delay);
    const groups = groupZeusModules(
      engine.eventManager.getActiveZeusModules(frame, lifetime),
    );

    const config = engine.timeConfig;
    const format = (f: number) => formatTime(f, mode, config);

    const live = new Set<string>();

    for (const group of groups) {
      live.add(group.key);
      const labelText = moduleLabel(group, format);
      const color = moduleColor();

      let render = moduleRenders.get(group.key);
      if (render && render.labelText !== labelText) {
        renderer.removeBriefingMarker(render.label);
        render.label = renderer.createBriefingMarker({
          shape: "ICON",
          type: "Empty",
          color,
          text: labelText,
          side: "GLOBAL",
          layer: "systemMarkers",
          textClass: "zeus-module-label",
        });
        render.labelText = labelText;
      }

      if (!render) {
        render = {
          icon: renderer.createBriefingMarker({
            shape: "ICON",
            type: "zeus",
            color,
            side: "GLOBAL",
            layer: "systemMarkers",
          }),
          label: renderer.createBriefingMarker({
            shape: "ICON",
            type: "Empty",
            color,
            text: labelText,
            side: "GLOBAL",
            layer: "systemMarkers",
            textClass: "zeus-module-label",
          }),
          labelText,
        };
        moduleRenders.set(group.key, render);
      }

      const alpha = zeusModuleAlpha(frame, group.latestFrame, lifetime, fade);
      const state = { position: group.position, direction: 0, alpha };
      renderer.updateBriefingMarker(render.icon, state);
      renderer.updateBriefingMarker(render.label, state);
    }

    for (const [key, render] of moduleRenders) {
      if (live.has(key)) continue;
      renderer.removeBriefingMarker(render.icon);
      renderer.removeBriefingMarker(render.label);
      moduleRenders.delete(key);
    }
  });

  // Explosions → transient blast circles.
  // The circle is the ammo's own indirectHitRange, so it shows the area the
  // blast could actually damage. Recomputing the active set from the frame keeps
  // scrubbing backwards working, exactly as it does for pings.
  const blastRenders = new Map<number, BlastRender>();

  createEffect(() => {
    const frame = engine.currentFrame();
    const lifetime = explosionLifetimeFrames(engine.captureDelayMs());
    const blasts = engine.eventManager.getActiveExplosions(frame, lifetime);

    const live = new Set<number>();

    for (const blast of blasts) {
      live.add(blast.id);

      let render = blastRenders.get(blast.id);
      if (!render) {
        render = {
          circle: renderer.createBriefingMarker({
            shape: "ELLIPSE",
            type: "Empty",
            color: explosionColor(blast.radius),
            side: "GLOBAL",
            size: [blast.radius, blast.radius],
            brush: "Solid",
            layer: "systemMarkers",
          }),
          position: blast.position,
          frameNum: blast.frameNum,
        };
        blastRenders.set(blast.id, render);
      }

      renderer.updateBriefingMarker(render.circle, {
        position: render.position,
        direction: 0,
        alpha: explosionAlpha(frame, render.frameNum, lifetime),
      });
    }

    for (const [id, render] of blastRenders) {
      if (live.has(id)) continue;
      renderer.removeBriefingMarker(render.circle);
      blastRenders.delete(id);
    }
  });

  // Live transmissions → who could hear them.
  //
  // A line is drawn from the speaker to every unit tuned to that net: solid
  // where the signal reaches, dashed and red where terrain or distance breaks
  // it. That turns "was the net split" into something visible at the frame the
  // contact report went out, rather than a claim in a table.
  //
  // Reachability is evaluated at the playhead against the terrain model the
  // coverage overlay already uses, so the two always agree.
  let commsLines: LineHandle[] = [];

  // loadWorldDem is cached per world, so asking for it here costs nothing when
  // the comms tab or a profile card has already pulled it.
  const [commsDem, setCommsDem] = createSignal<DemGrid | null>(null);
  createEffect(() => {
    const world = engine.worldConfig;
    setCommsDem(null);
    if (!world) return;
    let active = true;
    onCleanup(() => { active = false; });
    void loadWorldDem({
      tileBaseUrl: world.tileBaseUrl,
      worldName: world.worldName,
      worldSize: world.worldSize,
      hasDem: world.hasDem,
      hasHeightmap: world.hasHeightmap,
    }).then((grid) => {
      if (active) setCommsDem(grid ?? null);
    }).catch((error) => console.error("Failed to load transmission terrain", error));
  });

  // Pairing folds every Start/Stop in the recording into spans. That depends on
  // the recording, not on the playhead, so it is computed once per recording
  // rather than rebuilt on each of the sixty frames a second the effect below
  // runs at. The recording version also changes for missions of equal length.
  const pairedTransmissions = createMemo(() => {
    engine.recordingVersion();
    return pairTransmissions(
      engine.eventManager.getRadioTransmissions().map((event) => ({
        frameNum: event.frameNum,
        payload: event.payload,
      })),
    );
  });

  const liveTransmissions = createMemo(() =>
    transmissionsAtFrame(pairedTransmissions(), engine.currentFrame()),
  );
  const hasLiveTransmission = createMemo(() => liveTransmissions().length > 0);
  createEffect(() => {
    engine.recordingVersion();
    if (!hasLiveTransmission()) return;
    // Receiver membership needs every player's radios. Share the engine's
    // deduplicated sidecar loads with panels, without waiting for a panel visit.
    void engine.ensureAllPlayerSnapshots();
  });

  createEffect(() => {
    const frame = engine.currentFrame();
    const snapshots = engine.entitySnapshots();

    for (const handle of commsLines) renderer.removeLine(handle);
    commsLines = [];

    const live = liveTransmissions();
    if (live.length === 0) return;
    engine.playerSnapshotsVersion();

    // Radios for everyone with a snapshot at this frame, so net membership can
    // be resolved again as the overlay's own sidecar requests finish.
    const radiosByUnit = new Map<number, RadioSnapshot>();
    for (const unitId of engine.eventManager.getPlayerSnapshotUnitIds()) {
      const snapshot = engine.eventManager.getPlayerSnapshots(unitId, frame).get("radioSnapshot");
      const payload = snapshot?.payload as RadioSnapshot | undefined;
      if (payload?.radios?.length) radiosByUnit.set(unitId, payload);
    }

    for (const tx of live) {
      const origin = snapshots.get(tx.unitId)?.position;
      if (!origin) continue;

      const speakerRadios = radiosByUnit.get(tx.unitId)?.radios ?? [];
      const radio = matchTransmissionRadio(speakerRadios, tx);

      const peers: Parameters<typeof reachability>[0]["peers"] = [];
      for (const [unitId, snapshot] of radiosByUnit) {
        if (unitId === tx.unitId) continue;
        if (!snapshot.radios.some((entry) => matchTransmissionRadio([entry], tx))) continue;
        const position = snapshots.get(unitId)?.position;
        if (!position) continue;
        peers.push({
          unitId,
          name: "",
          side: "",
          position: [position[0], position[1], position[2] ?? 0],
          monitoring: false,
        });
      }
      if (peers.length === 0) continue;

      const results = reachability({
        origin: [origin[0], origin[1], origin[2] ?? 0],
        peers,
        rangeMeters: radio?.rangeMeters ?? fallbackRange(tx.type),
        mod: radio?.mod ?? "TFAR",
        grid: commsDem(),
        tfar: engine.radioPropagation,
        acre: engine.acrePropagation,
        frequencyMHz: tx.frequency,
      });

      for (const result of results) {
        const target = snapshots.get(result.unitId)?.position;
        if (!target) continue;
        commsLines.push(
          renderer.addLine(origin, target, {
            color: result.inRange ? "#4ade80" : "#f87171",
            weight: result.inRange ? 2 : 1,
            opacity: result.inRange ? 0.7 : 0.35,
          }),
        );
      }
    }
  });

  // Movement trails.
  //
  // Drawn from the recording rather than accumulated during playback, so
  // scrubbing backwards shows the trail as it was rather than an empty line.
  // Positions are sampled at a fixed count regardless of the window length,
  // which keeps a two-minute trail the same cost at any capture delay.
  const trailHandles = new Map<number, BriefingMarkerHandle>();

  // Sampled positions per unit, keyed by the frame they were read at.
  //
  // The window slides by one frame at a time while the samples inside it are
  // snapped to absolute multiples of `step` below, so consecutive playhead
  // frames ask for almost entirely the same frames. Without this every frame
  // re-read all forty samples for every unit with a trail, which in "players"
  // mode is a few thousand chunk lookups a frame.
  //
  // Only resolved positions are cached. A miss means the covering chunk is not
  // loaded yet, and caching that would freeze the gap into the trail even after
  // the chunk arrives.
  const trailSamples = new Map<number, Map<number, [number, number]>>();

  createEffect(() => {
    const frame = engine.currentFrame();
    const mode = trailMode();
    const snapshots = engine.entitySnapshots();

    const wanted = new Set<number>();
    if (mode === "followed") {
      const target = engine.followTarget();
      if (target !== null) wanted.add(target);
    } else if (mode === "players") {
      for (const [id, snap] of snapshots) {
        if (snap.isPlayer && !snap.isInVehicle) wanted.add(id);
      }
    }

    for (const [id, handle] of trailHandles) {
      if (wanted.has(id)) continue;
      renderer.removeBriefingMarker(handle);
      trailHandles.delete(id);
    }
    for (const id of trailSamples.keys()) {
      if (!wanted.has(id)) trailSamples.delete(id);
    }
    if (wanted.size === 0) return;

    const captureDelayMs = engine.captureDelayMs() || 1000;
    const windowFrames = Math.max(1, Math.round((TRAIL_SECONDS * 1000) / captureDelayMs));
    const step = Math.max(1, Math.round(windowFrames / TRAIL_SAMPLES));
    const windowStart = Math.max(0, frame - windowFrames);

    for (const id of wanted) {
      let cache = trailSamples.get(id);
      if (!cache) {
        cache = new Map();
        trailSamples.set(id, cache);
      }
      // Samples that have fallen out of the back of the window, and anything
      // ahead of the playhead, which is what a backwards scrub leaves behind.
      for (const sampled of cache.keys()) {
        if (sampled < windowStart || sampled > frame) cache.delete(sampled);
      }

      const points: [number, number][] = [];
      // Snapped to absolute multiples of `step`, so the sample frames are stable
      // as the playhead advances and the cache above actually hits.
      const first = Math.ceil(windowStart / step) * step;
      for (let f = first; f <= frame; f += step) {
        let position = cache.get(f);
        if (!position) {
          const state = engine.getPositionAt(id, f);
          if (!state) continue;
          position = [state[0], state[1]];
          cache.set(f, position);
        }
        points.push(position);
      }
      const head = snapshots.get(id)?.position;
      if (head) points.push([head[0], head[1]]);

      // One point is not a line, and Leaflet renders a degenerate polyline as a
      // dot that reads as a stray marker.
      if (points.length < 2) {
        const stale = trailHandles.get(id);
        if (stale) {
          renderer.removeBriefingMarker(stale);
          trailHandles.delete(id);
        }
        continue;
      }

      let handle = trailHandles.get(id);
      if (!handle) {
        const side = snapshots.get(id)?.side;
        handle = renderer.createBriefingMarker({
          shape: "POLYLINE",
          type: "Empty",
          color: (side ? SIDE_COLORS_BRIGHT[side] : "#ffffff").replace("#", ""),
          side: "GLOBAL",
          layer: "systemMarkers",
        });
        trailHandles.set(id, handle);
      }

      renderer.updateBriefingMarker(handle, {
        position: points[points.length - 1],
        direction: 0,
        alpha: 0.55,
        points,
      });
    }
  });

  // Death heatmap.
  //
  // Every death up to the playhead, binned into a grid so overlapping kills in
  // one building become one blob whose size and opacity carry the count. Bound
  // to the playhead rather than the whole mission so it grows as you watch.
  // The radius is baked into an ELLIPSE handle at creation, so a blob that grows
  // as more deaths land in its cell has to be recreated rather than updated.
  const deathBlobs = new Map<string, { handle: BriefingMarkerHandle; radius: number }>();

  // Resolve positions during traversal, then keep only the small site list.
  const [deathSites, setDeathSites] = createSignal<DeathSite[]>([]);
  let deathSitesLoad: Promise<DeathSite[]> | undefined;

  createEffect(() => {
    engine.endFrame();
    deathSitesLoad = undefined;
    setDeathSites([]);
  });

  createEffect(() => {
    if (!deathHeatmapVisible()) return;
    engine.endFrame();
    let active = true;
    onCleanup(() => { active = false; });
    deathSitesLoad ??= buildDeathSites(engine).catch((error) => {
      deathSitesLoad = undefined;
      console.error("Failed to resolve death sites", error);
      return [];
    });
    void deathSitesLoad.then((sites) => {
      if (active) setDeathSites(sites);
    });
  });

  createEffect(() => {
    const frame = engine.currentFrame();
    const visible = deathHeatmapVisible();

    if (!visible) {
      for (const blob of deathBlobs.values()) renderer.removeBriefingMarker(blob.handle);
      deathBlobs.clear();
      return;
    }

    const cells = binDeathSites(deathSites(), frame, DEATH_HEATMAP_CELL_M);

    for (const [key, blob] of deathBlobs) {
      if (cells.has(key)) continue;
      renderer.removeBriefingMarker(blob.handle);
      deathBlobs.delete(key);
    }

    const busiest = busiestCell(cells.values());

    for (const [key, cell] of cells) {
      const radius = deathBlobRadius(cell.count, busiest, DEATH_HEATMAP_CELL_M);

      let blob = deathBlobs.get(key);
      if (blob && Math.abs(blob.radius - radius) > 1) {
        renderer.removeBriefingMarker(blob.handle);
        blob = undefined;
      }
      if (!blob) {
        blob = {
          handle: renderer.createBriefingMarker({
            shape: "ELLIPSE",
            type: "Empty",
            color: "ff3b3b",
            side: "GLOBAL",
            size: [radius, radius],
            brush: "Solid",
            layer: "systemMarkers",
          }),
          radius,
        };
        deathBlobs.set(key, blob);
      }

      renderer.updateBriefingMarker(blob.handle, {
        position: [cell.x, cell.y],
        direction: 0,
        alpha: deathBlobAlpha(cell.count, busiest),
      });
    }
  });

  // Side filter → briefing markers
  createEffect(() => {
    markerManager.setSideFilter(activeSide());
  });

  // Frame → briefing markers
  createEffect(() => {
    const frame = engine.currentFrame();
    markerManager.updateFrame(frame);
  });

  // Auto-unfollow on map drag
  renderer.on("dragstart", () => {
    engine.unfollowEntity();
  });

  // Smoothing: enable sub-frame interpolation during playback. The interval
  // passed is the wall-clock gap between two position updates so the renderer
  // can size its tween to complete in exactly one frame interval.
  createEffect(() => {
    const playing = engine.isPlaying();
    const speed = engine.playbackSpeed();
    const captureDelayMs = engine.captureDelayMs();
    const frameIntervalSec = speed > 0 ? captureDelayMs / 1000 / speed : 1;
    renderer.setSmoothingEnabled(playing, frameIntervalSec);
  });

  // Side panel visibility → CSS custom property
  createEffect(() => {
    const offset = leftPanelVisible()
      ? "calc(var(--pb-panel-width) + 16px)"
      : "10px";
    document.documentElement.style.setProperty("--leaflet-left-offset", offset);
  });
}
