import fs from "node:fs";
import {
  getJob, getProject, getSetting, listJobs, patchJob, updateUsage,
  type Job, type Project, type PushState,
} from "./db";
import { broadcastJob } from "./status";
import { emitOutput } from "./events";
import { createClaudeSession, type ClaudeSessionOptions } from "./agent/claude-runner";
import {
  commitOnly, fetchAndRebase, abortRebase, continueRebase, hasConflictMarkers,
  pushHeadTo, pushBranch, headSha, removeWorktree, deleteBranch, PushError,
} from "./agent/worktree";
import { createPR, getActionsStatusForSha, getFailedRunLogs, type CiStatusResult } from "./agent/github";

// ── Push pipeline ────────────────────────────────────────────────────────────
// Pushing is its own lifecycle, separate from job status: the agent's work is
// done and committed; what remains is getting it onto the remote. Transient
// failures are retried with backoff; rebase conflicts get one agent-assisted
// resolution pass; anything still failing escalates to pushState "needs_help"
// so the user can fix the cause and hit RETRY PUSH (the worktree is kept).

export const MAX_PUSH_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 8_000];

// ── GitHub Actions monitoring ─────────────────────────────────────────────────
// After a PR-flow push lands, watch the commit's GitHub Actions runs. A red run
// resumes the agent to troubleshoot+fix, then we commit, re-push, and re-check —
// up to MAX_CI_FIX_ATTEMPTS times. Direct pushes have no GitHub remote, so this
// only runs in the PR flow.
export const MAX_CI_FIX_ATTEMPTS = Number(process.env.FACTORY_MAX_CI_FIX ?? 3);
const CI_POLL_INTERVAL_MS = 15_000;
// How long to wait for the FIRST run to register before concluding "no CI".
const CI_APPEAR_TIMEOUT_MS = 90_000;
// Overall ceiling on waiting for runs to complete (per check cycle).
const CI_COMPLETE_TIMEOUT_MS = Number(process.env.FACTORY_CI_TIMEOUT_MS ?? 25 * 60_000);

export interface PushOutcome { ok: boolean; error?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(jobId: string, msg: string) {
  emitOutput(jobId, `[factory] ${msg}\n`);
}

// Serialize the rebase+push critical section per repo so parallel jobs don't
// race each other onto the default branch (job A pushing between job B's fetch
// and push would force B into a pointless retry).
const repoLocks = new Map<string, Promise<unknown>>();
function withRepoPushLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(repoPath) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  repoLocks.set(repoPath, next.catch(() => {}));
  return next;
}

async function setPushState(jobId: string, pushState: PushState, fields: Partial<Job> = {}): Promise<void> {
  await patchJob(jobId, { pushState, ...fields });
  await broadcastJob(jobId);
}

/** Name the already-pushed job whose files overlap ours, so a conflict reads
 *  as "collides with job X" instead of a raw git dump. */
async function findConflictingJob(projectId: string, jobId: string, files: string[]): Promise<string> {
  try {
    const jobs = await listJobs(projectId, 50);
    const hit = jobs.find((j) =>
      j.id !== jobId && j.pushState === "pushed" && j.touchedPaths.some((p) => files.includes(p)));
    return hit ? ` — likely collides with "${hit.title}"` : "";
  } catch {
    return "";
  }
}

/** One agent pass over a paused rebase: resume the job's session in the
 *  worktree and ask it to resolve the conflict markers. The pipeline verifies
 *  the markers are actually gone before continuing the rebase. */
function agentConflictResolver(job: Job, worktreePath: string, targetBranch: string) {
  return async (files: string[]): Promise<boolean> => {
    log(job.id, `Asking the agent to resolve the conflicts…`);
    const opts: ClaudeSessionOptions = {
      ...(job.model ? { model: job.model } : {}),
      ...(job.effort ? { effort: job.effort as ClaudeSessionOptions["effort"] } : {}),
    };
    const session = createClaudeSession(worktreePath, job.sessionId || undefined, opts);
    session.onChunk((t) => emitOutput(job.id, t));
    try {
      const turn = await session.sendMessage([
        `A git rebase onto origin/${targetBranch} stopped on merge conflicts.`,
        `Conflicted files: ${files.join(", ")}.`,
        `Open each conflicted file and resolve the <<<<<<< / ======= / >>>>>>> markers so that BOTH the incoming ${targetBranch} changes and this branch's changes keep working.`,
        `Do NOT run any git commands (no add/commit/rebase/push) — the engine continues the rebase after you.`,
        `When every marker is resolved, reply with just: RESOLVED`,
      ].join("\n"));
      await updateUsage(job.id, turn.inputTokens, turn.outputTokens, turn.costUsd);
      return true;
    } catch (err) {
      log(job.id, `Conflict-resolve agent failed: ${String(err)}`);
      return false;
    } finally {
      session.cancel();
    }
  };
}

