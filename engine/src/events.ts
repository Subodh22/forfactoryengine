import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Job, Project } from "./db";
import { checkAuth } from "./auth";
import { appendOutput } from "./output-log";

// The live wire. The engine owns every write, so it broadcasts each change to all
// connected clients over WebSocket — this replaces Convex's reactive queries AND
// the reference's separate SSE server. The UI loads a snapshot once, then applies
// these events; terminal output, chat bubbles, and shell output all stream here.
export type ServerEvent =
  | { type: "hello" }
  | { type: "project.created"; project: Project }
  | { type: "project.updated"; project: Project }
  | { type: "project.removed"; id: string }
  | { type: "job.created"; job: Job }
  | { type: "job.updated"; job: Job }
  | { type: "job.removed"; id: string }
  // Raw terminal output for a job (Claude agent stream, colour-coded chunks).
  | { type: "job.output"; jobId: string; chunk: string }
  // A full assistant/user chat turn → rendered as a bubble in the chat thread.
  | { type: "job.chat"; jobId: string; role: "assistant" | "user"; text: string; images?: string[] }
  // Web-terminal output, keyed by the terminal session id.
  | { type: "term.output"; sessionId: string; text: string };

let wss: WebSocketServer | null = null;

export function attachWebsocket(server: Server): void {
  wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: (info, done) => done(checkAuth(info.req)),
  });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "hello" } satisfies ServerEvent));
  });
}

export function broadcast(event: ServerEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

// Convenience helpers mirroring the reference's sse-server API so the runner /
// delegator / terminal read naturally.
export function emitOutput(jobId: string, chunk: string): void {
  appendOutput(jobId, chunk); // durable log, before broadcasting the live chunk
  broadcast({ type: "job.output", jobId, chunk });
}
export function emitChat(jobId: string, role: "assistant" | "user", text: string, images?: string[]): void {
  broadcast({ type: "job.chat", jobId, role, text, images });
}
export function emitTerm(sessionId: string, text: string): void {
  broadcast({ type: "term.output", sessionId, text });
}
