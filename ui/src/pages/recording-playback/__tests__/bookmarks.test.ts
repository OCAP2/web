import { describe, it, expect, beforeEach } from "vitest";

import {
  addBookmark,
  bookmarks,
  loadBookmarks,
  removeBookmark,
  renameBookmark,
} from "../bookmarks";

describe("bookmarks", () => {
  beforeEach(() => {
    window.localStorage.clear();
    loadBookmarks("mission-a");
  });

  it("starts empty for a recording with nothing saved", () => {
    expect(bookmarks()).toEqual([]);
  });

  it("keeps bookmarks in frame order regardless of insertion order", () => {
    addBookmark(500, "later");
    addBookmark(100, "earlier");
    expect(bookmarks().map((b) => b.frame)).toEqual([100, 500]);
  });

  it("persists across a reload of the same recording", () => {
    addBookmark(250, "contact");
    loadBookmarks("mission-a");
    expect(bookmarks()).toHaveLength(1);
    expect(bookmarks()[0].label).toBe("contact");
  });

  it("keeps recordings separate", () => {
    addBookmark(250, "contact");
    loadBookmarks("mission-b");
    expect(bookmarks()).toEqual([]);
    loadBookmarks("mission-a");
    expect(bookmarks()).toHaveLength(1);
  });

  it("clears without touching storage when no recording is open", () => {
    addBookmark(250, "contact");
    loadBookmarks(null);
    expect(bookmarks()).toEqual([]);
    loadBookmarks("mission-a");
    expect(bookmarks()).toHaveLength(1);
  });

  it("removes and renames", () => {
    const first = addBookmark(10, "one");
    addBookmark(20, "two");

    renameBookmark(first.id, "renamed");
    expect(bookmarks().find((b) => b.id === first.id)?.label).toBe("renamed");

    removeBookmark(first.id);
    expect(bookmarks().map((b) => b.label)).toEqual(["two"]);
  });

  it("survives junk in storage rather than breaking playback", () => {
    window.localStorage.setItem("ocap.bookmarks.mission-c", "{not json");
    loadBookmarks("mission-c");
    expect(bookmarks()).toEqual([]);

    window.localStorage.setItem(
      "ocap.bookmarks.mission-d",
      JSON.stringify([{ id: "a", frame: 5, label: "ok" }, { nonsense: true }, 42]),
    );
    loadBookmarks("mission-d");
    expect(bookmarks()).toHaveLength(1);
  });
});
