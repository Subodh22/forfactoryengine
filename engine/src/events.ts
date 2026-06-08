import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Job, Project } from "./db";
import { checkAuth } from "./auth";
import { appendOutput } from "./output-log";
import { handleTerminalConnection } from "./terminal";

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
  // Two endpoints on one HTTP server: /ws is the live event bus (broadcast),
  // /term is a raw PTY pipe (one socket ↔ one pseudo-terminal). We route upgrades
  // by path manually so each gets its own WebSocketServer.
  const eventWss = new WebSocketServer({ noServer: true });
  const termWss = new WebSocketServer({ noServer: true });
  wss = eventWss;

  eventWss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "hello" } satisfies ServerEvent));
  });
  termWss.on("connection", (socket, req) => handleTerminalConnection(socket, req));

  server.on("upgrade", (req, socket, head) => {
    let pathname: string;
    try { pathname = new URL(req.url ?? "", "http://localhost").pathname; }
    catch { socket.destroy(); return; }

    if (pathname !== "/ws" && pathname !== "/term") { socket.destroy(); return; }
    if (!checkAuth(req)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }

    const target = pathname === "/term" ? termWss : eventWss;
    target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
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
