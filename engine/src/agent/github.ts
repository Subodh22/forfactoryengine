import { Octokit } from "@octokit/rest";

function octo(token: string) {
  return new Octokit({ auth: token });
}

/** Validate a token and return the authenticated user's login (or throw). */
export async function getUser(token: string): Promise<{ login: string }> {
  const { data } = await octo(token).users.getAuthenticated();
  return { login: data.login };
}

export interface RepoSummary {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
}

/** The authenticated user's repos, most-recently-pushed first (capped). */
export async function fetchUserRepos(token: string): Promise<RepoSummary[]> {
  const client = octo(token);
  const repos: RepoSummary[] = [];
  for await (const res of client.paginate.iterator(client.repos.listForAuthenticatedUser, {
    sort: "pushed",
    per_page: 100,
  })) {
    for (const r of res.data) {
      repos.push({
        fullName: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private,
        description: r.description ?? null,
      });
    }
    if (repos.length >= 200) break;
  }
  return repos;
}

export async function createPR(
  token: string, owner: string, repo: string, head: string, base: string, title: string, body: string,
): Promise<{ url: string; number: number }> {
  const { data } = await octo(token).pulls.create({ owner, repo, head, base, title, body });
  return { url: data.html_url, number: data.number };
}

export interface CheckRun {
  name: string;
  status: string;            // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | timed_out | action_required | null
  url: string | null;
}

/** Combined CI status for a PR: GitHub Actions check-runs plus legacy commit
 *  statuses (Vercel, etc.), deduped by name. */
export async function getPrChecks(
  token: string, owner: string, repo: string, prNumber: number,
): Promise<{ checks: CheckRun[]; sha: string }> {
  const client = octo(token);
  const { data: pr } = await client.pulls.get({ owner, repo, pull_number: prNumber });
  const sha = pr.head.sha;

  const checks: CheckRun[] = [];
  const seen = new Set<string>();

  const { data: runs } = await client.checks.listForRef({ owner, repo, ref: sha, per_page: 100 });
  for (const c of runs.check_runs) {
    seen.add(c.name);
    checks.push({ name: c.name, status: c.status, conclusion: c.conclusion ?? null, url: c.html_url ?? null });
  }

  // Legacy commit statuses (e.g. Vercel deployments) — only those not already a check-run.
  try {
    const { data: statuses } = await client.repos.listCommitStatusesForRef({ owner, repo, ref: sha, per_page: 100 });
    for (const s of statuses) {
      if (seen.has(s.context)) continue;
      seen.add(s.context);
      checks.push({
        name: s.context,
        status: s.state === "pending" ? "in_progress" : "completed",
        conclusion: s.state === "success" ? "success" : s.state === "failure" || s.state === "error" ? "failure" : null,
        url: s.target_url ?? null,
      });
    }
  } catch { /* statuses are best-effort */ }

  return { checks, sha };
}

export interface CreatedRepo { fullName: string; defaultBranch: string; htmlUrl: string }

/** Create a brand-new repo on the authenticated user's account, seeded with an
 *  initial commit so it's immediately cloneable. */
export async function createRepo(
  token: string, name: string, description: string, isPrivate: boolean,
): Promise<CreatedRepo> {
  try {
    const { data } = await octo(token).repos.createForAuthenticatedUser({
      name,
      description: description || undefined,
      private: isPrivate,
      auto_init: true,
    });
    return { fullName: data.full_name, defaultBranch: data.default_branch, htmlUrl: data.html_url };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 422 && /already exists/i.test(e.message ?? "")) {
      throw new Error(`A repository named "${name}" already exists on your GitHub account. Choose a different name.`);
    }
    throw err;
  }
}
