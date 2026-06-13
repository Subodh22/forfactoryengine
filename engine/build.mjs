import { build } from "esbuild";

// Bundle the engine (TypeScript) into a single runnable JS file so production
// installs don't need tsx/ts at runtime — just `node dist/factory.mjs`.
//
// @libsql/client (and its libsql native binary) are kept EXTERNAL: native .node
// binaries can't be inlined, so they're resolved from node_modules at runtime.
// node-pty is external for the same reason — it loads pty.node relative to its
// own package dir, which only works when required from node_modules (inlining it
// breaks that path resolution, so the engine can't even boot).
// ws's optional native accelerators are external too (ws works without them).
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/factory.mjs",
  external: ["@libsql/client", "libsql", "node-pty", "bufferutil", "utf-8-validate"],
  // Some bundled deps use CommonJS `require`; provide it in the ESM output.
  banner: { js: "import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);" },
  logLevel: "info",
});

console.log("✓ engine bundled → dist/factory.mjs");
