import { listProjects, listJobs, patchJob, getSetting } from "./db";
import { getPullRequestState } from "./agent/github";
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
