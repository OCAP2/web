import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    proxy: {
      "/api": "http://localhost:5000",
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
