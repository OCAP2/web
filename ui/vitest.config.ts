import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    {
      name: "fix-solid-refresh-path",
      enforce: "pre",
      // On Windows, fileURLToPath rejects 'file:///@solid-refresh' because the path
      // has no drive letter. Redirect to the actual file before solidPlugin's resolveId
      // returns the virtual ID, so the module ID is always a real file path.
      resolveId(id: string) {
        if (id === "/@solid-refresh") {
          return require.resolve("solid-refresh/dist/solid-refresh.mjs");
        }
      },
    },
    solidPlugin(),
  ],
  resolve: {
    conditions: ["development", "browser"],
    dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/testSetup.ts"],
    server: {
      deps: {
        inline: [/@solidjs\//],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.{ts,tsx}",
        "src/testSetup.ts",
        "src/**/generated/**",
        // Type-only / interface-only files (no runtime code)
        "src/**/*.d.ts",
        "src/playback/types.ts",
        "src/playback/signals.ts",
        "src/renderers/renderer.interface.ts",
        "src/renderers/renderer.types.ts",
        "src/data/decoders/decoder.interface.ts",
        "src/data/types.ts",
        // Barrel exports
        "src/pages/*/index.tsx",
        // Static / declarative files (pure SVG icons, constants)
        "src/components/Icons.tsx",
        "src/pages/recording-selector/OcapLogoSvg.tsx",
        "src/pages/recording-selector/constants.ts",
        // Entry point (side-effectful, tested via App.test.tsx)
        "src/main.tsx",
        // Leaflet renderers (init() requires real browser DOM, not testable in jsdom)
        "src/renderers/leaflet/leafletRenderer.ts",
        "src/renderers/leaflet/canvasLeafletRenderer.ts",
        "src/renderers/leaflet/leafletGrid.ts",
      ],
    },
  },
});
