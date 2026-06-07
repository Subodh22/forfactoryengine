import "./env"; // load .env before anything reads process.env
import { initSchema, cloudSyncEnabled } from "./db";
import { startServer } from "./server";
import { pickupQueued, recoverOrphans } from "./runner";
import { authEnabled } from "./auth";

const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = 4000;

await initSchema();
startServer(PORT);

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
