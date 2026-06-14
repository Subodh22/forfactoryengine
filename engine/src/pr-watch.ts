import { listProjects, listJobs, patchJob, getSetting, getJob, getProject } from "./db";
import { getPullRequestState, mergePR } from "./agent/github";
import { broadcastJob } from "./status";

// ── PR merge reconciler ───────────────────────────────────────────────────────
// The push pipeline sets mergedToMain=true only for DIRECT pushes. PR-flow jobs
// open a PR and stop — nothing watches for the PR being merged on GitHub later,
// so a merged job keeps reporting mergedToMain=false and looks "not on main"
// (wrong NOT-ON-MAIN badge, stray Push-to-main button). This sweep asks GitHub
// the authoritative question — is the PR merged? — and reconciles the flag.
// Pure visibility: it never pushes, merges, or changes the push flow.

const INTERVAL_MS = Number(process.env.FACTORY_PR_WATCH_MS ?? 3 * 60_000);

/** One reconciliation pass over every project with a GitHub repo + token. For
 *  each job parked in a PR (prNumber set, not yet marked merged) ask GitHub if
 *  it merged; if so, flip mergedToMain. Returns how many jobs were updated. */
export async function reconcileMergedPRs(): Promise<number> {
  let updated = 0;
  const projects = await listProjects();
  for (const p of projects) {
    if (!p.repo.includes("/")) continue;
    const token = p.githubToken || (await getSetting("githubToken")) || "";
    if (!token) continue;
    const [owner, repo] = p.repo.split("/");
    if (!owner || !repo) continue;

    const jobs = await listJobs(p.id);
    const candidates = jobs.filter((j) => j.prNumber > 0 && !j.mergedToMain);
    for (const j of candidates) {
      try {
        const pr = await getPullRequestState(token, owner, repo, j.prNumber);
        if (!pr.merged) continue;
        await patchJob(j.id, {
          mergedToMain: true,
          pushedTo: p.defaultBranch || "main",
          commitSha: pr.mergeCommitSha || j.commitSha,
        });
        await broadcastJob(j.id);
        updated++;
      } catch {
        // Transient GitHub error / deleted PR — leave it for the next sweep.
      }
    }
  }
  return updated;
}

/** Run a sweep now, then on an interval. Started from the engine entrypoint. */
export function startPrWatch(): void {
  void reconcileMergedPRs().catch(() => {});
  setInterval(() => void reconcileMergedPRs().catch(() => {}), INTERVAL_MS).unref();
}

export interface MergeOutcome { ok: boolean; error?: string }

/** Merge a single job's open PR into the default branch and mark it landed.
 *  The work is already on the remote branch, so this needs no worktree — it's
 *  the right action for completed PR-flow jobs (Push-to-main can't help them). */
export async function mergeJobToMain(jobId: string): Promise<MergeOutcome> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, error: "job not found" };
  if (job.mergedToMain) return { ok: true };
  if (!job.prNumber) return { ok: false, error: "this job has no PR to merge — use REDO to re-run it" };
  const project = await getProject(job.projectId);
  if (!project) return { ok: false, error: "project not found" };
  const token = project.githubToken || (await getSetting("githubToken")) || "";
  if (!token) return { ok: false, error: "no GitHub token configured" };
  const [owner, repo] = project.repo.split("/");
  if (!owner || !repo) return { ok: false, error: "project has no GitHub repo" };
  try {
    const r = await mergePR(token, owner, repo, job.prNumber);
    if (!r.merged) return { ok: false, error: "GitHub reported the PR was not merged" };
    await patchJob(jobId, {
      mergedToMain: true,
      pushState: "pushed",
      pushedTo: project.defaultBranch || "main",
      commitSha: r.sha || job.commitSha,
      pushedSha: r.sha || job.pushedSha,
    });
    await broadcastJob(jobId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Merge every PR-flow job in a project that hasn't landed yet. Best-effort:
 *  reports how many merged and the reasons any failed (conflicts, protection). */
export async function mergeAllForProject(projectId: string): Promise<{ merged: number; failed: number; errors: string[] }> {
  const jobs = await listJobs(projectId);
  const candidates = jobs.filter((j) => j.prNumber > 0 && !j.mergedToMain);
  let merged = 0, failed = 0;
  const errors: string[] = [];
  for (const j of candidates) {
    const out = await mergeJobToMain(j.id);
    if (out.ok) merged++;
    else { failed++; if (out.error) errors.push(`${j.title || j.id}: ${out.error}`); }
  }
  return { merged, failed, errors };
}
