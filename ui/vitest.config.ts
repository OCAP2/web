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
      ],
    },
  },
});
