import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from "./config";

// Short-lived CSRF states for the OAuth round-trip (single-process, in-memory).
const states = new Map<string, number>();
const STATE_TTL = 10 * 60 * 1000;

export function newState(): string {
  const s = crypto.randomUUID();
  states.set(s, Date.now());
  return s;
}

export function consumeState(s: string): boolean {
  const ts = states.get(s);
  if (ts === undefined) return false;
  states.delete(s);
  return Date.now() - ts < STATE_TTL;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: "repo",
    redirect_uri: redirectUri,
    state,
  });
  return `https://github.com/login/oauth/authorize?${p.toString()}`;
}

/** Exchange the OAuth code for a user access token. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await r.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? "no access_token returned");
  return data.access_token;
}
