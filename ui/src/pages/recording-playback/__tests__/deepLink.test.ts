import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  DEEP_LINK_WRITE_INTERVAL_MS,
  asDeepLinkTab,
  buildDeepLinkSearch,
  cancelThrottledDeepLink,
  readDeepLink,
  writeDeepLinkThrottled,
} from "../deepLink";

describe("readDeepLink", () => {
  it("reads frame, unit, tab and side", () => {
    expect(readDeepLink("?t=1200&u=7&tab=comms&side=EAST")).toEqual({
      frame: 1200,
      unit: 7,
      tab: "comms",
      side: "EAST",
    });
  });

  it("ignores parameters that are absent", () => {
    expect(readDeepLink("?tab=units")).toEqual({ tab: "units" });
  });

  it("rejects a frame that is not a usable number", () => {
    expect(readDeepLink("?t=abc")).toEqual({});
    expect(readDeepLink("?t=-5")).toEqual({});
  });

  it("floors a fractional frame rather than seeking between frames", () => {
    expect(readDeepLink("?t=12.7").frame).toBe(12);
  });

  it("accepts frame zero, which is the start of the recording", () => {
    expect(readDeepLink("?t=0").frame).toBe(0);
  });

  // ── Untrusted input ──
  //
  // A link is typed, truncated by chat clients and edited by hand. Anything that
  // is not a value the app actually has has to be dropped here, because the
  // consumers cast rather than check: an unknown tab id matches no panel and
  // renders an empty sidebar, and a bogus side reaches a colour lookup typed as
  // if it were a real one.

  it("drops a tab that is not a real panel", () => {
    expect(readDeepLink("?tab=nonsense")).toEqual({});
    expect(readDeepLink("?tab=")).toEqual({});
  });

  it("keeps every tab the side panel actually has", () => {
    for (const tab of ["units", "events", "orbat", "comms", "stats", "fps"]) {
      expect(readDeepLink(`?tab=${tab}`).tab).toBe(tab);
    }
  });

  it("drops a side that is not a real side, including a lowercase one", () => {
    expect(readDeepLink("?side=nonsense")).toEqual({});
    expect(readDeepLink("?side=west")).toEqual({});
    expect(readDeepLink("?side=")).toEqual({});
  });

  it("keeps every side the filter actually has", () => {
    for (const side of ["WEST", "EAST", "GUER", "CIV", "VIRTUAL"]) {
      expect(readDeepLink(`?side=${side}`).side).toBe(side);
    }
  });

  it("keeps the readable half of a link whose other half is junk", () => {
    // Losing the whole link because one parameter was mangled would be worse
    // than landing on the right frame with the default panel open.
    expect(readDeepLink("?t=900&tab=nonsense&side=WEST")).toEqual({
      frame: 900,
      side: "WEST",
    });
  });

  it("does not read a blank parameter as frame zero", () => {
    // Number("") is 0, so a truncated "?t=" would otherwise yank the viewer
    // back to the start of the recording.
    expect(readDeepLink("?t=&u=").frame).toBeUndefined();
    expect(readDeepLink("?t=&u=").unit).toBeUndefined();
  });

  it("ignores parameters it does not own", () => {
    expect(readDeepLink("?renderer=dom&t=5")).toEqual({ frame: 5 });
  });
});

describe("asDeepLinkTab", () => {
  it("passes a real tab through and rejects anything else", () => {
    expect(asDeepLinkTab("stats")).toBe("stats");
    expect(asDeepLinkTab("nonsense")).toBeUndefined();
    expect(asDeepLinkTab(null)).toBeUndefined();
    expect(asDeepLinkTab(undefined)).toBeUndefined();
  });
});