interface DirectPushArgs {
  job: Job;
  worktreePath: string;
  repoPath: string;
  targetBranch: string;
  commitMessage: string;
}

/** Commit + rebase + push HEAD onto the target branch, with retries, the
 *  agent conflict pass, and needs_help escalation. Never throws. */
async function pushDirectWithRetry({ job, worktreePath, repoPath, targetBranch, commitMessage }: DirectPushArgs): Promise<PushOutcome> {
  const resolve = agentConflictResolver(job, worktreePath, targetBranch);
  let resolverUsed = false;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    await setPushState(job.id, "pushing", { pushAttempts: attempt, pushError: "" });
    if (attempt > 1) log(job.id, `Push attempt ${attempt}/${MAX_PUSH_ATTEMPTS}…`);
    try {
      await withRepoPushLock(repoPath, async () => {
        commitOnly(worktreePath, commitMessage); // no-op on retries — the commit already exists
        try {
          fetchAndRebase(worktreePath, targetBranch);
        } catch (err) {
          if (!(err instanceof PushError) || err.kind !== "conflict") throw err;
          // Rebase is paused with markers in place. One agent pass, then verify.
          const files = err.conflictFiles;
          const who = await findConflictingJob(job.projectId, job.id, files);
          if (resolverUsed) { abortRebase(worktreePath); throw new PushError("conflict", `${err.message}${who}`, files); }
          resolverUsed = true;
          log(job.id, `Rebase conflict in: ${files.join(", ")}${who}`);
          const resolved = await resolve(files);
          if (!resolved || hasConflictMarkers(worktreePath, files)) {
            abortRebase(worktreePath);
            throw new PushError("conflict", `agent could not resolve the rebase conflict in ${files.join(", ")}${who}`, files);
          }
          continueRebase(worktreePath); // throws PushError("conflict") if git still objects
          log(job.id, "Conflicts resolved — rebase continued.");
        }
        pushHeadTo(worktreePath, targetBranch);
      });

      // commitSha + mergedToMain feed the diff endpoint and the UI after the
      // worktree is cleaned up.
      const sha = headSha(worktreePath);
      await setPushState(job.id, "pushed", {
        pushedSha: sha, pushedTo: targetBranch, pushError: "", commitSha: sha, mergedToMain: true,
      });
      log(job.id, `Pushed ${sha.slice(0, 8)} to ${targetBranch}.`);
      return { ok: true };
    } catch (err) {
      if (err instanceof PushError && err.kind === "conflict") {
        try { abortRebase(worktreePath); } catch { /* already aborted */ }
      }
      lastError = String(err instanceof Error ? err.message : err);
      const kind = err instanceof PushError ? err.kind : "transient";
      if (kind !== "transient" || attempt === MAX_PUSH_ATTEMPTS) break;
      const wait = BACKOFF_MS[attempt - 1] ?? 8_000;
      log(job.id, `Push failed: ${lastError}`);
      log(job.id, `Retrying in ${Math.round(wait / 1000)}s…`);
      await sleep(wait);
    }
  }

  await setPushState(job.id, "needs_help", { pushError: lastError });
  log(job.id, `PUSH NEEDS HELP: ${lastError}`);
  log(job.id, "Your commit is safe in the worktree. Fix the cause, then hit RETRY PUSH in the UI.");
  return { ok: false, error: lastError };
}

/** Push the job's own branch (PR flow) with retries on transient failures.
 *  No rebase, no lock — nothing else writes to this branch. Never throws. */
async function pushBranchWithRetry(job: Job, worktreePath: string, branch: string): Promise<PushOutcome> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    await setPushState(job.id, "pushing", { pushAttempts: attempt, pushError: "" });
    if (attempt > 1) log(job.id, `Push attempt ${attempt}/${MAX_PUSH_ATTEMPTS}…`);
    try {
      pushBranch(worktreePath, branch);
      const sha = headSha(worktreePath);
      await setPushState(job.id, "pushed", { pushedSha: sha, pushedTo: branch, pushError: "", commitSha: sha });
      return { ok: true };
    } catch (err) {
      lastError = String(err instanceof Error ? err.message : err);
      const kind = err instanceof PushError ? err.kind : "transient";
      if (kind !== "transient" || attempt === MAX_PUSH_ATTEMPTS) break;
      const wait = BACKOFF_MS[attempt - 1] ?? 8_000;
      log(job.id, `Push failed: ${lastError}`);
      log(job.id, `Retrying in ${Math.round(wait / 1000)}s…`);
      await sleep(wait);
    }
  }
  await setPushState(job.id, "needs_help", { pushError: lastError });
  log(job.id, `PUSH NEEDS HELP: ${lastError}`);
  log(job.id, "Your commit is safe in the worktree. Fix the cause, then hit RETRY PUSH in the UI.");
  return { ok: false, error: lastError };
}

