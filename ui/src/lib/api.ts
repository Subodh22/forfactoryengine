// REST + WebSocket client for the Factory engine. For the local ui/ this is
// same-origin (Vite proxies /api + /ws to the engine in dev; the engine serves
// the built UI in prod). VITE_ENGINE_URL lets a hosted build point elsewhere.

export const ENGINE_URL = (import.meta.env.VITE_ENGINE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const tokenKey = "factory-token";
export const getToken = () => localStorage.getItem(tokenKey) ?? "";
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
  const base = ENGINE_URL || location.origin;
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  const t = getToken();
  if (t) u.searchParams.set("token", t);
  return u.toString();
}

// WebSocket URL for an interactive PTY rooted at `cwd`.
export function termUrl(cwd: string, cols: number, rows: number): string {
  const base = ENGINE_URL || location.origin;
  const u = new URL(base);
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

/** Encode files as base64 data URLs. Images keep the plain form; other files
 *  embed the original name so it survives into the worktree. Mirrors the engine's
 *  attachments.buildDataUrl. */
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