describe("buildDeepLinkSearch", () => {
  it("round-trips through readDeepLink", () => {
    const state = { frame: 940, unit: 3, tab: "orbat", side: "WEST" } as const;
    expect(readDeepLink(buildDeepLinkSearch(state, ""))).toEqual(state);
  });

  it("keeps parameters the playback page does not own", () => {
    // `renderer` selects the map renderer and has to survive a shared link.
    const search = buildDeepLinkSearch({ frame: 10 }, "?renderer=canvas");
    expect(search).toContain("renderer=canvas");
    expect(search).toContain("t=10");
  });

  it("drops a parameter whose value is gone, so an unfollowed unit clears", () => {
    const search = buildDeepLinkSearch({ frame: 10 }, "?t=5&u=7");
    expect(search).not.toContain("u=");
    expect(search).toContain("t=10");
  });

  it("returns an empty string rather than a bare question mark", () => {
    expect(buildDeepLinkSearch({}, "")).toBe("");
  });

  it("scrubs a junk value out of a key it owns, so the URL self-heals", () => {
    // readDeepLink rejected the bogus tab, so the app's state carries none, and
    // the next write clears it from the address rather than leaving a link that
    // keeps handing the same junk to whoever it is pasted to.
    const search = buildDeepLinkSearch({ frame: 1 }, "?tab=nonsense");
    expect(search).not.toContain("tab=");
    expect(search).toContain("t=1");
  });

  it("leaves keys it does not own untouched, junk or not", () => {
    const search = buildDeepLinkSearch({ frame: 1 }, "?renderer=nonsense");
    expect(search).toContain("renderer=nonsense");
  });
});

// ── Write throttling ──
//
// replaceState is rate limited by the browser, not merely slow: Safari throws a
// SecurityError past roughly 100 calls in 30 seconds. The playhead is a signal
// driven by requestAnimationFrame and a scrub drag moves it per pointer event,
// so the write has to coalesce or the page breaks rather than just costing time.
describe("writeDeepLinkThrottled", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    cancelThrottledDeepLink();
    replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    cancelThrottledDeepLink();
    replaceState.mockRestore();
    vi.useRealTimers();
  });

  it("writes the first call straight through", () => {
    writeDeepLinkThrottled({ frame: 1 });
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of frames into far fewer writes than calls", () => {
    // Roughly what a scrub drag looks like: one call per pointer event.
    for (let frame = 0; frame < 300; frame++) writeDeepLinkThrottled({ frame });
    vi.advanceTimersByTime(DEEP_LINK_WRITE_INTERVAL_MS);

    expect(replaceState.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("stays under the browser's rate limit across a long scrub", () => {
    // Thirty seconds of a 60fps playhead is 1800 calls. Safari's ceiling is
    // about 100 replaceState calls in that window.
    for (let tick = 0; tick < 1800; tick++) {
      writeDeepLinkThrottled({ frame: tick });
      vi.advanceTimersByTime(1000 / 60);
    }

    expect(replaceState.mock.calls.length).toBeLessThan(100);
  });

  it("eventually writes the newest state, not a stale one", () => {
    writeDeepLinkThrottled({ frame: 1 });
    writeDeepLinkThrottled({ frame: 2 });
    writeDeepLinkThrottled({ frame: 3 });
    vi.advanceTimersByTime(DEEP_LINK_WRITE_INTERVAL_MS);

    const lastUrl = String(replaceState.mock.calls.at(-1)?.[2]);
    expect(lastUrl).toContain("t=3");
  });

  it("lands the final position of a drag rather than dropping it", () => {
    // Trailing, not leading-only: the frame the viewer stopped on is the one
    // worth sharing, and it arrives inside the quiet window.
    writeDeepLinkThrottled({ frame: 10 });
    writeDeepLinkThrottled({ frame: 999 });
    expect(String(replaceState.mock.calls.at(-1)?.[2])).not.toContain("t=999");

    vi.advanceTimersByTime(DEEP_LINK_WRITE_INTERVAL_MS);
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain("t=999");
  });

  it("never writes a queued state after teardown", () => {
    // A timer firing after the viewer navigated away would rewrite the URL of
    // whatever page they landed on.
    writeDeepLinkThrottled({ frame: 1 });
    replaceState.mockClear();

    writeDeepLinkThrottled({ frame: 2 });
    cancelThrottledDeepLink();
    vi.advanceTimersByTime(DEEP_LINK_WRITE_INTERVAL_MS * 10);

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("writes immediately again once the quiet window has passed", () => {
    writeDeepLinkThrottled({ frame: 1 });
    vi.advanceTimersByTime(DEEP_LINK_WRITE_INTERVAL_MS);
    replaceState.mockClear();

    writeDeepLinkThrottled({ frame: 2 });
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("uses replaceState, so scrubbing never fills the back button", () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    writeDeepLinkThrottled({ frame: 1 });
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });
});
