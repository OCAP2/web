import type {
  KeyedArrayPatch,
  PlayerSnapshotDiff,
  PlayerSnapshotPayload,
  RawPlayerSnapshot,
} from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKeyedArrayPatch(value: unknown): value is KeyedArrayPatch {
  return isPlainObject(value) && typeof value.$key === "string";
}

/**
 * Apply an entry-wise array patch. Rewriting a whole magazine list because one
 * round was fired was the single largest cost in a recording, so a follow-up
 * snapshot names only the entries that moved.
 */
function mergedArray(base: unknown, patch: KeyedArrayPatch): unknown[] {
  const key = patch.$key;
  const deleted = new Set(patch.del ?? []);
  const result: unknown[] = [];
  const positions = new Map<string, number>();

  for (const entry of Array.isArray(base) ? base : []) {
    const id = isPlainObject(entry) ? entry[key] : undefined;
    if (typeof id === "string") {
      if (deleted.has(id)) continue;
      positions.set(id, result.length);
    }
    result.push(entry);
  }

  for (const entry of patch.put ?? []) {
    const id = entry?.[key];
    if (typeof id !== "string") continue;
    const at = positions.get(id);
    if (at === undefined) {
      positions.set(id, result.length);
      result.push(entry);
    } else {
      result[at] = merged(result[at] as Record<string, unknown>, entry);
    }
  }

  // `ord` is present only when put and del alone would leave the entries in the
  // wrong order. Position is data here: the Arsenal export reads assignedItems
  // by the order the engine walks the slots in.
  if (patch.ord) {
    const rank = new Map(patch.ord.map((id, at) => [id, at]));
    const fallback = patch.ord.length;
    return result
      .map((entry, at) => {
        const id = isPlainObject(entry) ? entry[key] : undefined;
        return { entry, at, rank: typeof id === "string" ? rank.get(id) ?? fallback : fallback };
      })
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .map((row) => row.entry);
  }

  return result;
}

/**
 * A follow-up snapshot carries only what changed since the frame named by `diffOf`,
 * which is what keeps recordings small when a player's gear or radios sit unchanged
 * for the whole mission.
 */
export function isSnapshotDiff(payload: RawPlayerSnapshot): payload is PlayerSnapshotDiff {
  return typeof (payload as PlayerSnapshotDiff).diffOf === "number";
}

/**
 * Deep merge. An array arrives either as a whole replacement or as a keyed patch
 * naming just the entries that changed. Never mutates `target` or `patch`.
 */
function merged(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key];
    result[key] = isKeyedArrayPatch(value)
      ? mergedArray(existing, value)
      : isPlainObject(value) && isPlainObject(existing)
        ? merged(existing, value)
        : value;
  }
  return result;
}

/** Remove a dot-separated path, cloning every object on the way down. */
function withoutPath(
  target: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const [key, ...rest] = path.split(".");
  if (!(key in target)) return target;
  if (rest.length === 0) {
    const result = { ...target };
    delete result[key];
    return result;
  }
  const child = target[key];
  if (!isPlainObject(child)) return target;
  return { ...target, [key]: withoutPath(child, rest.join(".")) };
}

/** Rebuild a full snapshot by applying a diff on top of the previous full snapshot. */
export function applySnapshotDiff(
  base: PlayerSnapshotPayload,
  diff: PlayerSnapshotDiff,
): PlayerSnapshotPayload {
  let result = merged(
    base as unknown as Record<string, unknown>,
    diff.set ?? {},
  );
  for (const path of diff.unset ?? []) {
    result = withoutPath(result, path);
  }
  return result as unknown as PlayerSnapshotPayload;
}
