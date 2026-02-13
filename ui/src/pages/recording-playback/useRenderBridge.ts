import { createEffect } from "solid-js";
import type { MarkerHandle, LineHandle } from "../../renderers/renderer.types";
import { SIDE_COLORS_DARK } from "../../config/side-colors";
import type { PlaybackEngine } from "../../playback/engine";
import type { MarkerManager } from "../../playback/marker-manager";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { leftPanelVisible } from "./shortcuts";

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

  // Frame → briefing markers
  createEffect(() => {
    const frame = engine.currentFrame();
    markerManager.updateFrame(frame);
  });

  // Auto-unfollow on map drag
  renderer.on("dragstart", () => {
    engine.unfollowEntity();
  });

  // Side panel visibility → CSS custom property
  createEffect(() => {
    const offset = leftPanelVisible()
      ? "calc(var(--pb-panel-width) + 16px)"
      : "10px";
    document.documentElement.style.setProperty("--leaflet-left-offset", offset);
  });
}
