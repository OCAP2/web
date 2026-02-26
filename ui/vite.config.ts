import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  base: "./",
  server: {
    proxy: {
      "/api/v1/maptool/events": {
        target: "http://localhost:5000",
        // SSE needs no timeout and no buffering
        timeout: 0,
        proxyTimeout: 0,
        headers: { "X-Forwarded-Host": "localhost:5173" },
      },
      "/api": {
        target: "http://localhost:5000",
        // Pass the browser's Host so Steam callback URLs point back here
        headers: { "X-Forwarded-Host": "localhost:5173" },
      },
      "/data": "http://localhost:5000",
      "/file": "http://localhost:5000",
      "/images": "http://localhost:5000",
    },
  },
  build: {
    target: "es2020",
    outDir: "../internal/frontend/dist",
    emptyOutDir: true,
  },
});
