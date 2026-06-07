import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Job, Project } from "./db";
import { checkAuth } from "./auth";

// The live wire. The engine owns every write, so it broadcasts each change to all
// connected clients over WebSocket — this replaces Convex's reactive queries. The
// UI loads a snapshot once, then applies these events.
export type ServerEvent =
  | { type: "hello" }
  | { type: "project.created"; project: Project }
  | { type: "job.created"; job: Job }
  | { type: "job.updated"; job: Job }
  | { type: "job.output"; jobId: string; chunk: string };

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
