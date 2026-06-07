/** @type {import('next').NextConfig} */
const nextConfig = {
  // The web app is a thin client of the Factory engine (REST + WebSocket); it
  // talks to no database directly, so no server-only externals are needed.
  // Pin the tracing root to this app (the monorepo has multiple lockfiles).
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
