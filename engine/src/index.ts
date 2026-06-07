import "./env"; // load .env before anything reads process.env
import { initSchema, cloudSyncEnabled } from "./db";
import { startServer } from "./server";
import { pickupPending } from "./runner";
import { authEnabled } from "./auth";

const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = 4000;

await initSchema();
startServer(PORT);

// Poll for pending jobs — including ones created from the Vercel site (written
// straight to the shared Turso DB). Also re-runs jobs left pending on restart.
await pickupPending();
setInterval(() => void pickupPending(), POLL_MS);

console.log(
  "Factory engine ready — " +
    (cloudSyncEnabled ? "connected to Turso (control from anywhere)" : "local libSQL") +
    (authEnabled ? " · auth ON" : "") +
    ".",
);
