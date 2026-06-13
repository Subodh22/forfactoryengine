import fs from "node:fs";
import path from "node:path";

// Durable, append-only record of each job's chat turns (assistant + user), so a
// conversation survives a reload, tab switch, or engine restart. The WebSocket
// `job.chat` stream is for live bubbles; this JSONL file is what's replayed when
// a job is reopened. Mirrors output-log.ts. Stored on local disk.
const dataDir = process.env.FACTORY_DATA_DIR ?? process.cwd();
const logDir = path.join(dataDir, "logs");
try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

export interface ChatEntry { role: "assistant" | "user"; text: string; images?: string[]; ts: number }

function chatPath(jobId: string): string {
  return path.join(logDir, `${jobId.replace(/[^a-zA-Z0-9_-]/g, "")}.chat.jsonl`);
}

export function appendChat(jobId: string, role: "assistant" | "user", text: string, images?: string[]): void {
  if (!jobId) return;
  const entry: ChatEntry = { role, text, ...(images && images.length ? { images } : {}), ts: Date.now() };
  try { fs.appendFileSync(chatPath(jobId), `${JSON.stringify(entry)}\n`); } catch { /* non-fatal */ }
}

export function readChat(jobId: string): ChatEntry[] {
  try {
    return fs.readFileSync(chatPath(jobId), "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as ChatEntry);
  } catch { return []; }
}

export function clearChat(jobId: string): void {
  try { fs.rmSync(chatPath(jobId)); } catch { /* ignore */ }
}
