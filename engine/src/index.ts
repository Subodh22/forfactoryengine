import "./env"; // load .env before anything reads process.env
import { initSchema, cloudSyncEnabled } from "./db";
import { startServer } from "./server";
import { pickupQueued, recoverOrphans, drainForShutdown } from "./runner";
import { killAllClaudeProcs } from "./agent/claude-runner";
import { authEnabled } from "./auth";

const PORT = Number(process.env.PORT ?? 8787);
// New jobs are enqueued in-process the instant they're created via the API
// (server.ts) or promoted by the delegator, so the engine no longer needs a fast
// poll to discover work. This periodic sweep is now only a safety net — it picks
// up jobs left "queued" by a restart or an out-of-band Turso writer — so it can
// run slowly. Raising it from 4s → 30s cuts idle Turso reads ~87% with no effect
// on job-start latency. Override (e.g. lower it if a second engine shares the DB)
// with FACTORY_POLL_MS.
const POLL_MS = Number(process.env.FACTORY_POLL_MS ?? 30_000);

// Safe-by-default: the engine runs Claude with shell access and exposes a
// terminal/exec endpoint, so binding to a public interface without an auth token
// would hand anyone on the network a root shell. Refuse to start in that case.
const HOST = process.env.FACTORY_HOST ?? "127.0.0.1";
const isLoopback = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
if (!isLoopback && !authEnabled) {
  console.error(
    "\n✗ Refusing to start: FACTORY_HOST is set to a public interface (" + HOST + ") but\n" +
    "  FACTORY_AUTH_TOKEN is not set. The engine runs coding agents and a shell\n" +
    "  endpoint, so a public bind without a token is unsafe.\n\n" +
    "  Fix: set FACTORY_AUTH_TOKEN to a long random secret, or bind to 127.0.0.1.\n" +
    "  e.g.  FACTORY_AUTH_TOKEN=$(openssl rand -hex 24)\n",
  );
  process.exit(1);
}

await initSchema();
const server = startServer(PORT);

// Graceful shutdown: stop dispatching, kill agent processes, re-queue in-flight
// jobs (so the next boot resumes them), then close. A hard deadline guarantees
// the process exits even if a handle hangs.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[factory] ${signal} — draining: agents stopped, in-flight jobs re-queued for next start.`);
  setTimeout(() => process.exit(1), 15_000).unref();
  killAllClaudeProcs();
  void drainForShutdown()
    .catch((err) => console.error(`[factory] drain failed: ${err}`))
    .finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Recover jobs the previous engine left "running" when it stopped — otherwise
// they'd show RUNNING forever and never finish. Runs once, before the poll.
await recoverOrphans();

// Poll for queued jobs — including ones created from a hosted site (written
// straight to the shared Turso DB). Also re-runs jobs left queued on restart.
await pickupQueued();
setInterval(() => void pickupQueued(), POLL_MS);

console.log(
  "Factory engine ready — " +
    (cloudSyncEnabled ? "connected to Turso (control from anywhere)" : "local libSQL") +
    (authEnabled ? " · auth ON" : "") +
    ".",
);
