import { initSchema, startSync, cloudSyncEnabled } from "./db";
import { startServer } from "./server";
import { authEnabled } from "./auth";

const PORT = Number(process.env.PORT ?? 8787);

await initSchema();
startSync(); // no-op unless TURSO_DATABASE_URL is set
startServer(PORT);

console.log(
  "Factory engine ready — libSQL + WebSocket" +
    (cloudSyncEnabled ? " + Turso sync" : "") +
    (authEnabled ? " · auth ON" : " · auth OFF (local only)") +
    ".",
);
