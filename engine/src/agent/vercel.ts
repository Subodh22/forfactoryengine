// Thin Vercel REST client. We use it to follow the deployment a job's pushed
// commit triggers (matched by GitHub commit SHA) and, when a build fails, to
// pull the actual build-error log so the agent can fix it — not just a red dot.
//
// Auth is a Vercel API token (vercel.com/account/tokens), stored in the settings
// table exactly like the GitHub token. Team accounts pass a teamId.

const API = "https://api.vercel.com";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function qs(params: Record<string, string | number | undefined>): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}

async function vercelFetch(path: string, token: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, { headers: authHeaders(token), signal: ctrl.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = body.error as { message?: string } | undefined;
      throw new Error(err?.message || `Vercel API ${res.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export interface VercelUser { username: string; email?: string }

/** Validate a token and return the authenticated user's name (or throw). */
export async function getVercelUser(token: string): Promise<VercelUser> {
  const body = await vercelFetch(`/v2/user`, token);
  const u = (body.user ?? body) as { username?: string; name?: string; email?: string };
  return { username: String(u.username ?? u.name ?? "vercel"), email: u.email };
}

export interface VercelDeployment {
  uid: string;
  state: string;       // QUEUED | INITIALIZING | BUILDING | READY | ERROR | CANCELED
  url: string;         // the *.vercel.app host (no protocol)
  inspectorUrl?: string;
  target: string;      // "production" | "preview"
  commitSha: string;
}

function normalize(d: Record<string, unknown>): VercelDeployment {
  const meta = (d.meta ?? {}) as Record<string, unknown>;
  const target = String(d.target ?? "") || "preview";
  return {
    uid: String(d.uid ?? d.id ?? ""),
    state: String(d.state ?? d.readyState ?? "").toUpperCase(),
    url: String(d.url ?? ""),
    inspectorUrl: d.inspectorUrl ? String(d.inspectorUrl) : undefined,
    target,
    commitSha: String(meta.githubCommitSha ?? ""),
  };
}

/** The most recent deployment whose git metadata matches `sha`, or null if the
 *  GitHub integration hasn't registered a deployment for that commit yet. */
export async function findDeploymentForSha(
  token: string, sha: string, opts: { teamId?: string; projectId?: string } = {},
): Promise<VercelDeployment | null> {
  const body = await vercelFetch(
    `/v6/deployments${qs({ limit: 40, projectId: opts.projectId, teamId: opts.teamId })}`,
    token,
  );
  const list = (body.deployments ?? []) as Record<string, unknown>[];
  const want = sha.toLowerCase();
  const match = list.find((d) => {
    const meta = (d.meta ?? {}) as Record<string, unknown>;
    return String(meta.githubCommitSha ?? "").toLowerCase() === want;
  });
  return match ? normalize(match) : null;
}

/** Current state of one deployment. */
export async function getDeployment(
  token: string, deploymentId: string, opts: { teamId?: string } = {},
): Promise<VercelDeployment | null> {
  try {
    const body = await vercelFetch(`/v13/deployments/${encodeURIComponent(deploymentId)}${qs({ teamId: opts.teamId })}`, token);
    return normalize(body);
  } catch {
    return null;
  }
}

/** Pull the build log of a (failed) deployment and return the tail, which is
 *  where the actual error lives. ANSI colour codes stripped; capped for the
 *  agent prompt. Returns "" if the log can't be fetched. */
export async function getDeploymentBuildError(
  token: string, deploymentId: string, opts: { teamId?: string } = {},
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(
      `${API}/v3/deployments/${encodeURIComponent(deploymentId)}/events${qs({ builds: 1, limit: 1000, teamId: opts.teamId })}`,
      { headers: authHeaders(token), signal: ctrl.signal },
    );
    if (!res.ok) return "";
    const text = await res.text();

    // The endpoint returns either a JSON array, an { events: [...] } object, or
    // newline-delimited JSON — handle all three.
    let events: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) events = parsed as Record<string, unknown>[];
      else events = (((parsed as Record<string, unknown>).events ?? []) as Record<string, unknown>[]);
    } catch {
      events = text.split("\n").filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
        .filter((e): e is Record<string, unknown> => e !== null);
    }

    const lines = events
      .map((e) => {
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        return String(payload.text ?? e.text ?? "");
      })
      .map((l) => l.replace(/\[[0-9;]*m/g, "").replace(/\r/g, ""))
      .filter((l) => l.trim().length > 0);

    if (lines.length === 0) return "";
    // The failure is at the tail of the build output.
    return lines.slice(-80).join("\n").slice(-6000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Terminal states — polling stops once a deployment reaches one of these. */
export function isTerminalState(state: string): boolean {
  return state === "READY" || state === "ERROR" || state === "CANCELED";
}
