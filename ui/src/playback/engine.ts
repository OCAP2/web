import { createSignal, type Accessor } from "solid-js";

import type { Manifest, EventDef } from "../data/types";
import type { TimeConfig } from "./time";
import type { ChunkManager } from "../data/chunkManager";
import type { MapRenderer } from "../renderers/renderer.interface";
import type { EntitySnapshot } from "./types";
import type { GameEvent } from "./events/gameEvent";
import type { CounterState } from "./events/counterEvent";
import { EntityManager } from "./entityManager";
import { EventManager } from "./eventManager";
import { HitKilledEvent } from "./events/hitKilledEvent";
import { ConnectEvent } from "./events/connectEvent";
import { EndMissionEvent } from "./events/endMissionEvent";
import { GeneralMissionEvent } from "./events/generalEvent";
import { CapturedEvent } from "./events/capturedEvent";
import { TerminalHackEvent } from "./events/terminalHackEvent";
import { Unit } from "./entities/unit";
import { Vehicle } from "./entities/vehicle";

// ─── Event factory ───

let nextEventId = 0;

function createGameEvent(def: EventDef): GameEvent | null {
  const id = nextEventId++;
  switch (def.type) {
    case "hit":
    case "killed":
      return new HitKilledEvent(
        def.frameNum,
        def.type,
        id,
        def.victimId,
        def.causedById,
        def.distance,
        def.weapon,
      );
    case "connected":
    case "disconnected":
      return new ConnectEvent(def.frameNum, def.type, id, def.unitName);
    case "endMission":
      return new EndMissionEvent(def.frameNum, id, def.side, def.message);
    case "generalEvent":
      return new GeneralMissionEvent(def.frameNum, id, def.message);
    case "captured":
    case "capturedFlag":
      return new CapturedEvent(def.frameNum, def.type, id, def.unitName, def.objectType);
    case "terminalHackStarted":
    case "terminalHackCanceled":
      return new TerminalHackEvent(def.frameNum, def.type, id, def.unitName);
    case "respawnTickets":
    case "counterInit":
    case "counterSet":
      // Counter events are handled separately via CounterState
      return null;
    default:
      return null;
  }
}

// ─── PlaybackEngine ───

/**
 * Central playback coordinator.
 *
 * Ties together EntityManager, EventManager, ChunkManager, and the
 * MapRenderer interface. Uses SolidJS signals for reactive state.
 *
 * Pure data orchestration -- the engine never imports Leaflet or any
 * map library. It calls renderer methods during the playback loop.
 */
export class PlaybackEngine {
  // ─── Managers ───
  readonly entityManager = new EntityManager();
  readonly eventManager = new EventManager();

  private renderer: MapRenderer;
  private chunkManager: ChunkManager | null = null;
  private manifest: Manifest | null = null;

  // ─── Signals (reactive state) ───
  private _currentFrame: Accessor<number>;
  private _setCurrentFrame: (v: number) => void;

  private _isPlaying: Accessor<boolean>;
  private _setIsPlaying: (v: boolean) => void;

  private _playbackSpeed: Accessor<number>;
  private _setPlaybackSpeed: (v: number) => void;

  private _entitySnapshots: Accessor<Map<number, EntitySnapshot>>;
  private _setEntitySnapshots: (v: Map<number, EntitySnapshot>) => void;

  private _activeEvents: Accessor<GameEvent[]>;
  private _setActiveEvents: (v: GameEvent[]) => void;

  private _followTarget: Accessor<number | null>;
  private _setFollowTarget: (v: number | null) => void;

  private _counterState: Accessor<CounterState | null>;
  private _setCounterState: (v: CounterState | null) => void;

  private _endFrame: Accessor<number>;
  private _setEndFrame: (v: number) => void;

  private _captureDelayMs: Accessor<number>;
  private _setCaptureDelayMs: (v: number) => void;

  // ─── Playback loop state ───
  /** Max delta (ms) before treating a gap as a background-tab resume. */
  private static readonly MAX_FRAME_DELTA_MS = 100;
  private animFrameId: number | null = null;
  private lastTickTime = 0;
  private accumulatedMs = 0;

