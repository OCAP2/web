import { createEffect } from "solid-js";
import type { MarkerHandle, LineHandle } from "../../renderers/renderer.types";
import { SIDE_COLORS_DARK } from "../../config/sideColors";
import type { PlaybackEngine } from "../../playback/engine";
import type { EntityManager } from "../../playback/entityManager";
import type { MarkerManager } from "../../playback/markerManager";
import { Vehicle } from "../../playback/entities/vehicle";
import { Unit } from "../../playback/entities/unit";
import { HitKilledEvent } from "../../playback/events/hitKilledEvent";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { leftPanelVisible, activeSide } from "./shortcuts";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build display name for a vehicle showing crew count and member names,
 * matching the old frontend's `setCrew` / `getCrewString` behaviour.
 */
function vehicleDisplayName(
  vehicleName: string,
  vehicle: Vehicle,
  entityManager: EntityManager,
): string {
  const crew = vehicle.crew;
  if (crew.length === 0) {
    return `${escapeHtml(vehicleName)} <i>(0)</i>`;
  }

  const crewNames: string[] = [];
  for (const id of crew) {
    const member = entityManager.getEntity(id);
    // Only list player crew members, matching the old frontend's getCrewString()
    if (member instanceof Unit && member.isPlayer) {
      crewNames.push(escapeHtml(member.name || `Unit ${id}`));
    }
  }

  if (crewNames.length === 0) {
    return `${escapeHtml(vehicleName)} <i>(${crew.length})</i>`;
  }
  return `<u>${escapeHtml(vehicleName)}</u> <i>(${crew.length})</i><br>${crewNames.join("<br>")}`;
}

/**
 * Check if any crew member of a vehicle is a player.
 * Used to determine vehicle popup visibility in "players" nameDisplayMode.
 */
function vehicleHasPlayerCrew(
  vehicle: Vehicle,
  entityManager: EntityManager,
): boolean {
  return vehicle.crew.some((id) => {
    const member = entityManager.getEntity(id);
    return member instanceof Unit && member.isPlayer;
  });
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

  // Hit flash: scan the last N frames for hit events each render.
  // Stateless — works identically for sequential playback and seeking.
  const HIT_FLASH_FRAMES = 3;

  // Entity snapshot → marker sync
  createEffect(() => {
    const snapshots = engine.entitySnapshots();
    const frame = engine.currentFrame();

    // Build set of entities currently in hit-flash state
    const hitEntityIds = new Set<number>();
    for (let f = Math.max(0, frame - HIT_FLASH_FRAMES + 1); f <= frame; f++) {
      for (const ev of engine.eventManager.getEventsAtFrame(f)) {
        if (ev instanceof HitKilledEvent && ev.type === "hit") {
          hitEntityIds.add(ev.victimId);
        }
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
      // Build display name: vehicles show crew count + member names
      let displayName = snap.name;
      let isPlayer = snap.isPlayer;
      const entity = engine.entityManager.getEntity(id);
      if (entity instanceof Vehicle) {
        displayName = vehicleDisplayName(snap.name, entity, engine.entityManager);
        // In "players" mode, show vehicle popup if any crew member is a player
        isPlayer = vehicleHasPlayerCrew(entity, engine.entityManager);
      }

      let handle = markerHandles.get(id);
      if (!handle) {
        handle = renderer.createEntityMarker(id, {
          position: snap.position,
          iconType: snap.iconType,
          side: snap.side,
          name: displayName,
          isPlayer,
        });
        markerHandles.set(id, handle);
      }
      renderer.updateEntityMarker(handle, {
        position: snap.position,
        direction: snap.direction,
        alive: snap.alive,
        side: snap.side,
        name: displayName,
        iconType: snap.iconType,
        isPlayer,
        isInVehicle: snap.isInVehicle,
        hit: hitEntityIds.has(id),
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