// ── GitHub Actions: monitor + agent-assisted auto-fix ─────────────────────────

/** Off only when explicitly disabled (setting "ciAutofix" = 0/false/off/no). */
function ciAutofixEnabled(setting: string | null): boolean {
  const v = String(setting ?? "").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/** Poll GitHub Actions for a commit until its runs complete (or we give up).
 *  `timedOut` distinguishes "still pending after the window" from a real
 *  conclusion so the caller can leave the job pushed instead of fixing. */
async function waitForCi(
  jobId: string, token: string, owner: string, repo: string, sha: string,
): Promise<{ status: CiStatusResult; timedOut: boolean }> {
  const start = Date.now();
  let sawRun = false;
  for (;;) {
    let status: CiStatusResult;
    try {
      status = await getActionsStatusForSha(token, owner, repo, sha);
    } catch (err) {
      if (Date.now() - start > CI_COMPLETE_TIMEOUT_MS) {
        return {
          status: { state: "pending", htmlUrl: "", failedRuns: [], summary: `CI query failed: ${String(err)}` },
          timedOut: true,
        };
      }
      await sleep(CI_POLL_INTERVAL_MS);
      continue;
    }
    if (status.state === "none") {
      // Give workflows a moment to register before concluding there are none.
      if (!sawRun && Date.now() - start < CI_APPEAR_TIMEOUT_MS) { await sleep(CI_POLL_INTERVAL_MS); continue; }
      return { status, timedOut: false };
    }
    sawRun = true;
    if (status.state !== "pending") return { status, timedOut: false };
    if (Date.now() - start > CI_COMPLETE_TIMEOUT_MS) return { status, timedOut: true };
    await sleep(CI_POLL_INTERVAL_MS);
  }
}

/** Resume the job's session in the worktree and ask it to fix the CI failure.
 *  The engine commits + re-pushes after; the agent runs no git. Returns ok=false
 *  with a reason when the agent bails out ("CANNOT FIX"). */
async function runCiFixAgent(
  job: Job, worktreePath: string, status: CiStatusResult, logs: string,
): Promise<{ ok: boolean; reason?: string }> {
  const opts: ClaudeSessionOptions = {
    ...(job.model ? { model: job.model } : {}),
    ...(job.effort ? { effort: job.effort as ClaudeSessionOptions["effort"] } : {}),
  };
  const session = createClaudeSession(worktreePath, job.sessionId || undefined, opts);
  session.onChunk((t) => emitOutput(job.id, t));
  try {
    const turn = await session.sendMessage([
      `The GitHub Actions CI for your last push FAILED.`,
      `Failing run(s): ${status.summary}.`,
      status.htmlUrl ? `Run: ${status.htmlUrl}` : "",
      ``,
      `Failure logs (tail):`,
      logs || "(no logs available — infer the likely cause from the run names above)",
      ``,
      `Diagnose the root cause and FIX it directly in this working tree. Use your`,
      `best judgment to choose the right fix and apply it now — do NOT ask for`,
      `confirmation. Keep all existing features working; do NOT disable, skip, or`,
      `delete tests or CI steps just to make the run go green — fix the real cause.`,
      `Do NOT run any git commands (no add/commit/push) — the engine commits and`,
      `re-pushes for you, then re-checks CI.`,
      `If after investigating you genuinely cannot fix it, reply with exactly`,
      `"CANNOT FIX: <one-line reason>". Otherwise apply the edits and reply "FIXED".`,
    ].filter(Boolean).join("\n"));
    await updateUsage(job.id, turn.inputTokens, turn.outputTokens, turn.costUsd);
    const said = `${turn.assistantText ?? ""}\n${turn.resultText ?? ""}`;
    const bail = said.match(/CANNOT FIX:?\s*(.*)/i);
    if (bail) return { ok: false, reason: `agent could not fix CI: ${(bail[1] || "").trim() || status.summary}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `CI-fix agent failed: ${String(err)}` };
  } finally {
    session.cancel();
  }
}

interface CiMonitorArgs {
  job: Job;
  worktreePath: string;
  branch: string;
  token: string;
  owner: string;
  repo: string;
  sha: string;
}

/** After a PR-flow push: watch CI, and on a red run resume the agent to fix it,
 *  re-push, and re-check — bounded by MAX_CI_FIX_ATTEMPTS. Never throws. A run
 *  the agent can't get green escalates to needs_help (RETRY PUSH re-checks). */
async function monitorAndFixCI({ job, worktreePath, branch, token, owner, repo, ...rest }: CiMonitorArgs): Promise<PushOutcome> {
  if (!ciAutofixEnabled(await getSetting("ciAutofix"))) return { ok: true };
  let sha = rest.sha;

  for (let attempt = 0; attempt <= MAX_CI_FIX_ATTEMPTS; attempt++) {
    await setPushState(job.id, "checking_ci", { ciStatus: "pending", pushedSha: sha });
    log(job.id, `Checking GitHub Actions for ${sha.slice(0, 8)}…`);
    const { status, timedOut } = await waitForCi(job.id, token, owner, repo, sha);

    if (status.state === "none") {
      log(job.id, "No GitHub Actions runs for this commit — nothing to monitor.");
      await setPushState(job.id, "pushed", { ciStatus: "" });
      return { ok: true };
    }
    if (status.state === "passed") {
      log(job.id, "GitHub Actions passed ✓");
      await setPushState(job.id, "pushed", { ciStatus: "passed", ciRunUrl: status.htmlUrl });
      return { ok: true };
    }
    if (timedOut || status.state === "pending") {
      log(job.id, `GitHub Actions still running after the wait window — leaving it pushed. Track it at ${status.htmlUrl || "GitHub"}.`);
      await setPushState(job.id, "pushed", { ciStatus: "pending", ciRunUrl: status.htmlUrl });
      return { ok: true };
    }

    // status.state === "failed"
    log(job.id, `GitHub Actions failed ✗ — ${status.summary}`);
    if (attempt >= MAX_CI_FIX_ATTEMPTS) {
      const err = `GitHub Actions still failing after ${MAX_CI_FIX_ATTEMPTS} fix attempt(s): ${status.summary}`;
      await setPushState(job.id, "needs_help", { ciStatus: "failed", ciRunUrl: status.htmlUrl, pushError: err });
      log(job.id, `CI NEEDS HELP: ${err}`);
      log(job.id, "Your commit is on the remote. Fix the cause, then hit RETRY PUSH to re-check and re-fix.");
      return { ok: false, error: err };
    }

    await setPushState(job.id, "fixing_ci", { ciStatus: "failed", ciAttempts: attempt + 1, ciRunUrl: status.htmlUrl });
    log(job.id, `Asking the agent to troubleshoot the CI failure (fix attempt ${attempt + 1}/${MAX_CI_FIX_ATTEMPTS})…`);

    const failedRunId = status.failedRuns[0]?.id;
    const logs = failedRunId ? await getFailedRunLogs(token, owner, repo, failedRunId).catch(() => "") : "";

    const fix = await runCiFixAgent(job, worktreePath, status, logs);
    if (!fix.ok) {
      const err = fix.reason || "the agent could not fix the CI failure";
      await setPushState(job.id, "needs_help", { ciStatus: "failed", ciRunUrl: status.htmlUrl, pushError: err });
      log(job.id, `CI NEEDS HELP: ${err}`);
      return { ok: false, error: err };
    }

    const committed = commitOnly(worktreePath, `fix: resolve CI failure for ${job.title}\n\nAutomated by Factory`);
    if (!committed) {
      const err = "the agent made no changes, so the CI failure is unresolved";
      await setPushState(job.id, "needs_help", { ciStatus: "failed", ciRunUrl: status.htmlUrl, pushError: err });
      log(job.id, `CI NEEDS HELP: ${err}`);
      return { ok: false, error: err };
    }
    try {
      pushBranch(worktreePath, branch);
      sha = headSha(worktreePath);
      log(job.id, `Pushed CI fix ${sha.slice(0, 8)} — re-checking…`);
    } catch (err) {
      const msg = `failed to push the CI fix: ${String(err instanceof Error ? err.message : err)}`;
      await setPushState(job.id, "needs_help", { ciStatus: "failed", ciRunUrl: status.htmlUrl, pushError: msg });
      log(job.id, `CI NEEDS HELP: ${msg}`);
      return { ok: false, error: msg };
    }
  }
  return { ok: true };
}

/** PR body for an epic, rebuilt from the stored plan (also used on retry). */
export function epicPrBody(job: Job): string {
  let body = "Delegated epic completed by Factory.";
  try {
    const plan = job.delegatorPlan ? JSON.parse(job.delegatorPlan) : null;
    if (plan?.subtasks?.length) {
      body += "\n\nSubtasks:\n" + plan.subtasks
        .map((s: { title: string; touchedPaths?: string[] }) =>
          `- ${s.title}${s.touchedPaths?.length ? ` (${s.touchedPaths.join(", ")})` : ""}`)
        .join("\n");
    }
  } catch { /* use default body */ }
  return body;
}

/**
 * Deliver a finished job's commits to the remote: PR flow when the project has
 * a GitHub repo + token, direct push to the default branch otherwise. Updates
 * pushState throughout and never throws — { ok: false } means the push is in
 * "needs_help" and the worktree should be kept for RETRY PUSH.
 */
export async function finalizeJobPush(jobId: string, project: Project, worktreePath: string, branch: string): Promise<PushOutcome> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, error: "job not found" };
  // Persist the worktree location so RETRY PUSH can find it later (epics don't
  // store it during normal runs).
  await patchJob(jobId, { worktreePath, branch }).catch(() => {});

  const commitMessage = `feat: ${job.title}\n\nAutomated by Factory${job.kind === "epic" ? " (delegated)" : ""}`;
  try {
    const token = project.githubToken || (await getSetting("githubToken")) || "";
    if (project.repo.includes("/") && token) {
      log(jobId, "Committing and pushing branch for a PR…");
      commitOnly(worktreePath, commitMessage); // false on retries — commit already exists
      const pushed = await pushBranchWithRetry(job, worktreePath, branch);
      if (!pushed.ok) return pushed;
      if (!job.prUrl) {
        const [owner, repo] = project.repo.split("/");
        const body = job.kind === "epic" ? epicPrBody(job) : "Automated by Factory.";
        const pr = await createPR(token, owner!, repo!, branch, project.defaultBranch, job.title, body);
        await patchJob(jobId, { prUrl: pr.url, prNumber: pr.number });
        await broadcastJob(jobId);
        log(jobId, `Opened PR #${pr.number}: ${pr.url}`);
      }
      // Branch is up + PR open — now watch CI and auto-fix red runs.
      const [owner, repo] = project.repo.split("/");
      const fresh = (await getJob(jobId)) ?? job; // pick up prUrl just set
      return await monitorAndFixCI({
        job: fresh, worktreePath, branch, token, owner: owner!, repo: repo!,
        sha: headSha(worktreePath),
      });
    }

    log(jobId, `Pushing changes to ${project.defaultBranch}…`);
    return await pushDirectWithRetry({
      job, worktreePath, repoPath: project.localPath,
      targetBranch: project.defaultBranch, commitMessage,
    });
  } catch (err) {
    // Commit or PR creation failed — same escalation as a failed push.
    const msg = String(err instanceof Error ? err.message : err);
    await setPushState(jobId, "needs_help", { pushError: msg });
    log(jobId, `PUSH NEEDS HELP: ${msg}`);
    log(jobId, "Fix the cause, then hit RETRY PUSH in the UI.");
    return { ok: false, error: msg };
  }
}

