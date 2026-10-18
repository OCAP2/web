import { createSignal } from "solid-js";

/**
 * Playback bookmarks.
 *
 * A bookmark is a frame plus a label, kept per recording in localStorage. They
 * never leave the browser: a recording is served as one immutable file and there
 * is no API to write anything back, so this is deliberately a local convenience
 * rather than shared state. Sharing a moment is what the deep link is for.
 */

export interface Bookmark {
  id: string;
  frame: number;
  label: string;
  createdAt: number;
}

const STORAGE_PREFIX = "ocap.bookmarks.";

/** Bookmarks for the recording currently open, frame-ordered. */
export const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([]);

let currentKey: string | null = null;

function storageKey(recording: string): string {
  return STORAGE_PREFIX + recording;
}

function persist(list: Bookmark[]): void {
  if (!currentKey) return;
  try {
    window.localStorage.setItem(currentKey, JSON.stringify(list));
  } catch {
    // Private windows and blocked site data both throw here. Losing bookmarks
    // is not worth breaking playback over.
  }
}

/**
 * Point the store at a recording, loading whatever was saved for it. Passing
 * null (no recording open) empties the list without touching storage.
 */
export function loadBookmarks(recording: string | null): void {
  if (!recording) {
    currentKey = null;
    setBookmarks([]);
    return;
  }

  currentKey = storageKey(recording);
  let stored: Bookmark[] = [];
  try {
    const raw = window.localStorage.getItem(currentKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stored = parsed.filter(
          (b): b is Bookmark =>
            !!b &&
            typeof b === "object" &&
            typeof (b as Bookmark).id === "string" &&
            typeof (b as Bookmark).frame === "number" &&
            typeof (b as Bookmark).label === "string",
        );
      }
    }
  } catch {
    stored = [];
  }

  setBookmarks(stored.sort((a, b) => a.frame - b.frame));
}

export function addBookmark(frame: number, label: string): Bookmark {
  const bookmark: Bookmark = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    frame,
    label: label.trim(),
    createdAt: Date.now(),
  };
  const next = [...bookmarks(), bookmark].sort((a, b) => a.frame - b.frame);
  setBookmarks(next);
  persist(next);
  return bookmark;
}

export function removeBookmark(id: string): void {
  const next = bookmarks().filter((b) => b.id !== id);
  setBookmarks(next);
  persist(next);
}

export function renameBookmark(id: string, label: string): void {
  const next = bookmarks().map((b) => (b.id === id ? { ...b, label: label.trim() } : b));
  setBookmarks(next);
  persist(next);
}
