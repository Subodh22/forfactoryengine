import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The web app is a thin client of the Factory engine (REST + WebSocket); it
  // talks to no database directly, so no server-only externals are needed.
  // Pin the tracing root to this app (the monorepo has multiple lockfiles).
  outputFileTracingRoot: import.meta.dirname,
  // All components live in packages/ui-core, shared with the Vite app (ui/).
  // tsconfig paths cover the type-checker; this covers webpack resolution.
  webpack: (config) => {
    config.resolve.alias["@"] = path.resolve(import.meta.dirname, "../packages/ui-core/src");
    return config;
  },
};

export default nextConfig;
