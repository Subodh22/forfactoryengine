import fs from "node:fs";
import path from "node:path";
import { createClaudeSession, type ClaudeSession } from "./agent/claude-runner";
import { createWorktree, removeWorktree, ensureEpicWorktree } from "./agent/worktree";
import { emitOutput, emitChat } from "./events";
import { updateStatus } from "./status";
import { createChildren, setDelegatorPlan, updateUsage, patchJob, getJob, getProject, type Job, type Project, type SubtaskInput } from "./db";
import { validateDag } from "./delegator";
import { ClarifyOutputSchema, DiscoveryResultSchema, parse, type StackChoice, type BuildPlan } from "./schema";

/**
 * The GUIDED create pipeline (a discovery conversation that precedes the build):
 *   clarify  → user answers → stack proposal + foundation-first plan → plan_review
 * It runs on its own Claude session, kept alive across turns, and is deliberately
 * isolated from the normal job chat loop (runner.ts) so it can't regress it.
 * Express mode does NOT come here — it plans + builds directly (delegator.planEpic).
 */
interface GuidedSession {
  session: ClaudeSession;
  worktreePath: string;
  project: Project;
  busy: boolean;
}
const sessions = new Map<string, GuidedSession>();

export function isGuided(jobId: string): boolean {
  return sessions.has(jobId);
}

function log(jobId: string, msg: string) {
  emitOutput(jobId, `[factory] ${msg}\n`);
}

/** Read a JSON artifact the model wrote under .factory/, falling back to its reply. */
export function readJsonArtifact(worktreePath: string, file: string, assistantText: string): unknown {
  let raw: string | null = null;
  try {
    const p = path.join(worktreePath, ".factory", file);
    if (fs.existsSync(p)) raw = fs.readFileSync(p, "utf8");
  } catch { /* fall through */ }
  if (!raw) {
    const fenced = assistantText.match(/```(?:json)?\s*([\s\S]*?)```/);
    raw = fenced ? fenced[1] : assistantText.slice(assistantText.indexOf("{"));
  }
  if (!raw || !raw.trim()) throw new Error("model produced no JSON");
  try { return JSON.parse(raw); }
  catch {
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("model output was not valid JSON");
    return JSON.parse(raw.slice(start, end + 1));
  }
}

function cleanup(jobId: string): void {
  const g = sessions.get(jobId);
  if (!g) return;
  try { g.session.cancel(); } catch { /* ignore */ }
  try { removeWorktree(g.project.localPath, g.worktreePath); } catch { /* ignore */ }
  sessions.delete(jobId);
}

/** Called when a cancelled guided epic needs its resources released. */
export function reapGuided(jobId: string): void {
  if (sessions.has(jobId)) cleanup(jobId);
}

/** Entry point: start the discovery conversation for a guided epic. */
export async function startGuidedEpic(job: Job, project: Project): Promise<void> {
  const jobId = job.id;
  const { worktreePath } = createWorktree(project.localPath, `${jobId}-discovery`, project.defaultBranch);
  const session = createClaudeSession(worktreePath);
  session.onSessionId((id) => { patchJob(jobId, { sessionId: id }).catch(() => {}); });
  session.onChunk((t) => emitOutput(jobId, t));
  sessions.set(jobId, { session, worktreePath, project, busy: false });

  await updateStatus(jobId, "clarifying");
  log(jobId, "Discovery — figuring out what to build before writing any code...");
  await runClarify(jobId, job.prompt);
}

async function runClarify(jobId: string, description: string): Promise<void> {
  const g = sessions.get(jobId);
  if (!g) return;
  g.busy = true;
  try {
    const prompt = `You are the FACTORY INTAKE agent for a brand-new software project. The user wrote:

"""
${description}
"""

Ask the MOST IMPORTANT 3-6 clarifying questions whose answers would materially
change what you build — e.g. core features & scope, who the users are,
data/persistence, auth, key integrations, deploy target. Do NOT ask about the
tech stack; you will recommend that yourself afterwards.

Create the directory .factory and WRITE your questions as JSON to
.factory/clarify.json matching exactly:
{ "questions": [ { "id": "q1", "question": "…", "suggestions": ["…", "…"] } ] }
Then reply with a one-line note. Do not paste the JSON into your reply.`;

    const turn = await g.session.sendMessage(prompt);
    await updateUsage(jobId, turn.inputTokens, turn.outputTokens, turn.costUsd).catch(() => {});

    const parsed = parse(ClarifyOutputSchema, readJsonArtifact(g.worktreePath, "clarify.json", turn.assistantText));
    if (!parsed.ok || parsed.value.questions.length === 0) {
      log(jobId, "No clarifying questions — proceeding straight to a plan.");
      await runStackAndPlan(jobId, "(the user did not provide extra detail — use sensible defaults)");
      return;
    }

    const md = [
      "I need a few details before I build this:",
      "",
      ...parsed.value.questions.map((q, i) =>
        `**${i + 1}. ${q.question}**${q.suggestions.length ? `\n_e.g. ${q.suggestions.join(" · ")}_` : ""}`),
      "",
      "Reply with your answers and I'll propose the best stack and a build plan.",
    ].join("\n");
    emitChat(jobId, "assistant", md);
    log(jobId, "Posted clarifying questions — answer them in the chat panel to continue.");
  } catch (err) {
    fail(jobId, `clarify failed: ${String(err)}`);
  } finally {
    const gg = sessions.get(jobId);
    if (gg) gg.busy = false;
  }
}

/** Rebuild a lost discovery session by resuming the saved Claude session id — the
 *  engine may have restarted while the epic was mid-clarify (in-memory state is
 *  wiped on restart). Returns null if it can't be resumed. */
