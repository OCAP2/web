/**
 * Playback state carried in the URL.
 *
 * The point is that "watch from 14:32, following Alpha-2" is a link you can
 * paste to someone. Only state that survives a reload is encoded: the frame, the
 * followed unit, the open panel tab and the side filter. Camera position is
 * deliberately left out — it is derived from the followed unit, and encoding a
 * pan the viewer immediately overrides is noise.
 *
 * Written with replaceState, not pushState: scrubbing must not fill the back
 * button with every frame you passed through.
 */

import type { Side } from "../../data/types";

/** Panel tabs a link may select. Mirrors the tab ids in <SidePanel>. */
export const DEEP_LINK_TABS = ["units", "events", "orbat", "comms", "stats", "fps"] as const;

export type DeepLinkTab = (typeof DEEP_LINK_TABS)[number];

const DEEP_LINK_SIDES: readonly Side[] = ["WEST", "EAST", "GUER", "CIV", "VIRTUAL"];

export interface DeepLinkState {
  frame?: number;
  unit?: number;
  tab?: DeepLinkTab;
  side?: Side;
}

/**
 * Narrow a panel tab id to one a link can carry, or undefined.
 *
 * The panel tab signal is a plain string shared with code that has nothing to do
 * with links, so the narrowing happens here rather than by tightening that
 * signal's type and rippling through every caller.
 */
export function asDeepLinkTab(value: string | null | undefined): DeepLinkTab | undefined {
  if (value == null) return undefined;
  return (DEEP_LINK_TABS as readonly string[]).includes(value)
    ? (value as DeepLinkTab)
    : undefined;
}

const PARAM_FRAME = "t";
const PARAM_UNIT = "u";
const PARAM_TAB = "tab";
const PARAM_SIDE = "side";

/**
 * A whole, non-negative number, or undefined.
 *
 * `Number(null)` and `Number("")` are both 0, so an absent or blank parameter
 * would otherwise read as frame zero and yank a viewer back to the start.
 */
function readIndex(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/**
 * Read playback state out of the current URL.
 *
 * Everything here is untrusted: a link is typed, truncated and edited by hand.
 * A parameter that is not one of the values the app actually has is dropped
 * rather than passed through, because the alternative is a `Side` that is not a
 * side reaching a colour lookup, or a tab id that matches no panel and renders
 * an empty sidebar. An unreadable parameter leaves that piece of state at its
 * default; it never rejects the rest of the link.
 */
export function readDeepLink(search: string = window.location.search): DeepLinkState {
  const params = new URLSearchParams(search);
  const state: DeepLinkState = {};

  const frame = readIndex(params.get(PARAM_FRAME));
  if (frame !== undefined) state.frame = frame;

  const unit = readIndex(params.get(PARAM_UNIT));
  if (unit !== undefined) state.unit = unit;

  const tab = asDeepLinkTab(params.get(PARAM_TAB));
  if (tab !== undefined) state.tab = tab;

  const side = params.get(PARAM_SIDE);
  if (side !== null && (DEEP_LINK_SIDES as readonly string[]).includes(side)) {
    state.side = side as Side;
  }

  return state;
}

/**
 * Build the query string for a state, preserving any parameter the app does not
 * own — `renderer`, for one, which selects the map renderer and must survive
 * being handed a shared link.
 */
export function buildDeepLinkSearch(
  state: DeepLinkState,
  search: string = window.location.search,
): string {
  const params = new URLSearchParams(search);

  const set = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  };

  set(PARAM_FRAME, state.frame);
  set(PARAM_UNIT, state.unit);
  set(PARAM_TAB, state.tab);
  set(PARAM_SIDE, state.side);

  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Replace the URL's query string in place, without touching history. */
export function writeDeepLink(state: DeepLinkState): void {
  const search = buildDeepLinkSearch(state);
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Smallest gap between two URL writes, in milliseconds.
 *
 * `replaceState` is rate limited by the browser, not merely slow: Safari throws
 * a SecurityError after roughly 100 calls in 30 seconds. The playhead is a
 * signal driven by requestAnimationFrame, and a scrub drag moves it once per
 * pointer event, so an unthrottled write per frame breaks the page rather than
 * just costing time. One write every 500 ms stays an order of magnitude clear of
 * that ceiling while keeping a copied address current enough to share.
 */
export const DEEP_LINK_WRITE_INTERVAL_MS = 500;

let pendingState: DeepLinkState | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastWriteMs = Number.NEGATIVE_INFINITY;

function flushPending(): void {
  pendingTimer = null;
  if (pendingState === null) return;
  const state = pendingState;
  pendingState = null;
  lastWriteMs = Date.now();
  writeDeepLink(state);
}

/**
 * Write the URL at most once per <DEEP_LINK_WRITE_INTERVAL_MS>, keeping the
 * newest state.
 *
 * Trailing rather than leading-only: the last position of a scrub is the one
 * worth sharing, so the final call always lands even if it arrived inside the
 * quiet window.
 */
export function writeDeepLinkThrottled(state: DeepLinkState): void {
  pendingState = state;

  if (pendingTimer !== null) return;

  const elapsed = Date.now() - lastWriteMs;
  if (elapsed >= DEEP_LINK_WRITE_INTERVAL_MS) {
    flushPending();
    return;
  }

  pendingTimer = setTimeout(flushPending, DEEP_LINK_WRITE_INTERVAL_MS - elapsed);
}

/**
 * Write any state still waiting and stop the throttle.
 *
 * Called when playback is torn down, so the pending timer cannot fire against a
 * page that has already navigated away and rewrite the URL of wherever the
 * viewer went next.
 */
export function cancelThrottledDeepLink(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingState = null;
  lastWriteMs = Number.NEGATIVE_INFINITY;
}

/** The absolute link to share for a state. */
export function deepLinkUrl(state: DeepLinkState): string {
  const search = buildDeepLinkSearch(state);
  return `${window.location.origin}${window.location.pathname}${search}`;
}
