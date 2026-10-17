import type { ChunkData, EventDef, Manifest, Side } from "../data/types";

type FactionEvent = Extract<EventDef, { type: "hit" | "killed" | "radioTransmission" }>;

/** Retain event-frame sides from chunks that normal playback or analysis has loaded. */
export class EventSideIndex {
  private readonly byChunk = new Map<number, FactionEvent[]>();
  private readonly sampled = new Set<number>();
  private readonly sides = new Map<number, Map<number, Side>>();
  private readonly entities: Map<number, Manifest["entities"][number]>;
  private readonly chunkSize: number;

  constructor(manifest: Manifest) {
    this.chunkSize = manifest.chunkSize || 300;
    this.entities = new Map(manifest.entities.map((entity) => [entity.id, entity]));
    for (const event of manifest.events) {
      if (event.type !== "hit" && event.type !== "killed" && event.type !== "radioTransmission") continue;
      const index = Math.floor(event.frameNum / this.chunkSize);
      if (index < 0 || index >= manifest.chunkCount) continue;
      const events = this.byChunk.get(index) ?? [];
      events.push(event);
      this.byChunk.set(index, events);
    }
  }

  get chunkIndices(): IterableIterator<number> { return this.byChunk.keys(); }

  sideAt = (id: number, frame: number): Side | undefined => this.sides.get(frame)?.get(id);

  /** No network I/O. Once sampled, classification survives eviction and repeated seeks. */
  sample(index: number, chunk: ChunkData): boolean {
    const events = this.byChunk.get(index);
    if (!events || this.sampled.has(index)) return false;
    for (const event of events) {
      const atFrame = this.sides.get(event.frameNum) ?? new Map<number, Side>();
      const ids = event.type === "radioTransmission"
        ? [event.payload.unitId]
        : [event.victimId, event.causedById];
      for (const id of ids) {
        const entity = this.entities.get(id);
        if (!entity || event.frameNum < entity.startFrame || event.frameNum > entity.endFrame) continue;
        const side = chunk.entities.get(id)?.[event.frameNum - index * this.chunkSize]?.side;
        atFrame.set(id, side ?? entity.side);
      }
      this.sides.set(event.frameNum, atFrame);
    }
    this.sampled.add(index);
    return true;
  }
}
