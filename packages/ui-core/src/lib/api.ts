"use client";
// REST + WebSocket client for the Factory engine. The engine base URL is set
// once at app startup via configureEngine():
//   ui/  → VITE_ENGINE_URL, default "" (same-origin: Vite proxies in dev, the
//          engine serves the built UI in prod)
//   web/ → NEXT_PUBLIC_ENGINE_URL, default http://localhost:8787 (remote client)

let ENGINE_URL = "";

/** Point this client at an engine. Call once from the app entry, before any
 *  component fetches. An empty string means same-origin. */
export function configureEngine(url: string): void {
  ENGINE_URL = url.replace(/\/$/, "");
}

/** The configured engine base URL ("" = same-origin). */
export function engineUrl(): string {
  return ENGINE_URL;
}

const tokenKey = "factory-token";
export const getToken = () => (typeof localStorage !== "undefined" ? localStorage.getItem(tokenKey) ?? "" : "");
export const setToken = (t: string) => localStorage.setItem(tokenKey, t);
export const clearToken = () => localStorage.removeItem(tokenKey);

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(`${ENGINE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (r.status === 401) {
    clearToken();
    location.reload();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? r.statusText);
  return r.json() as Promise<T>;
}

export function wsUrl(): string {
  const u = new URL(ENGINE_URL || location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  const t = getToken();
  if (t) u.searchParams.set("token", t);
  return u.toString();
}

// WebSocket URL for an interactive PTY rooted at `cwd`.
export function termUrl(cwd: string, cols: number, rows: number): string {
  const u = new URL(ENGINE_URL || location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/term";
  u.searchParams.set("cwd", cwd);
  u.searchParams.set("cols", String(cols));
  u.searchParams.set("rows", String(rows));
  const t = getToken();
  if (t) u.searchParams.set("token", t);
  return u.toString();
}

// ── Client-side attachment encoding (no server round-trip needed) ────────────
const MAX_ATTACHMENT_BYTES = 900_000;

const EXT_MIME: Record<string, string> = {
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", log: "text/plain",
  csv: "text/csv", json: "application/json", yaml: "application/yaml", yml: "application/yaml",
  xml: "application/xml", html: "text/html", pdf: "application/pdf",
};

function inferMime(name: string, provided: string): string {
  if (provided) return provided;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] || "application/octet-stream";
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadFiles(files: FileList | File[]): Promise<{ images: string[]; skipped: string[] }> {
  const images: string[] = [];
  const skipped: string[] = [];
  await Promise.all(
    Array.from(files).map(async (file) => {
      if (file.size > MAX_ATTACHMENT_BYTES) { skipped.push(file.name); return; }
      const base64 = await readAsBase64(file);
      const mime = inferMime(file.name, file.type);
      images.push(
        mime.startsWith("image/")
          ? `data:${mime};base64,${base64}`
          : `data:${mime};name=${encodeURIComponent(file.name)};base64,${base64}`,
      );
    }),
  );
  return { images, skipped };
}
