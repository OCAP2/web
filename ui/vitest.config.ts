import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
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
        "src/pages/recording-playback/components/Icons.tsx",
        "src/pages/recording-selector/icons.tsx",
        "src/pages/recording-selector/OcapLogoSvg.tsx",
        "src/pages/recording-selector/constants.ts",
        // Entry point (side-effectful, tested via App.test.tsx)
        "src/main.tsx",
        // Leaflet renderer (requires real browser DOM, not testable in jsdom)
        "src/renderers/leaflet/leafletRenderer.ts",
        "src/renderers/leaflet/leafletGrid.ts",
      ],
    },
  },
});
