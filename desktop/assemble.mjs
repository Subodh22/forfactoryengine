// Copy the freshly-built engine bundle + UI into desktop/resources so
// electron-builder packs them into the app. Run after `npm run build` at the root.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RES = path.join(HERE, "resources");

const engineBundle = path.join(ROOT, "engine", "dist", "factory.mjs");
const uiDist = path.join(ROOT, "ui", "dist");

if (!existsSync(engineBundle)) throw new Error("engine bundle missing — run `npm run build:engine` first");
if (!existsSync(uiDist)) throw new Error("UI build missing — run `npm run build:ui` first");

rmSync(RES, { recursive: true, force: true });
mkdirSync(path.join(RES, "engine"), { recursive: true });
cpSync(engineBundle, path.join(RES, "engine", "factory.mjs"));
cpSync(uiDist, path.join(RES, "ui"), { recursive: true });

// The engine bundle keeps native deps (@libsql/client, libsql, node-pty) EXTERNAL
// — they load .node binaries that can't be inlined. Ship the engine's node_modules
// next to the bundle so `require()` resolves them (and their transitive deps:
// @neon-rs, detect-libc, the @libsql/<platform> binary, …) at runtime. ~90MB; the
// build-only tooling (esbuild/tsx) is dead weight but harmless for a local app.
const engineNodeModules = path.join(ROOT, "engine", "node_modules");
if (!existsSync(engineNodeModules)) throw new Error("engine node_modules missing — run `npm install` in engine/");
cpSync(engineNodeModules, path.join(RES, "engine", "node_modules"), { recursive: true });

console.log("✓ assembled desktop/resources (engine + ui + native deps)");
