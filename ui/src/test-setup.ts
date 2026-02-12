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
