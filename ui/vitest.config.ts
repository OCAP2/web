import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    transformMode: {
      web: [/\.[jt]sx?$/],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
      ],
    },
  },
});
