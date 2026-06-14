import { Octokit } from "@octokit/rest";

function octo(token: string) {
  return new Octokit({ auth: token });
}

/** Validate a token and return the authenticated user's login (or throw). */
export async function getUser(token: string): Promise<{ login: string }> {
  const { data } = await octo(token).users.getAuthenticated();
  return { login: data.login };
}

export interface PrMergeState {
  state: string;          // "open" | "closed"
  merged: boolean;        // true once the PR is merged into base
  mergeCommitSha: string; // the commit on base that carries the merge (squash/merge)
}

/** Authoritative merge status for a PR — GitHub knows whether it landed on the
 *  base branch even when the work was squash-merged (so the branch SHA differs).
 *  Used to reconcile a job's mergedToMain after a PR is merged on GitHub. */
export async function getPullRequestState(
  token: string, owner: string, repo: string, prNumber: number,
): Promise<PrMergeState> {
  const { data } = await octo(token).pulls.get({ owner, repo, pull_number: prNumber });
  return { state: data.state, merged: Boolean(data.merged), mergeCommitSha: data.merge_commit_sha ?? "" };
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

// ── GitHub Actions (CI monitoring) ────────────────────────────────────────────

export type CiState = "none" | "pending" | "passed" | "failed";

export interface CiFailedRun { id: number; name: string; htmlUrl: string; conclusion: string }

export interface CiStatusResult {
  state: CiState;
  /** Best link for the UI — the failing run if any, else the latest run. */
  htmlUrl: string;
  failedRuns: CiFailedRun[];
  /** Short human-readable line, e.g. "build: failure; lint: timed_out". */
  summary: string;
}

// A run's conclusion that doesn't count as a failure (still "green enough").
const OK_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/** Aggregate every GitHub Actions workflow run for a commit into a single CI
 *  state. We keep only the newest run per workflow (re-runs supersede), so a
 *  fixed-then-rerun workflow reads as passed. */
export async function getActionsStatusForSha(
  token: string, owner: string, repo: string, sha: string,
): Promise<CiStatusResult> {
  const client = octo(token);
  const { data } = await client.actions.listWorkflowRunsForRepo({
    owner, repo, head_sha: sha, per_page: 100,
  });
  const runs = data.workflow_runs ?? [];
  if (!runs.length) return { state: "none", htmlUrl: "", failedRuns: [], summary: "no workflow runs" };

  // Newest run per workflow_id wins.
  const latest = new Map<number, (typeof runs)[number]>();
  for (const r of runs) {
    const prev = latest.get(r.workflow_id);
    if (!prev || r.run_number > prev.run_number) latest.set(r.workflow_id, r);
  }
  const considered = [...latest.values()];

  const pending = considered.filter((r) => r.status !== "completed");
  if (pending.length) {
    return {
      state: "pending", htmlUrl: pending[0]!.html_url, failedRuns: [],
      summary: `${pending.length} run(s) in progress`,
    };
  }

  const failed = considered.filter((r) => !OK_CONCLUSIONS.has(String(r.conclusion)));
  if (failed.length) {
    return {
      state: "failed",
      htmlUrl: failed[0]!.html_url,
      failedRuns: failed.map((r) => ({
        id: r.id, name: r.name ?? "workflow", htmlUrl: r.html_url, conclusion: String(r.conclusion),
      })),
      summary: failed.map((r) => `${r.name ?? "workflow"}: ${r.conclusion}`).join("; "),
    };
  }

  return { state: "passed", htmlUrl: considered[0]?.html_url ?? "", failedRuns: [], summary: "all runs passed" };
}

/** Keep the most informative tail of a log: the last `maxLines` lines, capped
 *  at `maxChars`. CI logs are timestamp-prefixed and huge; the failure is
 *  almost always near the end. */
function tailLog(text: string, maxLines = 150, maxChars = 12_000): string {
  const lines = text.split(/\r?\n/);
  let tail = lines.slice(-maxLines).join("\n");
  if (tail.length > maxChars) tail = tail.slice(tail.length - maxChars);
  return tail.trim();
}

/** For a failed workflow run, gather the failed jobs, their failed step names,
 *  and the tail of each job's log — the context the agent needs to diagnose. */
export async function getFailedRunLogs(
  token: string, owner: string, repo: string, runId: number,
): Promise<string> {
  const client = octo(token);
  const { data } = await client.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId, per_page: 100 });
  const failedJobs = (data.jobs ?? []).filter(
    (j) => j.conclusion && !OK_CONCLUSIONS.has(j.conclusion),
  );
  if (!failedJobs.length) return "";

  const chunks: string[] = [];
  for (const job of failedJobs.slice(0, 4)) {
    const failedSteps = (job.steps ?? [])
      .filter((s) => s.conclusion && !OK_CONCLUSIONS.has(s.conclusion))
      .map((s) => s.name);
    chunks.push(`### Job "${job.name}" → ${job.conclusion}` +
      (failedSteps.length ? ` (failed step: ${failedSteps.join(", ")})` : ""));
    try {
      const resp = await client.actions.downloadJobLogsForWorkflowRun({ owner, repo, job_id: job.id });
      const raw = resp.data as unknown;
      const text = typeof raw === "string"
        ? raw
        : Buffer.from(raw as ArrayBuffer).toString("utf8");
      chunks.push("```\n" + tailLog(text) + "\n```");
    } catch (err) {
      chunks.push(`(could not download logs: ${String(err)})`);
    }
  }
  return chunks.join("\n\n");
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
