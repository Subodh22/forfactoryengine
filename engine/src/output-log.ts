import fs from "node:fs";
import path from "node:path";

// Durable, append-only record of each job's raw agent output. The WebSocket
// stream (events.ts) is for live tailing; this file is what survives a reload,
// tab switch, or engine restart so a finished job can be reopened and replayed.
// Stored on local disk under the engine's data dir — no DB/Turso traffic.
const dataDir = process.env.FACTORY_DATA_DIR ?? process.cwd();
const logDir = path.join(dataDir, "logs");
try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

// jobIds are uuids; sanitise anyway so a request path can never escape logDir.
function logPath(jobId: string): string {
  return path.join(logDir, `${jobId.replace(/[^a-zA-Z0-9_-]/g, "")}.log`);
}

export function appendOutput(jobId: string, chunk: string): void {
  if (!jobId) return;
  try { fs.appendFileSync(logPath(jobId), chunk); } catch { /* non-fatal */ }
}

export function readOutput(jobId: string): string {
  try { return fs.readFileSync(logPath(jobId), "utf8"); } catch { return ""; }
}

export function clearOutput(jobId: string): void {
  try { fs.rmSync(logPath(jobId)); } catch { /* ignore */ }
}
