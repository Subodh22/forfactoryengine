import {
  ensureEpicWorktree, pushBranch, pushBranchToDefault, removeWorktree, deleteBranch,
} from "./agent/worktree";
import { createPR } from "./agent/github";
import { emitOutput } from "./events";
import { sendJobNotification } from "./notify";
import { updateStatus, broadcastJob } from "./status";
import { getProject, listDelegationState, isManualEpic, descendantsOf, patchJobIf, type Job, type EpicState } from "./db";
import { enqueue } from "./runner";

// Promotion is guarded at the DB level (patchJobIf pending→queued), so it is
// idempotent across restarts and shared-DB engines. Finalize keeps an
// in-process guard only to coalesce re-fires while one finalize is running.
const finalizing = new Set<string>();
// Coalesce bursts of child updates into one evaluation pass.
let pending = false;

function log(jobId: string, msg: string) {
  emitOutput(jobId, `[factory] ${msg}\n`);
}

export function pathsOverlap(a: string[], b: string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
    }
  }
  return false;
}

/** Re-evaluate every delegating epic: promote newly-unblocked children and
 *  finalize epics whose children have all completed. Debounced. */
export function scheduleDelegationCheck(): void {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    void runDelegationPass().catch((err) => console.error(`[delegator] pass error: ${err}`));
  }, 50);
}

async function runDelegationPass(): Promise<void> {
  const epics = await listDelegationState();
  for (const state of epics) {
    try {
      evaluateEpic(state);
    } catch (err) {
      console.error(`[delegator] evaluate error for ${state.epic.id}: ${err}`);
    }
  }
}

function evaluateEpic({ epic, children }: EpicState) {
  if (children.length === 0) return;

  const completed = new Set(children.filter((c) => c.status === "completed").map((c) => c.id));
  const inFlight: Job[] = children.filter((c) => c.status === "running" || c.status === "queued");

  // Manual plans run on the user's terms — agent tasks start only when the user
  // clicks Run, and human tasks are ticked off by hand. We skip auto-promotion
  // entirely and just watch for the whole subtree to finish so we can finalize.
  if (!isManualEpic(epic)) {
    for (const c of children) {
      if (c.status !== "pending") continue;
      const ready = c.blockedBy.every((b) => completed.has(b));
      if (!ready) continue;
      const conflict = inFlight.some((s) => pathsOverlap(s.touchedPaths, c.touchedPaths));
      if (conflict) continue;

      inFlight.push(c); // optimistic: keeps path-conflict checks correct within this pass
      void promoteChild(epic.id, c);
    }
  }

  return finishCheck({ epic, children });
}

async function promoteChild(epicId: string, c: Job): Promise<void> {
  try {
    // Only one caller can win the pending→queued transition; everyone else
    // (a concurrent pass, a restarted engine, a second engine) no-ops here.
    const won = await patchJobIf(c.id, { status: "queued" }, { whereStatus: "pending" });
    if (!won) return;
    log(epicId, `Dispatching subtask "${c.title}".`);
    await broadcastJob(c.id);
    enqueue(c.id);
  } catch (err) {
    console.error(`[delegator] promote failed for ${c.id}: ${err}`);
  }
}

function finishCheck({ epic, children }: EpicState) {
  const anyFailed = children.some((c) => c.status === "failed");
  const allDone = children.every((c) => c.status === "completed");
  // Manual plans are live trackers — they never auto-close. The user finalizes
  // explicitly via the Finish button (POST /api/jobs/:id/finish) so completing
  // the current tasks can't push/close a plan that's still being edited.
  if (allDone && !isManualEpic(epic) && !finalizing.has(epic.id)) {
    finalizing.add(epic.id);
    void finalizeEpic(epic).catch((err) => {
      finalizing.delete(epic.id);
      console.error(`[delegator] finalize error for ${epic.id}: ${err}`);
    });
  } else if (anyFailed) {
    log(epic.id, "A subtask failed — epic paused. Redo it to continue.");
  }
}

export async function finalizeEpic(epic: Job): Promise<void> {
  const project = await getProject(epic.projectId);
  if (!project) throw new Error("project not found");

  // A manual plan made of only human tasks (or whose agent tasks were never run)
  // has no branch to merge — just mark it done.
  if (isManualEpic(epic)) {
    const subtree = await descendantsOf(epic.id);
    const anyAgentWork = subtree.some((c) => c.assignee !== "human" && c.status === "completed");
    if (!anyAgentWork) {
      log(epic.id, "Plan complete — all tasks done.");
      await updateStatus(epic.id, "completed");
      await sendJobNotification({ jobId: epic.id, title: epic.title, status: "completed", projectName: project.name }).catch(() => {});
      finalizing.delete(epic.id);
      return;
    }
  }

  const { worktreePath, branch } = ensureEpicWorktree(project.localPath, epic.id, project.defaultBranch);

  let body = "Delegated epic completed by Factory.";
  try {
    const plan = epic.delegatorPlan ? JSON.parse(epic.delegatorPlan) : null;
    if (plan?.subtasks?.length) {
      body += "\n\nSubtasks:\n" + plan.subtasks
        .map((s: { title: string; touchedPaths?: string[] }) =>
          `- ${s.title}${s.touchedPaths?.length ? ` (${s.touchedPaths.join(", ")})` : ""}`)
        .join("\n");
    }
  } catch { /* use default body */ }

  try {
    if (project.githubToken && project.repo.includes("/")) {
      log(epic.id, `Pushing ${branch} and opening a PR...`);
      pushBranch(worktreePath, branch);
      const [owner, repo] = project.repo.split("/");
      const pr = await createPR(project.githubToken, owner!, repo!, branch, project.defaultBranch, epic.title, body);
      await updateStatus(epic.id, "completed", { prUrl: pr.url, prNumber: pr.number });
      log(epic.id, `Opened PR #${pr.number}: ${pr.url}`);
    } else {
      log(epic.id, `No GitHub token — pushing ${branch} to ${project.defaultBranch}...`);
      pushBranchToDefault(worktreePath, project.defaultBranch);
      await updateStatus(epic.id, "completed", { mergedToMain: true });
      log(epic.id, `Merged epic to ${project.defaultBranch}.`);
    }
    await sendJobNotification({ jobId: epic.id, title: epic.title, status: "completed", projectName: project.name }).catch(() => {});
  } catch (err) {
    const msg = String(err);
    log(epic.id, `ERROR finalizing epic: ${msg}`);
    await updateStatus(epic.id, "failed", { error: msg }).catch(() => {});
    throw err;
  } finally {
    try {
      removeWorktree(project.localPath, worktreePath);
      deleteBranch(project.localPath, branch);
    } catch { /* best-effort */ }
    finalizing.delete(epic.id);
  }
}