/** RETRY PUSH (POST /api/jobs/:id/retry-push): re-run the push pipeline from
 *  the kept worktree — no agent re-run. Cleans the worktree up on success.
 *  Also serves as the initial "Push to Main" trigger when a completed job has
 *  pushState="" (agent finished but push was never attempted or was skipped). */
export async function retryPush(jobId: string): Promise<PushOutcome> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, error: "job not found" };
  if (job.pushState === "pushing" || job.pushState === "checking_ci" || job.pushState === "fixing_ci") {
    return { ok: false, error: "a push is already in progress" };
  }
  if (job.pushState === "pushed") return { ok: false, error: "this job has already been pushed" };
  const allowedStates: string[] = ["needs_help", ""];
  if (!allowedStates.includes(job.pushState)) return { ok: false, error: "cannot push in current state" };
  const project = await getProject(job.projectId);
  if (!project) return { ok: false, error: "project not found" };
  if (!job.worktreePath || !fs.existsSync(job.worktreePath)) {
    const error = "the worktree no longer exists — use REDO to re-run the job";
    await setPushState(jobId, "needs_help", { pushError: error });
    return { ok: false, error };
  }

  log(jobId, "Retrying push…");
  const out = await finalizeJobPush(jobId, project, job.worktreePath, job.branch || `job/${jobId}`);
  if (out.ok) {
    removeWorktree(project.localPath, job.worktreePath);
    if (job.kind === "epic" && job.branch) deleteBranch(project.localPath, job.branch);
    await patchJob(jobId, { worktreePath: "" }).catch(() => {});
    await broadcastJob(jobId);
  }
  return out;
}
