import { createEffect } from "solid-js";
import type { MarkerHandle, LineHandle, CrewInfo } from "../../renderers/renderer.types";
import { SIDE_COLORS_DARK } from "../../config/sideColors";
import type { PlaybackEngine } from "../../playback/engine";
import type { MarkerManager } from "../../playback/markerManager";
import { Vehicle } from "../../playback/entities/vehicle";
import { Unit } from "../../playback/entities/unit";
import { HitKilledEvent } from "../../playback/events/hitKilledEvent";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { leftPanelVisible, activeSide } from "./shortcuts";

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

/**
 * Syncs engine snapshots to renderer markers, updates briefing markers
 * per frame, and keeps the CSS left-offset in sync with panel visibility.
 */
export function useRenderBridge(
  engine: PlaybackEngine,
  renderer: MapRenderer,
  markerManager: MarkerManager,
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

  // Smoothing: enable CSS transitions on markers during playback
  createEffect(() => {
    const playing = engine.isPlaying();
    const speed = engine.playbackSpeed();
    renderer.setSmoothingEnabled(playing, speed);
  });

  // Side panel visibility → CSS custom property
  createEffect(() => {
    const offset = leftPanelVisible()
      ? "calc(var(--pb-panel-width) + 16px)"
      : "10px";
    document.documentElement.style.setProperty("--leaflet-left-offset", offset);
  });
}
