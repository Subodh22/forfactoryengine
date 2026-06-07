import type http from "node:http";

// When FACTORY_AUTH_TOKEN is set (required for any online deployment), every
// /api request and WebSocket connection must present it — as `Authorization:
// Bearer <token>` or a `?token=` query param (for WebSocket/EventSource, which
// can't set headers). When unset (local dev), everything is open.
const TOKEN = process.env.FACTORY_AUTH_TOKEN?.trim();

export const authEnabled = Boolean(TOKEN);

export function checkAuth(req: http.IncomingMessage): boolean {
  if (!TOKEN) return true;
  const header = req.headers["authorization"];
  if (typeof header === "string" && header === `Bearer ${TOKEN}`) return true;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.searchParams.get("token") === TOKEN) return true;
  } catch { /* malformed url */ }
  return false;
}
