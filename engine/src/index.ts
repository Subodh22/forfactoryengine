import "./env"; // load .env before anything reads process.env
import { initSchema, syncNow, cloudSyncEnabled } from "./db";
import { startServer } from "./server";
import { pickupPending } from "./runner";
import { authEnabled } from "./auth";

const PORT = Number(process.env.PORT ?? 8787);
const SYNC_MS = 4000;

await initSchema();
startServer(PORT);

// Drive the engine: sync the Turso replica (if configured), then pick up any
// pending jobs — including ones created remotely from the Vercel control app.
// Also re-runs jobs left pending after a restart.
async function tick(): Promise<void> {
  if (cloudSyncEnabled) await syncNow();
  await pickupPending();
}
await tick();
setInterval(() => void tick(), SYNC_MS);

console.log(
  "Factory engine ready — libSQL + WebSocket" +
    (cloudSyncEnabled ? " + Turso sync (control from anywhere)" : "") +
    (authEnabled ? " · auth ON" : " · auth OFF (local only)") +
    ".",
);