async function rehydrate(jobId: string): Promise<GuidedSession | undefined> {
  const job = await getJob(jobId).catch(() => null);
  if (!job || !job.sessionId) return undefined;
  const project = await getProject(job.projectId).catch(() => null);
  if (!project) return undefined;
  const { worktreePath } = createWorktree(project.localPath, `${jobId}-discovery`, project.defaultBranch);
  const session = createClaudeSession(worktreePath, job.sessionId); // resume discovery context
  session.onSessionId((id) => { patchJob(jobId, { sessionId: id }).catch(() => {}); });
  session.onChunk((t) => emitOutput(jobId, t));
  const g: GuidedSession = { session, worktreePath, project, busy: false };
  sessions.set(jobId, g);
  return g;
}

/** A user reply to a guided epic. Returns true if it was handled here. */
export async function continueGuidedEpic(jobId: string, text: string): Promise<boolean> {
  let g = sessions.get(jobId);
  if (!g) {
    g = await rehydrate(jobId); // engine restarted mid-discovery — rebuild from the saved session
    if (!g) return false;
    log(jobId, "Resumed discovery after an engine restart.");
  }
  if (g.busy) return true; // a turn is already running; drop concurrent replies
  emitChat(jobId, "user", text);
  await updateStatus(jobId, "running").catch(() => {});
  await runStackAndPlan(jobId, text);
  return true;
}

async function runStackAndPlan(jobId: string, answers: string): Promise<void> {
  const g = sessions.get(jobId);
  if (!g) return;
  g.busy = true;
  try {
    log(jobId, "Choosing a stack and drafting a build plan...");
    const prompt = `Using the user's answers below, do TWO things.

User's answers:
"""
${answers}
"""

1) Pick the BEST tech stack for THIS project and compare it against 1-2 real
   alternatives with concrete tradeoffs (pros/cons). Recommend exactly one.
2) Produce a FOUNDATION-FIRST build plan: EXACTLY ONE subtask with "role":
   "scaffold" that establishes the stack, structure, conventions and a minimal
   END-TO-END WORKING SKELETON; every other subtask has "role": "feature" and
   lists the scaffold's localId in "dependsOn". Decompose CONSERVATIVELY — if the
   app is small, a single scaffold subtask is the right plan. Parallel subtasks
   must have disjoint "touchedPaths". Each subtask "prompt" must be fully
   self-contained for a fresh agent.

Create the directory .factory and WRITE your result as JSON to .factory/plan.json
matching EXACTLY:
{
  "stack": { "recommended": "Next.js + Postgres",
             "rationale": "why this wins for this project",
             "options": [ { "name": "Next.js + Postgres", "pros": ["…"], "cons": ["…"] } ] },
  "plan": { "summary": "one line",
            "subtasks": [ { "localId": "t1", "title": "Scaffold", "prompt": "…",
                            "role": "scaffold", "touchedPaths": ["."], "dependsOn": [] } ] }
}
Then reply with a one-line note. Do not paste the JSON into your reply.`;

    const turn = await g.session.sendMessage(prompt);
    await updateUsage(jobId, turn.inputTokens, turn.outputTokens, turn.costUsd).catch(() => {});

    const parsed = parse(DiscoveryResultSchema, readJsonArtifact(g.worktreePath, "plan.json", turn.assistantText));
    if (!parsed.ok) throw new Error(`plan failed schema validation:\n${parsed.error}`);
    const { stack, plan } = parsed.value;
    validateDag(plan.subtasks);

    const { branch } = ensureEpicWorktree(g.project.localPath, jobId, g.project.defaultBranch);
    const inputs: SubtaskInput[] = plan.subtasks.map((s) => ({
      localId: s.localId, title: s.title, prompt: s.prompt,
      touchedPaths: s.touchedPaths, dependsOn: s.dependsOn,
    }));
    await createChildren(jobId, inputs);
    // Store stack alongside the plan; finalizeEpic still reads `.subtasks`.
    await setDelegatorPlan(jobId, JSON.stringify({ ...plan, stack }), branch, "plan_review");

    const summary = renderProposal(stack, plan);
    emitChat(jobId, "assistant", summary);
    emitOutput(jobId, `\n${summary}\n`); // persisted copy
    log(jobId, "Plan ready — review it and click Approve & Build to start.");
    // Discovery session is done; children build later in their own worktrees.
    cleanup(jobId);
  } catch (err) {
    fail(jobId, `planning failed: ${String(err)}`);
  } finally {
    const gg = sessions.get(jobId);
    if (gg) gg.busy = false;
  }
}

function renderProposal(stack: StackChoice, plan: BuildPlan): string {
  const lines: string[] = [];
  lines.push(`### Recommended stack: ${stack.recommended}`, "", stack.rationale, "");
  lines.push("| Option | Pros | Cons |", "| --- | --- | --- |");
  for (const o of stack.options) {
    lines.push(`| ${o.name === stack.recommended ? `**${o.name}** ✅` : o.name} | ${o.pros.join("; ") || "—"} | ${o.cons.join("; ") || "—"} |`);
  }
  lines.push("", `### Build plan${plan.summary ? ` — ${plan.summary}` : ""}`, "");
  for (const s of plan.subtasks) {
    lines.push(`- ${s.role === "scaffold" ? "🏗️ " : ""}**${s.title}**${s.dependsOn.length ? ` _(after ${s.dependsOn.join(", ")})_` : ""}`);
  }
  lines.push("", "**Approve & Build** to start, or reply with changes.");
  return lines.join("\n");
}

function fail(jobId: string, msg: string): void {
  log(jobId, msg);
  void updateStatus(jobId, "failed", { error: msg }).catch(() => {});
  cleanup(jobId);
}
