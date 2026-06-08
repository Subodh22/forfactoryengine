import fs from "node:fs";
import path from "node:path";
import { createClaudeSession } from "./agent/claude-runner";
import { createWorktree, removeWorktree, ensureEpicWorktree } from "./agent/worktree";
import { buildRepoMap } from "./agent/repo-map";
import { emitOutput } from "./events";
import { createChildren, setDelegatorPlan, updateUsage, type Job, type Project, type SubtaskInput } from "./db";
import { BuildPlanSchema, parse, type BuildPlan, type PlanSubtask } from "./schema";

function log(jobId: string, msg: string) {
  emitOutput(jobId, `[factory] ${msg}\n`);
}

const PLAN_FILE = path.join(".factory", "plan.json");

function plannerInstructions(): string {
  return `You are the FACTORY DELEGATOR — a planning agent. You will NOT write any
application code. Your only job is to produce a build PLAN: decompose the task
below into a dependency graph of subtasks that fresh agents will each implement in
their own git worktree.

FOUNDATION-FIRST (critical):
- The repository may be empty. Coherence matters most when there is nothing to
  cohere to yet. So your plan MUST begin with EXACTLY ONE subtask whose "role" is
  "scaffold": it establishes the tech stack, project structure, shared
  conventions/types, configuration, and a minimal END-TO-END WORKING SKELETON
  (it runs; it does little).
- Every other subtask has "role": "feature" and MUST list the scaffold subtask's
  localId in its "dependsOn", so no feature agent ever starts from a blank,
  conflicting slate — they build on the conventions the scaffold established.

DECOMPOSE CONSERVATIVELY:
- Prefer the SMALLEST number of coherent subtasks. If the app is small, a SINGLE
  "scaffold" subtask that builds the whole thing is the correct, best plan.
- Only split out a "feature" subtask when it is genuinely independent of the
  others.
- Subtasks with no dependency between them run in PARALLEL, so their "touchedPaths"
  MUST be disjoint — never let two parallel subtasks edit the same file. If two
  pieces must touch the same file, merge them or make one depend on the other.

Each subtask is handed to a FRESH agent with no memory of this plan, so its
"prompt" must be fully self-contained: state exactly what to build and where.

Output: create the directory \`.factory\` and WRITE your plan as JSON to
\`.factory/plan.json\` (and nothing else). The file MUST match exactly this shape:

{
  "summary": "one-line description of the app being built",
  "subtasks": [
    {
      "localId": "t1",
      "title": "Scaffold the app",
      "prompt": "Full self-contained instructions for the implementing agent.",
      "role": "scaffold",
      "touchedPaths": ["."],
      "dependsOn": []
    }
  ]
}

After writing the file, reply with a one-line confirmation. Do not paste the JSON
into your reply.`;
}

/** Structural checks zod can't express: unique ids, known deps, no cycles. */
function validateDag(subtasks: PlanSubtask[]): void {
  const ids = new Set<string>();
  for (const s of subtasks) {
    if (ids.has(s.localId)) throw new Error(`duplicate subtask id: ${s.localId}`);
    ids.add(s.localId);
  }
  for (const s of subtasks) {
    for (const d of s.dependsOn) {
      if (!ids.has(d)) throw new Error(`subtask ${s.localId} depends on unknown id ${d}`);
    }
  }
  const adj = new Map(subtasks.map((s) => [s.localId, s.dependsOn]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (n: string) => {
    const st = state.get(n) ?? 0;
    if (st === 1) throw new Error("plan contains a dependency cycle");
    if (st === 2) return;
    state.set(n, 1);
    for (const d of adj.get(n) ?? []) visit(d);
    state.set(n, 2);
  };
  for (const s of subtasks) visit(s.localId);
}

function extractPlan(worktreePath: string, assistantText: string): BuildPlan {
  const filePath = path.join(worktreePath, PLAN_FILE);
  let raw: string | null = null;
  try {
    if (fs.existsSync(filePath)) raw = fs.readFileSync(filePath, "utf8");
  } catch { /* fall through to the assistant text */ }

  if (!raw) {
    const fenced = assistantText.match(/```(?:json)?\s*([\s\S]*?)```/);
    raw = fenced ? fenced[1] : assistantText.slice(assistantText.indexOf("{"));
  }
  if (!raw || !raw.trim()) throw new Error("planner produced no plan");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("planner output was not valid JSON");
    json = JSON.parse(raw.slice(start, end + 1));
  }

  // Parse, don't validate: the model's output is untrusted until it matches BuildPlan.
  const result = parse(BuildPlanSchema, json);
  if (!result.ok) throw new Error(`plan failed schema validation:\n${result.error}`);
  validateDag(result.value.subtasks);
  return result.value;
}

/**
 * Plan an epic: one read-only Claude turn produces a foundation-first build plan,
 * which we schema-validate and materialize as child jobs + the epic integration
 * branch. If the epic opted into the approval gate (`needsApproval`) it ends in
 * "plan_review" and waits for the user; otherwise it goes straight to
 * "delegating" and the scheduler takes over. Throws on failure so the caller
 * marks the epic failed.
 */
export async function planEpic(job: Job, project: Project): Promise<void> {
  const jobId = job.id;
  log(jobId, `Planning epic — "${job.title}"`);

  const { worktreePath } = createWorktree(project.localPath, `${jobId}-plan`, project.defaultBranch);

  try {
    const session = createClaudeSession(worktreePath);
    session.onChunk((text) => emitOutput(jobId, text));

    const baseRules = project.agentRules ? `${project.agentRules}\n\n` : "";
    const repoMap = buildRepoMap(worktreePath);
    const message = `${baseRules}${repoMap}\n---\n\n${plannerInstructions()}\n\n---\n\nTASK TO DECOMPOSE:\n\n${job.prompt}`;

    log(jobId, "Launching planner...");
    log(jobId, "-".repeat(40));
    const turn = await session.sendMessage(message);
    await updateUsage(jobId, turn.inputTokens, turn.outputTokens, turn.costUsd).catch(() => {});

    const plan = extractPlan(worktreePath, turn.assistantText);
    log(jobId, `Plan: ${plan.subtasks.length} subtask(s).`);

    const { branch } = ensureEpicWorktree(project.localPath, jobId, project.defaultBranch);

    const inputs: SubtaskInput[] = plan.subtasks.map((s) => ({
      localId: s.localId, title: s.title, prompt: s.prompt,
      touchedPaths: s.touchedPaths, dependsOn: s.dependsOn,
    }));
    await createChildren(jobId, inputs);

    const gate = job.needsApproval ? "plan_review" : "delegating";
    await setDelegatorPlan(jobId, JSON.stringify(plan), branch, gate);

    if (gate === "plan_review") {
      log(jobId, `Plan ready — awaiting your approval (${plan.subtasks.length} subtask(s), branch ${branch}).`);
    } else {
      log(jobId, `Delegating ${plan.subtasks.length} subtask(s) on ${branch}.`);
    }
  } finally {
    removeWorktree(project.localPath, worktreePath);
  }
}
