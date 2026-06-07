import fs from "node:fs";
import path from "node:path";
import { getJob, getProject, getSetting, patchJob, listJobsByStatus, type Job } from "./db";
import { broadcast } from "./events";
import { createClaudeSession } from "./agent/claude-runner";
import { createWorktree, removeWorktree, getChangedFiles, commitOnly, pushBranch, ensureRepoCloned } from "./agent/worktree";
import { buildRepoMap } from "./agent/repo-map";
import { createPR } from "./agent/github";

// Simple in-process job queue with bounded concurrency. The engine owns
// execution; no external poller needed.
const MAX_CONCURRENT = 3;
const queue: string[] = [];
const active = new Set<string>();
// Every job id we've ever taken responsibility for — prevents the cloud-pickup
// sweep from enqueuing a job twice (or re-running one already in flight).
const seen = new Set<string>();

export function enqueue(jobId: string): void {
  if (seen.has(jobId)) return;
  seen.add(jobId);
  queue.push(jobId);
  pump();
}

/**
 * Enqueue any "pending" jobs we haven't picked up yet. These are jobs created
 * remotely (e.g. from the Vercel control app, written to Turso and synced down)
 * — or our own jobs left pending after a restart. Called on the sync loop.
 */
export async function pickupPending(): Promise<void> {
  const pending = await listJobsByStatus("pending");
  for (const job of pending) enqueue(job.id);
}

function pump(): void {
  while (active.size < MAX_CONCURRENT && queue.length > 0) {
    const jobId = queue.shift()!;
    active.add(jobId);
    void runJob(jobId).finally(() => {
      active.delete(jobId);
      pump();
    });
  }
}

async function updateStatus(
  jobId: string,
  status: Job["status"],
  fields: Partial<Pick<Job, "branch" | "prUrl" | "error">> = {},
): Promise<void> {
  await patchJob(jobId, { status, ...fields });
  const job = await getJob(jobId);
  if (job) broadcast({ type: "job.updated", job });
}

function readClaudeMd(dir: string): string | null {
  const p = path.join(dir, "CLAUDE.md");
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}

async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const project = await getProject(job.projectId);
  if (!project) {
    await updateStatus(jobId, "failed", { error: "project not found" });
    return;
  }

  const log = (msg: string) => broadcast({ type: "job.output", jobId, chunk: `[factory] ${msg}\n` });
  let worktreePath: string | undefined;

  try {
    await updateStatus(jobId, "running");

    // Make sure the repo is on this machine (clones it if a remote is configured).
    const localPath = ensureRepoCloned({ repo: project.repo, localPath: project.localPath, githubToken: project.githubToken });
    log(`Repo: ${localPath}`);

    const wt = createWorktree(localPath, jobId, project.defaultBranch);
    worktreePath = wt.worktreePath;
    await updateStatus(jobId, "running", { branch: wt.branch });
    log(`Worktree: ${wt.worktreePath}  (branch ${wt.branch})`);
    log("-".repeat(40));

    const session = createClaudeSession(worktreePath);
    session.onChunk((text) => broadcast({ type: "job.output", jobId, chunk: text }));

    const rules = project.agentRules ? `${project.agentRules}\n\n` : "";
    const claudeHint = readClaudeMd(worktreePath)
      ? "Read CLAUDE.md before starting.\n\n"
      : "No CLAUDE.md found — create one if useful, then do the task.\n\n";
    const repoMap = buildRepoMap(worktreePath);
    const message = `${rules}${claudeHint}${repoMap}\n---\n\n${job.prompt}`;

    const turn = await session.sendMessage(message);
    log("-".repeat(40));

    const changed = getChangedFiles(worktreePath);
    log(`Changed files: ${changed.length ? changed.join(", ") : "none"}`);

    let prUrl = "";
    if (changed.length > 0) {
      const committed = commitOnly(worktreePath, `feat: ${job.title}\n\nAutomated by Factory`);
      log(committed ? `Committed to ${wt.branch}.` : "Nothing to commit.");

      // If the project is backed by a GitHub repo and we have a token (per-project
      // or the connected account), push the branch and open a PR.
      const token = project.githubToken || (await getSetting("githubToken")) || "";
      if (committed && project.repo.includes("/") && token) {
        try {
          log(`Pushing ${wt.branch} and opening a PR…`);
          pushBranch(worktreePath, wt.branch);
          const [owner, repo] = project.repo.split("/");
          const pr = await createPR(token, owner!, repo!, wt.branch, project.defaultBranch, job.title, "Automated by Factory.");
          prUrl = pr.url;
          log(`Opened PR #${pr.number}: ${pr.url}`);
        } catch (err) {
          log(`Note: couldn't open a PR (${String(err)}). Work is committed on ${wt.branch}.`);
        }
      }
    } else if (!turn.assistantText.trim() && !turn.resultText.trim()) {
      throw new Error("Claude produced no output");
    }

    await updateStatus(jobId, "done", prUrl ? { prUrl } : {});
    log("Job complete.");
  } catch (err) {
    await updateStatus(jobId, "failed", { error: String(err) });
    broadcast({ type: "job.output", jobId, chunk: `[factory] FAILED: ${String(err)}\n` });
  } finally {
    if (worktreePath && project) {
      try { removeWorktree(project.localPath, worktreePath); } catch { /* best-effort */ }
    }
  }
}
