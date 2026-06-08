import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// In dev, Vite serves the UI on :5173 and proxies API + WebSocket to the engine
// on :8787. In production the engine serves the built UI itself (engine/server.ts).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/term": { target: "ws://localhost:8787", ws: true },
    },
  },
});
