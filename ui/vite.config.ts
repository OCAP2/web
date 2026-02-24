import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    proxy: {
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
