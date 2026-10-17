import { createSignal, type Accessor } from "solid-js";

import type { EntityState, Manifest, EventDef, Side, WorldConfig } from "../data/types";
import type { ArmaCoord } from "../utils/coordinates";
import {
  resolveAcrePropagation,
  resolveTfarPropagation,
  type AcreRadioPropagation,
  type TfarRadioPropagation,
} from "../data/radioPropagation";
import type { TimeConfig } from "./time";
import type { ChunkManager } from "../data/chunkManager";
import type { MapRenderer } from "../renderers/renderer.interface";
import type { EntitySnapshot } from "./types";
import type { GameEvent } from "./events/gameEvent";
import type { CounterState } from "./events/counterEvent";
import { EntityManager } from "./entityManager";
import { EventManager } from "./eventManager";
import { EventSideIndex } from "./eventSides";
import { HitKilledEvent } from "./events/hitKilledEvent";
import { ConnectEvent } from "./events/connectEvent";
import { EndMissionEvent } from "./events/endMissionEvent";
import { GeneralMissionEvent } from "./events/generalEvent";
import { CapturedEvent } from "./events/capturedEvent";
import { TerminalHackEvent } from "./events/terminalHackEvent";
import { PlayerSnapshotEvent } from "./events/playerSnapshotEvent";
import { ServerFpsEvent } from "./events/serverFpsEvent";
import { WeatherEvent } from "./events/weatherEvent";
import {
  ZeusCameraEvent,
  ZeusEntityEvent,
  ZeusModuleEvent,
  ZeusPingEvent,
  ZeusRemoteControlEvent,
} from "./events/zeusEvents";
import {
  ExplosionEvent,
  RadioTransmissionEvent,
  ServiceEvent,
  StaticWeaponEvent,
} from "./events/supportEvents";
import { Unit } from "./entities/unit";
import { Vehicle } from "./entities/vehicle";
import { formatZeusOccupancyName } from "./zeus";

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
    case "contested":
      return new CapturedEvent(def.frameNum, def.type, id, def.unitName, def.objectType, def.side, def.position);
    case "terminalHackStarted":
    case "terminalHackCanceled":
      return new TerminalHackEvent(def.frameNum, def.type, id, def.unitName);
    case "respawnTickets":
    case "counterInit":
    case "counterSet":
      // Counter events are handled separately via CounterState
      return null;
    case "inventorySnapshot":
    case "medicalSnapshot":
    case "staminaSnapshot":
    case "radioSnapshot":
      return new PlayerSnapshotEvent(def.frameNum, def.type, id, def.payload);
    case "tfarSettings":
    case "acreSettings":
      return null;
    case "serverFps":
      return new ServerFpsEvent(def.frameNum, id, def.fps);
    case "weather":
      return new WeatherEvent(def.frameNum, id, def.payload);
    case "zeusEntity":
      return new ZeusEntityEvent(def.frameNum, id, def.payload);
    case "zeusRemoteControl":
      return new ZeusRemoteControlEvent(def.frameNum, id, def.payload);
    case "zeusCamera":
      return new ZeusCameraEvent(def.frameNum, id, def.payload);
    case "zeusPing":
      return new ZeusPingEvent(def.frameNum, id, def.payload);
    case "zeusModule":
      return new ZeusModuleEvent(def.frameNum, id, def.payload);
    case "explosion":
      return new ExplosionEvent(def.frameNum, id, def.payload);
    case "serviceEvent":
      return new ServiceEvent(def.frameNum, id, def.payload);
    case "staticWeapon":
      return new StaticWeaponEvent(def.frameNum, id, def.payload);
    case "radioTransmission":
      return new RadioTransmissionEvent(def.frameNum, id, def.payload);
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
  private eventSides: EventSideIndex | null = null;
  private _worldConfig: Accessor<WorldConfig | undefined>;
  private _setWorldConfig: (world: WorldConfig | undefined) => void;

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
  private _playerSnapshotsVersion: Accessor<number>;
  private _setPlayerSnapshotsVersion: (v: (prev: number) => number) => void;
  private _recordingVersion: Accessor<number>;
  private _setRecordingVersion: (v: (prev: number) => number) => void;
  private _eventReferencesVersion: Accessor<number>;
  private _setEventReferencesVersion: (v: (prev: number) => number) => void;
  /** unitId -> in-flight or settled sidecar load, so a reopen does not refetch. */
  private playerSnapshotLoads = new Map<number, Promise<void>>();

  // ─── Playback loop state ───
  /** Max delta (ms) before treating a gap as a background-tab resume. */
  private static readonly MAX_FRAME_DELTA_MS = 100;
  private animFrameId: number | null = null;
  private lastTickTime = 0;
  private accumulatedMs = 0;

  constructor(renderer: MapRenderer) {
    this.renderer = renderer;

    const [worldConfig, setWorldConfig] = createSignal<WorldConfig>();
    this._worldConfig = worldConfig;
    this._setWorldConfig = setWorldConfig;

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

    const [playerSnapshotsVersion, setPlayerSnapshotsVersion] = createSignal(0);
    this._playerSnapshotsVersion = playerSnapshotsVersion;
    this._setPlayerSnapshotsVersion = setPlayerSnapshotsVersion;
    [this._recordingVersion, this._setRecordingVersion] = createSignal(0);
    [this._eventReferencesVersion, this._setEventReferencesVersion] = createSignal(0);
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
  /** Bumped whenever a player's snapshots finish loading, so the card re-reads. */
  get playerSnapshotsVersion(): Accessor<number> {
    return this._playerSnapshotsVersion;
  }
  /** Changes even when two recordings have the same duration. */
  get recordingVersion(): Accessor<number> { return this._recordingVersion; }
  /** Event sides and combat scores can change when a previously unseen chunk arrives. */
  get eventReferencesVersion(): Accessor<number> { return this._eventReferencesVersion; }
  get worldConfig(): WorldConfig | undefined {
    return this._worldConfig();
  }
  setWorldConfig(world: WorldConfig | undefined): void {
    this._setWorldConfig(world);
  }
  get radioPropagation(): TfarRadioPropagation {
    return resolveTfarPropagation(this.manifest?.radioPropagation);
  }
  get acrePropagation(): AcreRadioPropagation {
    return resolveAcrePropagation(this.manifest?.acrePropagation);
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
    const chunks = this.chunkManager;
    if (chunks) {
      void chunks.ensureLoaded(clamped).then(() => {
        if (this.chunkManager === chunks && this._currentFrame() === clamped) {
          this.computeSnapshots(clamped);
          this._setActiveEvents(this.eventManager.getActiveEvents(clamped));
            // A paused shared link may begin following before its chunk exists.
            const target = this._followTarget();
            if (target !== null) this.panToEntity(target);
        }
      }).catch((error) => {
        if (this.chunkManager === chunks) console.error(`Failed to load playback frame ${clamped}`, error);
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

  /** Pan the camera to an Arma world position. */
  panToPosition(pos: [number, number]): void {
    this.renderer.setView(pos);
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
   * Combat sides are sampled from already loaded chunks and retained as later
   * chunks arrive. Initialization never requests the rest of the mission.
   */
  loadRecording(
    manifest: Manifest,
    chunkManager?: ChunkManager | null,
  ): void {
    // Reset state
    this.clearTimer();
    this._setIsPlaying(false);
    this._setCurrentFrame(0);
    this._setFollowTarget(null);
    this.entityManager.clear();
    this.eventManager.clear();
    this.playerSnapshotLoads.clear();

    this.manifest = manifest;
    this.chunkManager = chunkManager ?? null;
    this.eventSides = this.chunkManager ? new EventSideIndex(manifest) : null;

    // When a chunk finishes loading, recompute snapshots only if the loaded
    // chunk is the one needed for the current frame. This avoids redundant
    // recomputation when a prefetched future chunk arrives.
    if (this.chunkManager) {
      const chunks = this.chunkManager;
      chunks.setCallbacks({
        onChunkLoaded: (chunkIndex: number) => {
          if (this.chunkManager !== chunks || this.manifest !== manifest) return;
          const chunk = chunks.getChunkForFrame(chunkIndex * (manifest.chunkSize || 300));
          if (chunk && this.eventSides?.sample(chunkIndex, chunk)) this.resolveCombatReferences();
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

    // Fold diff-encoded player snapshots back into full snapshots
    this.eventManager.reconstructPlayerSnapshots();

    for (const zeus of this.eventManager.getZeusEntities()) {
      const existing = this.entityManager.getEntity(zeus.curatorId);
      // Zeus borrows nextId without :SOLDIER:CREATE:, so the dense entities[]
      // export leaves a nameless hole at that index. Do not treat the hole as
      // a real unit — overwrite it so VIRTUAL playback can use the id.
      if (existing && existing.type === "zeus") continue;
      if (existing && (existing.name || existing.type !== "unknown")) continue;
      this.entityManager.replaceEntity({
        id: zeus.curatorId,
        type: "zeus",
        name: zeus.name,
        side: "VIRTUAL",
        groupName: "Zeus",
        isPlayer: true,
        startFrame: zeus.startFrame,
        endFrame: manifest.endFrame,
        role: "Zeus",
      });
    }

    // Retain event-time sides from chunks already in the cache; never fetch
    // mission-wide history on the startup path.
    if (this.eventSides && this.chunkManager) {
      for (const index of this.eventSides.chunkIndices) {
        const chunk = this.chunkManager.getChunkForFrame(index * (manifest.chunkSize || 300));
        if (chunk) this.eventSides.sample(index, chunk);
      }
    }
    this.resolveCombatReferences();

    // Build counter state from counter events
    this.buildCounterState(manifest.events);

    // Set endFrame AFTER events are populated so reactive computations
    // (e.g. timeline event ticks) see the events when they re-run.
    this._setEndFrame(manifest.endFrame);

    // Initial snapshot computation
    this.computeSnapshots(0);
    this._setActiveEvents(this.eventManager.getActiveEvents(0));
    this._setRecordingVersion((version) => version + 1);
  }

  private resolveCombatReferences(): void {
    this.eventManager.resolveReferences(this.entityManager, (id, frame) =>
      this.getEventSideAt(id, frame),
    );
    this._setEventReferencesVersion((version) => version + 1);
  }

  /**
   * Make sure a player's detail snapshots are loaded before the profile card
   * reads them.
   *
   * A JSON recording, and a chunked recording converted before the sidecars
   * existed, both carry their snapshots in the manifest — those are already in
   * the event manager and this resolves immediately. Otherwise the unit's
   * sidecar is fetched once and folded into the same index, so every reader
   * downstream sees one shape regardless of where the data came from.
   */
  ensurePlayerSnapshots(unitId: number): Promise<void> {
    const existing = this.playerSnapshotLoads.get(unitId);
    if (existing) return existing;

    const chunkManager = this.chunkManager;
    const manifest = this.manifest;
    if (!chunkManager || !this.manifest?.snapshotUnitIds?.includes(unitId)) {
      const resolved = Promise.resolve();
      this.playerSnapshotLoads.set(unitId, resolved);
      return resolved;
    }

    const load = chunkManager
      .loadPlayerSnapshots(unitId)
      .then((defs) => {
        if (this.chunkManager !== chunkManager || this.manifest !== manifest) return;
        for (const def of defs) {
          const event = createGameEvent(def);
          if (event) this.eventManager.addEvent(event);
        }
        this.eventManager.reconstructPlayerSnapshotsFor(unitId);
        this._setPlayerSnapshotsVersion((v) => v + 1);
      })
      .catch((error) => {
        if (this.chunkManager !== chunkManager || this.manifest !== manifest) return;
        // A missing or corrupt sidecar must not break playback; the card falls
        // back to whatever the manifest already carried for this unit.
        console.error(`Failed to load snapshots for unit ${unitId}`, error);
        this.playerSnapshotLoads.delete(unitId);
      });

    this.playerSnapshotLoads.set(unitId, load);
    return load;
  }

  /**
   * Load every player's snapshot sidecar.
   *
   * The profile card reads one player at a time, which is why sidecars are
   * lazy. A comms rollup is the opposite shape: it needs every player's radios
   * at once to know who shared a net, as does an active map transmission.
   * A recording that keeps its snapshots in the manifest resolves
   * immediately without a single request.
   */
  ensureAllPlayerSnapshots(): Promise<void> {
    const unitIds = this.manifest?.snapshotUnitIds ?? [];
    if (unitIds.length === 0) return Promise.resolve();
    return Promise.all(unitIds.map((unitId) => this.ensurePlayerSnapshots(unitId))).then(() => {});
  }

  /**
   * Raw per-frame state of one entity, or null when that frame is not loaded.
   *
   * Resolves from the same two sources as the playback snapshot: the chunk
   * covering the frame when the recording is chunked, and the entity's own dense
   * position array when it is a JSON recording. Anything reading history rather
   * than the playhead -- trails, distance totals, group membership over time --
   * has to come through here, because `entity.positions` is null for a chunked
   * recording, and because EntitySnapshot drops the per-frame group and role
   * this returns.
   */
  getStateAt(entityId: number, frame: number): EntityState | null {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return null;
    if (frame < entity.startFrame || frame > entity.endFrame) return null;

    const chunkSize = this.manifest?.chunkSize || 300;
    const chunk = this.chunkManager?.getChunkForFrame(frame);
    if (chunk) {
      const states = chunk.entities.get(entityId);
      const state = states?.[frame - Math.floor(frame / chunkSize) * chunkSize];
      if (state) return state;
    }

    return entity.positions?.[entity.getRelativeFrameIndex(frame)] ?? null;
  }

  /** Historical event affiliation, independent of the playhead and chunk eviction. */
  getEventSideAt(entityId: number, frame: number): Side | undefined {
    const side = this.eventSides?.sideAt(entityId, frame) ?? this.getStateAt(entityId, frame)?.side;
    if (side) return side;
    // A recording without per-frame sides, or history not loaded yet, uses
    // the stable spawn faction even after the unit leaves the current roster.
    const entity = this.entityManager.getEntity(entityId);
    return entity instanceof Unit ? entity.sideAtFrame(frame) : undefined;
  }

  /** Position of one entity at an arbitrary frame, or null when not loaded. */
  getPositionAt(entityId: number, frame: number): ArmaCoord | null {
    return this.getStateAt(entityId, frame)?.position ?? null;
  }

  /**
   * Walk the whole recording once, handing `visit` each stretch of frames
   * together with a state reader that is valid for that stretch.
   *
   * The chunk cache keeps only a few chunks, so loading them all and then
   * reading through getStateAt sees just the last ones. A reader that must see
   * every frame comes through here instead: each chunk is read while this call
   * still holds it, one chunk at a time, in frame order. A JSON recording is a
   * single pass over the dense position arrays.
   */
  async visitAllFrames(
    visit: (
      firstFrame: number,
      lastFrame: number,
      stateAt: (entityId: number, frame: number) => EntityState | null,
    ) => void,
  ): Promise<void> {
    const endFrame = this._endFrame();
    const chunkManager = this.chunkManager;
    const count = this.manifest?.chunkCount ?? 0;
    if (!chunkManager || count <= 0) {
      visit(0, endFrame, (entityId, frame) => this.getStateAt(entityId, frame));
      return;
    }

    const chunkSize = this.manifest?.chunkSize || 300;
    try {
      for (let index = 0; index < count; index++) {
        const firstFrame = index * chunkSize;
        if (firstFrame > endFrame) break;
        const chunk = await chunkManager.loadChunk(index);
        // A different recording was loaded while this chunk was in flight.
        if (this.chunkManager !== chunkManager) return;
        const lastFrame = Math.min(firstFrame + chunkSize - 1, endFrame);
        visit(firstFrame, lastFrame, (entityId, frame) => {
          const entity = this.entityManager.getEntity(entityId);
          if (!entity || frame < entity.startFrame || frame > entity.endFrame) return null;
          return (
            chunk.entities.get(entityId)?.[frame - firstFrame] ??
            entity.positions?.[entity.getRelativeFrameIndex(frame)] ??
            null
          );
        });
      }
    } finally {
      // Analysis may evict the playhead's chunk. Restore it even when a later
      // chunk fails, so a paused recording and its roster remain usable.
      if (this.chunkManager === chunkManager) {
        const frame = this._currentFrame();
        await chunkManager.ensureLoaded(frame);
        if (this.chunkManager === chunkManager && this._currentFrame() === frame) {
          this.computeSnapshots(frame);
        }
      }
    }
  }

  /** Whether a player has snapshots at all, before any sidecar is fetched. */
  hasPlayerSnapshots(unitId: number): boolean {
    return (
      this.eventManager.hasPlayerSnapshots(unitId) ||
      (this.manifest?.snapshotUnitIds?.includes(unitId) ?? false)
    );
  }

  dispose(): void {
    this.clearTimer();
    this._setIsPlaying(false);
    this.entityManager.clear();
    this.eventManager.clear();
    this.playerSnapshotLoads.clear();
    this.eventSides = null;
    this.chunkManager = null;
    this.manifest = null;
    this._setWorldConfig(undefined);
    this._setRecordingVersion((version) => version + 1);
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
      const chunks = this.chunkManager;
      void chunks.ensureLoaded(nextFrame).catch((error) => {
        if (this.chunkManager === chunks) console.error(`Failed to load playback frame ${nextFrame}`, error);
      });
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
          if (entity instanceof Vehicle) {
            entity.setCrew(state.crewIds?.length ? state.crewIds : []);
            if (state.crewIds?.length) {
              side = entity.getSideFromCrew((id) => this.entityManager.getEntity(id));
              isPlayer = state.crewIds.some((id) => {
                const crew = this.entityManager.getEntity(id);
                return crew instanceof Unit && crew.isPlayer;
              });
            }
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
            const targets = entity.firedOnFrame(frame);
            if (targets) snapshot.firedTargets = targets;
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
          entity.setCrew(state?.crewIds?.length ? state.crewIds : []);
          if (state?.crewIds?.length) {
            snap.side = entity.getSideFromCrew((id) => this.entityManager.getEntity(id));
            snap.isPlayer = state.crewIds.some((id) => {
              const crew = this.entityManager.getEntity(id);
              return crew instanceof Unit && crew.isPlayer;
            });
          }
        }
        if (entity instanceof Unit) {
          const targets = entity.firedOnFrame(frame);
          if (targets) snap.firedTargets = targets;
        }
        snapshots.set(entity.id, snap);
      }
    }

    for (const entity of this.entityManager.getAll()) {
      if (!(entity instanceof Unit) || entity.type !== "zeus") continue;
      if (frame < entity.startFrame || frame > entity.endFrame) continue;

      const zeus = this.eventManager.getZeusState(entity.id, frame);
      if (!zeus) continue;

      let position = snapshots.get(entity.id)?.position;
      let direction = snapshots.get(entity.id)?.direction ?? 0;
      let side = zeus.side;
      let name = entity.name;
      let fov: number | undefined;
      let pitch: number | undefined;
      let controllingUnitId: number | undefined;

      if (zeus.controllingUnitId !== null) {
        const host = snapshots.get(zeus.controllingUnitId);
        const hostEntity = this.entityManager.getEntity(zeus.controllingUnitId);
        if (!host && !zeus.camera) continue;
        if (host) {
          position = host.position;
          direction = host.direction;
          if (host.side) side = host.side;
        } else if (zeus.camera) {
          position = [zeus.camera.x, zeus.camera.y];
          direction = zeus.camera.dir;
        }
        const hostName = host?.name ?? (hostEntity instanceof Unit ? hostEntity.name : null);
        const hostType = hostEntity instanceof Unit ? hostEntity.roleAtFrame(frame) : "";
        name = hostName ? formatZeusOccupancyName(entity.name, hostName, hostType) : entity.name;
        controllingUnitId = zeus.controllingUnitId;
      } else if (zeus.camera) {
        position = [zeus.camera.x, zeus.camera.y];
        direction = zeus.camera.dir;
        fov = zeus.camera.fov;
        pitch = zeus.camera.pitch;
      }

      if (!position) continue;

      snapshots.set(entity.id, {
        id: entity.id,
        position,
        direction,
        alive: 1,
        side,
        name,
        iconType: "zeus",
        isPlayer: true,
        isInVehicle: false,
        fov,
        pitch,
        controllingUnitId,
      });
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
