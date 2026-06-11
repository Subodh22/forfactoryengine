import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// In dev, Vite serves the UI on :5173 and proxies API + WebSocket to the engine
// on :8787. In production the engine serves the built UI itself (engine/server.ts).
// All components live in packages/ui-core (shared with web/); "@" points there.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "../packages/ui-core/src") },
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // "use client" directives (needed by Next) are meaningless to Rollup.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, "..")] }, // serve ../packages/ui-core sources
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/term": { target: "ws://localhost:8787", ws: true },
    },
  },
});
