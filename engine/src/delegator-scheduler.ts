import {
  ensureEpicWorktree, pushBranch, pushBranchToDefault, removeWorktree, deleteBranch,
} from "./agent/worktree";
import { createPR } from "./agent/github";
import { emitOutput } from "./events";
import { sendJobNotification } from "./notify";
import { updateStatus } from "./status";
import { getProject, listDelegationState, type Job, type EpicState } from "./db";
import { enqueue } from "./runner";

// Idempotency guards across re-fires (single engine process).
const promoted = new Set<string>();
const finalizing = new Set<string>();
// Coalesce bursts of child updates into one evaluation pass.
let pending = false;

function log(jobId: string, msg: string) {
  emitOutput(jobId, `[factory] ${msg}\n`);
}

function pathsOverlap(a: string[], b: string[]): boolean {
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

  for (const c of children) {
    if (c.status !== "pending" || promoted.has(c.id)) continue;
    const ready = c.blockedBy.every((b) => completed.has(b));
    if (!ready) continue;
    const conflict = inFlight.some((s) => pathsOverlap(s.touchedPaths, c.touchedPaths));
    if (conflict) continue;

    promoted.add(c.id);
    inFlight.push(c);
    log(epic.id, `Dispatching subtask "${c.title}".`);
    updateStatus(c.id, "queued")
      .then(() => enqueue(c.id))
      .catch((err) => {
        promoted.delete(c.id);
        console.error(`[delegator] promote failed for ${c.id}: ${err}`);
      });
  }

  const anyFailed = children.some((c) => c.status === "failed");
  const allDone = children.every((c) => c.status === "completed");
  if (allDone && !finalizing.has(epic.id)) {
    finalizing.add(epic.id);
    void finalizeEpic(epic).catch((err) => {
      finalizing.delete(epic.id);
      console.error(`[delegator] finalize error for ${epic.id}: ${err}`);
    });
  } else if (anyFailed) {
    log(epic.id, "A subtask failed — epic paused. Redo it to continue.");
  }
}

async function finalizeEpic(epic: Job): Promise<void> {
  const project = await getProject(epic.projectId);
  if (!project) throw new Error("project not found");

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
      await updateStatus(epic.id, "completed");
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
    promoted.delete(epic.id);
  }
}
