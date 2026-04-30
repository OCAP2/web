// Node.js v22.12+ exposes localStorage as a native global. In v25 it is SQLite-backed
// and requires --localstorage-file; without it the object exists but getItem/setItem
// are not functions, which breaks jsdom's own storage mock. Replace it with a plain
// in-memory store whenever the native version is broken.
if (
  typeof localStorage !== "undefined" &&
  typeof localStorage.getItem !== "function"
) {
  const _store: Record<string, string> = Object.create(null);
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => _store[key] ?? null,
      setItem: (key: string, value: string) => {
        _store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete _store[key];
      },
      clear: () => {
        for (const k in _store) delete _store[k];
      },
      get length() {
        return Object.keys(_store).length;
      },
      key: (i: number) => Object.keys(_store)[i] ?? null,
    } satisfies Storage,
    writable: true,
    configurable: true,
  });
}

// Polyfill ResizeObserver for JSDOM (needed by @tanstack/virtual)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      // Fire initial measurement so virtualizers get a non-zero rect
      this.cb(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [{ inlineSize: 800, blockSize: 800 }],
            contentBoxSize: [{ inlineSize: 800, blockSize: 800 }],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  };
}

// JSDOM has no layout engine, so getBoundingClientRect returns all zeros.
// TanStack Virtual reads the scroll container rect from this — give a default size.
const _origGetBCR = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const r = _origGetBCR.call(this);
  if (r.width === 0 && r.height === 0) {
    return new DOMRect(0, 0, 800, 600);
  }
  return r;
};
