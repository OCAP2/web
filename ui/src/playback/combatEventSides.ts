import type { ChunkManager } from "../data/chunkManager";
import type { EventDef, Manifest, Side } from "../data/types";

/** Event frame -> unit id -> recorded side. Independent of the chunk LRU. */
export type CombatEventSides = ReadonlyMap<number, ReadonlyMap<number, Side>>;

/** Read only combat-event frames, retaining their sides before each chunk can be evicted. */
export async function loadCombatEventSides(
  manifest: Manifest,
  chunks: ChunkManager,
): Promise<CombatEventSides> {
  const chunkSize = manifest.chunkSize || 300;
  const byChunk = new Map<number, Array<EventDef & { type: "hit" | "killed" }>>();
  for (const event of manifest.events) {
    if (event.type !== "hit" && event.type !== "killed") continue;
    const index = Math.floor(event.frameNum / chunkSize);
    if (index < 0 || index >= manifest.chunkCount) continue;
    const events = byChunk.get(index) ?? [];
    events.push(event);
    byChunk.set(index, events);
  }

  const entities = new Map(manifest.entities.map((entity) => [entity.id, entity]));
  const sides = new Map<number, Map<number, Side>>();
  for (const [index, events] of [...byChunk].sort((a, b) => a[0] - b[0])) {
    const chunk = await chunks.loadChunk(index);
    for (const event of events) {
      const atFrame = sides.get(event.frameNum) ?? new Map<number, Side>();
      for (const id of [event.victimId, event.causedById]) {
        const entity = entities.get(id);
        if (!entity || event.frameNum < entity.startFrame || event.frameNum > entity.endFrame) continue;
        const side = chunk.entities.get(id)?.[event.frameNum - index * chunkSize]?.side;
        if (side) atFrame.set(id, side);
      }
      sides.set(event.frameNum, atFrame);
    }
  }
  return sides;
}