  constructor(renderer: MapRenderer) {
    this.renderer = renderer;

    const [currentFrame, setCurrentFrame] = createSignal(0);
    this._currentFrame = currentFrame;
    this._setCurrentFrame = setCurrentFrame;

    const [isPlaying, setIsPlaying] = createSignal(false);
    this._isPlaying = isPlaying;
    this._setIsPlaying = setIsPlaying;

    const [playbackSpeed, setPlaybackSpeed] = createSignal(10);
    this._playbackSpeed = playbackSpeed;
    this._setPlaybackSpeed = setPlaybackSpeed;

    const [entitySnapshots, setEntitySnapshots] = createSignal<
      Map<number, EntitySnapshot>
    >(new Map());
    this._entitySnapshots = entitySnapshots;
    this._setEntitySnapshots = setEntitySnapshots;

    const [activeEvents, setActiveEvents] = createSignal<GameEvent[]>([]);
    this._activeEvents = activeEvents;
    this._setActiveEvents = setActiveEvents;

    const [followTarget, setFollowTarget] = createSignal<number | null>(null);
    this._followTarget = followTarget;
    this._setFollowTarget = setFollowTarget;

    const [counterState, setCounterState] = createSignal<CounterState | null>(
      null,
    );
    this._counterState = counterState;
    this._setCounterState = setCounterState;

    const [endFrame, setEndFrame] = createSignal(0);
    this._endFrame = endFrame;
    this._setEndFrame = setEndFrame;

    const [captureDelayMs, setCaptureDelayMs] = createSignal(1000);
    this._captureDelayMs = captureDelayMs;
    this._setCaptureDelayMs = setCaptureDelayMs;
  }

  // ─── Public signal accessors ───

  get currentFrame(): Accessor<number> {
    return this._currentFrame;
  }
  get isPlaying(): Accessor<boolean> {
    return this._isPlaying;
  }
  get playbackSpeed(): Accessor<number> {
    return this._playbackSpeed;
  }
  get entitySnapshots(): Accessor<Map<number, EntitySnapshot>> {
    return this._entitySnapshots;
  }
  get activeEvents(): Accessor<GameEvent[]> {
    return this._activeEvents;
  }
  get followTarget(): Accessor<number | null> {
    return this._followTarget;
  }
  get counterState(): Accessor<CounterState | null> {
    return this._counterState;
  }
  get endFrame(): Accessor<number> {
    return this._endFrame;
  }
  get captureDelayMs(): Accessor<number> {
    return this._captureDelayMs;
  }
  get timeConfig(): TimeConfig {
    const times = this.manifest?.times;
    // Extract mission date and time multiplier from the first time sample
    // (matches the old system's detectTimes logic)
    const first = times?.[0];
    return {
      captureDelayMs: this._captureDelayMs(),
      times,
      missionDate: first?.date,
      missionTimeMultiplier: first?.timeMultiplier,
    };
  }

  // ─── Commands ───

  play(): void {
    if (this._isPlaying()) return;
    // Don't play past the end
    if (this._currentFrame() >= this._endFrame()) return;
    this._setIsPlaying(true);
    this.startLoop();
  }

  pause(): void {
    if (!this._isPlaying()) return;
    this._setIsPlaying(false);
    this.clearTimer();
  }

