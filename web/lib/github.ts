// GitHub OAuth + REST, run server-side in the Vercel app. The token is stored in
// Turso (settings table) where the engine on your Mac reads it to clone + open PRs.

export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
export const oauthConfigured = Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);

/** Build the public origin of this deployment from request headers (works on any
 *  Vercel domain without hardcoding). */
export function originFromRequest(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3002";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/github/callback`;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "repo", redirect_uri: redirectUri, state });
  return `https://github.com/login/oauth/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  });
  const d = (await r.json()) as { access_token?: string; error?: string };
  if (!d.access_token) throw new Error(d.error ?? "no access_token");
  return d.access_token;
}

export async function getUser(token: string): Promise<{ login: string }> {
  const r = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "factory", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error("invalid token");
  const d = (await r.json()) as { login: string };
  return { login: d.login };
}

export interface Repo { fullName: string; defaultBranch: string; private: boolean; }

export async function listRepos(token: string): Promise<Repo[]> {
  const out: Repo[] = [];
  for (let page = 1; page <= 2; page++) {
    const r = await fetch(`https://api.github.com/user/repos?sort=pushed&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "factory", Accept: "application/vnd.github+json" },
    });
    if (!r.ok) break;
    const d = (await r.json()) as Array<{ full_name: string; default_branch: string; private: boolean }>;
    for (const x of d) out.push({ fullName: x.full_name, defaultBranch: x.default_branch, private: x.private });
    if (d.length < 100) break;
  }
  return out;
}
