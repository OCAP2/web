/**
 * Runtime base path injected by the Go backend into index.html.
 * Falls back to "/" when running outside the embedded server (dev, tests).
 */
export const basePath: string = (
  ((globalThis as Record<string, unknown>).__BASE_PATH__ as string) ?? ""
).replace(/\/+$/, "") + "/";