  togglePlayPause(): void {
    if (this._isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  }

  seekTo(frame: number): void {
    const clamped = Math.max(0, Math.min(frame, this._endFrame()));
    this._setCurrentFrame(clamped);

    // Compute with whatever chunk data is already in memory
    this.computeSnapshots(clamped);
    this._setActiveEvents(this.eventManager.getActiveEvents(clamped));

    // If the needed chunk isn't loaded yet, load it then recompute
    if (this.chunkManager) {
      void this.chunkManager.ensureLoaded(clamped).then(() => {
        if (this._currentFrame() === clamped) {
          this.computeSnapshots(clamped);
          this._setActiveEvents(this.eventManager.getActiveEvents(clamped));
        }
      });
    }
  }

  setSpeed(multiplier: number): void {
    const clamped = Math.max(1, Math.min(60, multiplier));
    this._setPlaybackSpeed(clamped);
    // Restart timer with new interval if playing
    if (this._isPlaying()) {
      this.clearTimer();
      this.startLoop();
    }
  }

  /** Pan the camera to an entity's current position without following it. */
  panToEntity(id: number): void {
    const snap = this._entitySnapshots().get(id);
    if (snap) {
      this.renderer.setView(snap.position);
    }
  }

  followEntity(id: number): void {
    this._setFollowTarget(id);
    this.panToEntity(id);
  }

  unfollowEntity(): void {
    this._setFollowTarget(null);
  }

  // ─── Lifecycle ───

  /**
   * Populate entities and events from a manifest, and wire up the chunk manager.
   */
  loadRecording(manifest: Manifest, chunkManager?: ChunkManager | null): void {
    // Reset state
    this.clearTimer();
    this._setIsPlaying(false);
    this._setCurrentFrame(0);
    this._setFollowTarget(null);
    this.entityManager.clear();
    this.eventManager.clear();

    this.manifest = manifest;
    this.chunkManager = chunkManager ?? null;

    // When a chunk finishes loading, recompute snapshots only if the loaded
    // chunk is the one needed for the current frame. This avoids redundant
    // recomputation when a prefetched future chunk arrives.
    if (this.chunkManager) {
      this.chunkManager.setCallbacks({
        onChunkLoaded: (chunkIndex: number) => {
          const frame = this._currentFrame();
          const chunkSize = this.manifest?.chunkSize || 300;
          const currentChunkIndex = Math.floor(frame / chunkSize);
          if (chunkIndex !== currentChunkIndex) return;
          this.computeSnapshots(frame);
          this._setActiveEvents(this.eventManager.getActiveEvents(frame));
        },
      });
    }

    this._setCaptureDelayMs(manifest.captureDelayMs);

    // Populate entities
    for (const def of manifest.entities) {
      this.entityManager.addEntity(def);
    }

    // Populate events
    nextEventId = 0;
    for (const def of manifest.events) {
      const event = createGameEvent(def);
      if (event) {
        this.eventManager.addEvent(event);
      }
    }

    // Resolve entity references on hit/killed events
    this.eventManager.resolveReferences(this.entityManager);

    // Build counter state from counter events
    this.buildCounterState(manifest.events);

    // Set endFrame AFTER events are populated so reactive computations
    // (e.g. timeline event ticks) see the events when they re-run.
    this._setEndFrame(manifest.frameCount - 1);

    // Initial snapshot computation
    this.computeSnapshots(0);
    this._setActiveEvents(this.eventManager.getActiveEvents(0));
  }

  dispose(): void {
    this.clearTimer();
    this._setIsPlaying(false);
    this.entityManager.clear();
    this.eventManager.clear();
    this.chunkManager = null;
    this.manifest = null;
  }

  // ─── Playback loop ───

  private startLoop(): void {
    this.accumulatedMs = 0;
    this.lastTickTime = performance.now();
    this.animFrameId = requestAnimationFrame(() => this.onFrame());
  }

  private clearTimer(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private onFrame(): void {
    if (!this._isPlaying()) return;

    const now = performance.now();
    let delta = now - this.lastTickTime;
    this.lastTickTime = now;

    // Background tab: rAF pauses, delta is huge on resume. Discard it.
    if (delta > PlaybackEngine.MAX_FRAME_DELTA_MS) {
      delta = 0;
    }

    this.accumulatedMs += delta;
    const idealInterval = this._captureDelayMs() / this._playbackSpeed();
    const framesToAdvance = Math.floor(this.accumulatedMs / idealInterval);

    if (framesToAdvance <= 0) {
      this.animFrameId = requestAnimationFrame(() => this.onFrame());
      return;
    }

    this.accumulatedMs -= framesToAdvance * idealInterval;

    const frame = this._currentFrame();
    const end = this._endFrame();

    if (frame >= end) {
      this._setIsPlaying(false);
      this.clearTimer();
      return;
    }

    const nextFrame = Math.min(frame + framesToAdvance, end);
    this._setCurrentFrame(nextFrame);

    // Ensure current chunk is loaded (async — the onChunkLoaded callback
    // will recompute snapshots if this triggers a new load).
    if (this.chunkManager) {
      void this.chunkManager.ensureLoaded(nextFrame);
    }

    // Compute entity snapshots with whatever chunk data is in memory
    this.computeSnapshots(nextFrame);

    // Update events
    this._setActiveEvents(this.eventManager.getActiveEvents(nextFrame));

    // Handle camera follow
    const target = this._followTarget();
    if (target !== null) {
      const snapshots = this._entitySnapshots();
      const snap = snapshots.get(target);
      if (snap) {
        this.renderer.setView(snap.position);
      } else {
        this._setFollowTarget(null);
      }
    }

    // Auto-pause at endFrame
    if (nextFrame >= end) {
      this._setIsPlaying(false);
      this.clearTimer();
      return;
    }

    // Schedule next frame
    this.animFrameId = requestAnimationFrame(() => this.onFrame());
  }

  // ─── Snapshot computation ───

  private computeSnapshots(frame: number): void {
    const snapshots = new Map<number, EntitySnapshot>();

    if (!this.manifest) {
      this._setEntitySnapshots(snapshots);
      return;
    }

    const chunkSize = this.manifest.chunkSize || 300;
    const chunkIndex = Math.floor(frame / chunkSize);
    const frameInChunk = frame - chunkIndex * chunkSize;

    const chunkData = this.chunkManager?.getChunkForFrame(frame) ?? null;

    for (const entity of this.entityManager.getAll()) {
      // Check entity lifespan
      if (frame < entity.startFrame || frame > entity.endFrame) {
        continue;
      }

      // Try chunk data first
      if (chunkData) {
        const states = chunkData.entities.get(entity.id);
        if (states && states[frameInChunk]) {
          const state = states[frameInChunk];
          let side: import("../data/types").Side | null = entity instanceof Unit ? (state.side ?? entity.side) : null;
          let isPlayer = entity instanceof Unit ? entity.isPlayer : false;
          if (entity instanceof Vehicle && state.crewIds?.length) {
            entity.setCrew(state.crewIds);
            side = entity.getSideFromCrew((id) => this.entityManager.getEntity(id));
            isPlayer = state.crewIds.some((id) => {
              const crew = this.entityManager.getEntity(id);
              return crew instanceof Unit && crew.isPlayer;
            });
          }
          const snapshot: EntitySnapshot = {
            id: entity.id,
            position: state.position,
            direction: state.direction,
            alive: state.alive,
            side,
            name: state.name ?? entity.name,
            iconType: entity.iconType,
            isPlayer,
            isInVehicle: state.isInVehicle ?? false,
          };
          if (entity instanceof Unit) {
            const target = entity.firedOnFrame(frame);
            if (target) snapshot.firedTarget = target;
          }
          snapshots.set(entity.id, snapshot);
          continue;
        }
      }

      // Fallback to entity's own positions (if loaded)
      const relativeFrame = entity.getRelativeFrameIndex(frame);
      const snap = entity.getStateAtFrame(relativeFrame);
      if (snap) {
        // For vehicles, derive side and isPlayer from crew in the position data
        if (entity instanceof Vehicle) {
          const state = entity.positions?.[relativeFrame];
          if (state?.crewIds?.length) {
            entity.setCrew(state.crewIds);
            snap.side = entity.getSideFromCrew((id) => this.entityManager.getEntity(id));
            snap.isPlayer = state.crewIds.some((id) => {
              const crew = this.entityManager.getEntity(id);
              return crew instanceof Unit && crew.isPlayer;
            });
          }
        }
        if (entity instanceof Unit) {
          const target = entity.firedOnFrame(frame);
          if (target) snap.firedTarget = target;
        }
        snapshots.set(entity.id, snap);
      }
    }

    this._setEntitySnapshots(snapshots);
  }

  // ─── Counter state ───

  private buildCounterState(eventDefs: EventDef[]): void {
    const counterEvents = eventDefs.filter(
      (e) =>
        e.type === "respawnTickets" ||
        e.type === "counterInit" ||
        e.type === "counterSet",
    );

    if (counterEvents.length === 0) {
      this._setCounterState(null);
      return;
    }

    // Extract sides and build events list
    const sides = new Set<string>();
    const events: Array<{ frameNum: number; values: Record<string, number> }> =
      [];

    for (const def of counterEvents) {
      if (
        def.type === "respawnTickets" ||
        def.type === "counterInit" ||
        def.type === "counterSet"
      ) {
        // data is an array of alternating side values
        // Build values from the data array
        const values: Record<string, number> = {};
        const data = def.data;
        // Assume data is pairs of [sideIndex, value] or just an array of values per side
        // For simplicity, store as indexed values
        for (let i = 0; i < data.length; i++) {
          const key = String(i);
          values[key] = data[i];
          sides.add(key);
        }
        events.push({ frameNum: def.frameNum, values });
      }
    }

    // Sort events by frame
    events.sort((a, b) => a.frameNum - b.frameNum);

    this._setCounterState({
      active: true,
      type: counterEvents[0].type,
      sides: Array.from(sides),
      events,
    });
  }
}
