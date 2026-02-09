/**
 * State of a counter (respawn tickets or custom counter).
 */
export interface CounterState {
  active: boolean;
  type: string;
  sides: string[];
  events: Array<{ frameNum: number; values: Record<string, number> }>;
}

/**
 * Return the counter values at the given frame using binary search.
 * Finds the closest event whose frameNum <= frame.
 * Returns null if the counter has no events or the frame is before all events.
 */
export function getCounterStateAtFrame(
  state: CounterState,
  frame: number,
): Record<string, number> | null {
  const { events } = state;
  if (events.length === 0) return null;

  // Binary search for the last event where frameNum <= frame
  let lo = 0;
  let hi = events.length - 1;
  let idx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].frameNum <= frame) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (idx === -1) return null;
  return { ...events[idx].values };
}
