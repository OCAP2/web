import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { BookmarkMenu } from "../BookmarkMenu";
import { loadBookmarks, addBookmark, bookmarks } from "../../bookmarks";
import { createTestEngine, TestProviders, unitDef, makeManifest } from "../../__tests__/testHelpers";

function setup() {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest([unitDef()], [], 100));
  loadBookmarks("rec-1");
  engine.seekTo(42);
  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <BookmarkMenu timeMode={() => "elapsed"} />
    </TestProviders>
  ));
  return { engine };
}

function openPanel() {
  fireEvent.click(screen.getByTitle("Bookmarks"));
}

afterEach(() => {
  cleanup();
  loadBookmarks(null);
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("BookmarkMenu", () => {
  it("opens the panel and shows the empty state when there are no bookmarks", () => {
    setup();
    openPanel();
    expect(screen.getByText("No bookmarks yet")).toBeTruthy();
  });

  it("adds a bookmark from the draft input on Enter", () => {
    setup();
    openPanel();
    const input = screen.getByPlaceholderText("Label this moment") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "First push" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("First push")).toBeTruthy();
  });

  it("labels an unnamed bookmark with the frame time", () => {
    setup();
    openPanel();
    fireEvent.click(screen.getByText("Add"));
    // Empty draft falls back to the frame's label; assert through the store.
    const list = bookmarks();
    expect(list).toHaveLength(1);
    expect(list[0].frame).toBe(42);
    expect(list[0].label).not.toBe("");
  });

  it("removes a bookmark via the trash button", () => {
    setup();
    addBookmark(10, "to remove");
    openPanel();
    expect(screen.getByText("to remove")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Remove bookmark"));
    expect(screen.queryByText("to remove")).toBeNull();
  });

  it("copy link writes to the clipboard and switches the label to 'copied'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    setup();
    openPanel();
    fireEvent.click(screen.getByText("Copy link to this moment"));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByText("Link copied!")).toBeTruthy();
  });

  it("jumps to a bookmark's frame", () => {
    const { engine } = setup();
    const b = addBookmark(7, "early");
    openPanel();
    fireEvent.click(screen.getByText("early"));
    expect(engine.currentFrame()).toBe(7);
    expect(screen.queryByText("early")).toBeNull();
    void b;
  });
});
