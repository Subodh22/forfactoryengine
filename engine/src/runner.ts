import fs from "node:fs";
import path from "node:path";
import {
  getJob, getProject, getSetting, listJobsByStatus, updateUsage, patchJob, updateProject, type Job, type Project,
} from "./db";
import { emitOutput, emitChat } from "./events";
import { updateStatus } from "./status";
import { createClaudeSession, type ClaudeSession, type ClaudeSessionOptions, type TurnResult } from "./agent/claude-runner";
import {
  createWorktree, removeWorktree, getChangedFiles, commitAndPushDirect, ensureRepoCloned,
  ensureEpicWorktree, commitOnly, mergeIntoBranch, pushBranch,
} from "./agent/worktree";
import { createPR } from "./agent/github";
import { buildRepoMap } from "./agent/repo-map";
import { parseDataUrl, safeFilename } from "./attachments";
import { sendJobNotification } from "./notify";
import { planEpic } from "./delegator";
import { startGuidedEpic, continueGuidedEpic, isGuided, reapGuided } from "./guided";
import { scheduleDelegationCheck } from "./delegator-scheduler";

// ── In-process queue ─────────────────────────────────────────────────────────
const MAX_CONCURRENT = Number(process.env.FACTORY_MAX_CONCURRENT ?? 3);
const queue: string[] = [];
const active = new Set<string>();

export function enqueue(jobId: string): void {
  if (active.has(jobId) || queue.includes(jobId)) return;
  queue.push(jobId);
  pump();
}

function pump(): void {
  while (active.size < MAX_CONCURRENT && queue.length > 0) {
    const jobId = queue.shift()!;
    active.add(jobId);
    void startJob(jobId).finally(() => {
      active.delete(jobId);
      pump();
    });
  }
}

/** Enqueue any "queued" jobs we haven't picked up — remote-created (Turso) jobs,
 *  scheduler-promoted children, or our own jobs left queued after a restart. */
export async function pickupQueued(): Promise<void> {
  for (const job of await listJobsByStatus("queued")) enqueue(job.id);
  if ((await listJobsByStatus("delegating")).length) scheduleDelegationCheck();
}

/** Recover jobs orphaned by a crash: anything stuck "running" can't really be in
 *  flight (this process just booted), so requeue it. */
export async function recoverOrphans(): Promise<void> {
  for (const job of await listJobsByStatus("running")) {
    await updateStatus(job.id, "queued").catch(() => {});
    enqueue(job.id);
  }
}

// ── Live session state ───────────────────────────────────────────────────────
const activeSessions = new Map<string, ClaudeSession>();
const processing = new Set<string>();
const cancelledJobs = new Set<string>();

interface ChildContext { parentJobId: string; epicBranch: string; epicWorktreePath: string }
interface LiveContext {
  worktreePath: string;
  branch: string;
  projectId: string;
  project: Project;
  title: string;
  busy: boolean;
  queue: { text: string; images: string[] }[];
  child?: ChildContext;
}
const liveContext = new Map<string, LiveContext>();

// Serialize the merge-into-epic step per epic so concurrent child tasks don't
// race on the shared integration branch.
const epicLocks = new Map<string, Promise<unknown>>();
function withEpicLock<T>(epicId: string, fn: () => Promise<T>): Promise<T> {
  const prev = epicLocks.get(epicId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  epicLocks.set(epicId, next.catch(() => {}));
  return next;
}

// Per-project session continuity — carry the session id across jobs so Claude
// doesn't cold-start every task. Reset when tokens approach the cap.
const TOKEN_RESUME_CAP = 60_000;
interface ProjectSession { sessionId: string; inputTokens: number }
const projectSessions = new Map<string, ProjectSession>();

function log(jobId: string, msg: string) {
  emitOutput(jobId, `[factory] ${msg}\n`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Text-like MIME types whose content should be inlined directly into the prompt
 *  so the agent sees them without needing to read from disk. */
const INLINE_MIME_PREFIXES = ["text/", "application/json", "application/yaml", "application/xml"];
function shouldInline(mime: string): boolean {
  return INLINE_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

/** Save base64 attachments to the worktree, return message text with their
 *  paths prepended so Claude can read them. Text-based files are inlined
 *  directly into the prompt so the agent doesn't need a separate Read call. */
function buildMessageWithAttachments(text: string, attachments: string[], worktreePath: string): string {
  if (!attachments.length) return text;
  const images: string[] = [];
  const inlined: { name: string; content: string }[] = [];
  const binaryFiles: string[] = [];
  for (const dataUrl of attachments) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) continue;
    const ext = parsed.mime.split("/")[1] || "bin";
    const name = parsed.name ? safeFilename(parsed.name) : `attachment.${ext}`;
    const unique = `_factory_${Date.now()}_${Math.random().toString(36).slice(2)}_${name}`;
    const dest = path.join(worktreePath, unique);
    fs.writeFileSync(dest, Buffer.from(parsed.base64, "base64"));

    if (parsed.isImage) {
      images.push(dest);
    } else if (shouldInline(parsed.mime)) {
      const content = Buffer.from(parsed.base64, "base64").toString("utf8");
      inlined.push({ name: parsed.name || name, content });
    } else {
      binaryFiles.push(dest);
    }
  }
  const refs: string[] = [];
  images.forEach((p, i) => refs.push(`Image ${i + 1}: ${p}`));
  binaryFiles.forEach((p, i) => refs.push(`File ${i + 1}: ${p}`));
  for (const { name, content } of inlined) {
    refs.push(`<attached_file name="${name}">\n${content}\n</attached_file>`);
  }
  if (!refs.length) return text;
  return `${refs.join("\n\n")}\n\n${text}`;
}

/** Copy the project's .env into a worktree so agents see the same env vars the
 *  user manages in the UI (git worktrees don't include untracked files). */
function copyEnvToWorktree(repoPath: string, worktreePath: string) {
  const src = path.join(repoPath, ".env");
  if (!fs.existsSync(src)) return;
  try { fs.copyFileSync(src, path.join(worktreePath, ".env")); } catch { /* non-fatal */ }
}

function readClaudeMd(dir: string): string | null {
  const p = path.join(dir, "CLAUDE.md");
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}

function sessionOptsFor(job: Job): ClaudeSessionOptions {
  return {
    ...(job.model ? { model: job.model } : {}),
    ...(job.effort ? { effort: job.effort as ClaudeSessionOptions["effort"] } : {}),
  };
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

// ── Job execution ────────────────────────────────────────────────────────────

export async function startJob(jobId: string): Promise<void> {
  if (processing.has(jobId)) return;
  processing.add(jobId);

  let worktreePath: string | undefined;
  let jobTitle: string | undefined;
  let project: Project | null = null;

  try {
    const job = await withRetry(() => getJob(jobId));
    if (!job) { processing.delete(jobId); return; }
    if (job.status === "cancelled") { processing.delete(jobId); return; }
    jobTitle = job.title;
    project = await withRetry(() => getProject(job.projectId));
    if (!project) {
      await updateStatus(jobId, "failed", { error: "project not found" });
      processing.delete(jobId);
      return;
    }

    await updateStatus(jobId, "running");

    // Make sure the repo lives on this machine (clones it on first run when the
    // project arrived with no usable localPath, e.g. created from a remote UI).
    const resolvedPath = ensureRepoCloned({
      repo: project.repo, localPath: project.localPath, githubToken: project.githubToken,
    });
    if (resolvedPath !== project.localPath) {
      log(jobId, `Cloned ${project.repo} to ${resolvedPath}`);
      await updateProject(job.projectId, { localPath: resolvedPath }).catch(() => {});
      project = { ...project, localPath: resolvedPath };
    }

    // -- Epic: plan & split, then hand to the scheduler ----------------------
    if (job.kind === "epic") {
      if (!job.delegatorPlan) {
        if (job.needsApproval) {
          await startGuidedEpic(job, project);   // guided: clarify → stack → plan_review
        } else {
          await planEpic(job, project);          // express: foundation-first, auto-build
          scheduleDelegationCheck();
        }
      }
      processing.delete(jobId);
      return;
    }

    // -- Child task: base off (and merge into) the epic's integration branch --
    let baseBranch = project.defaultBranch;
    let childCtx: ChildContext | undefined;
    const isChild = !!job.parentJobId;
    if (job.parentJobId) {
      const parent = await withRetry(() => getJob(job.parentJobId));
      const epic = ensureEpicWorktree(project.localPath, job.parentJobId, project.defaultBranch);
      baseBranch = parent?.branch || epic.branch;
      childCtx = { parentJobId: job.parentJobId, epicBranch: epic.branch, epicWorktreePath: epic.worktreePath };
    }

    log(jobId, `Job started — "${job.title}"`);

    // Worktree (reuse an existing one if a previous run left it).
    let branch: string;
    if (job.worktreePath && fs.existsSync(job.worktreePath)) {
      worktreePath = job.worktreePath;
      branch = job.branch || `job/${jobId}`;
      log(jobId, `Reusing worktree: ${worktreePath}`);
    } else {
      log(jobId, `Repo: ${project.localPath}`);
      log(jobId, "Creating git worktree…");
      const wt = createWorktree(project.localPath, jobId, baseBranch);
      worktreePath = wt.worktreePath;
      branch = wt.branch;
      copyEnvToWorktree(project.localPath, worktreePath);
      log(jobId, `Worktree ready: ${worktreePath}  (branch ${branch})`);
      await updateStatus(jobId, "running", { worktreePath, branch });
    }

    log(jobId, "Launching Claude Code CLI...");
    log(jobId, "-".repeat(40));

    // Resume the project's last session when safely below the token cap. Child
    // tasks stay isolated so parallel children don't contend on one session.
    const prevSession = isChild ? undefined : projectSessions.get(job.projectId);
    const resumeId = prevSession && prevSession.inputTokens < TOKEN_RESUME_CAP ? prevSession.sessionId : undefined;
    if (resumeId) log(jobId, `Resuming project session ${resumeId.slice(0, 8)}…`);

    const opts = sessionOptsFor(job);
    if (job.model) log(jobId, `Model: ${job.model}`);
    if (job.effort) log(jobId, `Effort: ${job.effort}`);

    let session = createClaudeSession(worktreePath, resumeId, opts);
    activeSessions.set(jobId, session);
    session.onSessionId((id) => { patchJob(jobId, { sessionId: id }).catch(() => {}); });
    session.onChunk((text) => emitOutput(jobId, text));

    const baseRules = project.agentRules ? `${project.agentRules}\n\n` : "";
    const hasClaude = readClaudeMd(worktreePath) !== null;
    const claudeHint = hasClaude
      ? "Read CLAUDE.md before starting.\n\n"
      : "No CLAUDE.md found — create one first, then do the task.\n\n";
    const repoMap = buildRepoMap(worktreePath);
    const effortNote = job.effort ? `Apply ${job.effort} reasoning effort to this task.\n\n` : "";
    const resumeNote = resumeId ? `You are continuing work on this project in a new worktree at: ${worktreePath}\n\n` : "";
    const systemContext = `${baseRules}${claudeHint}${effortNote}${resumeNote}${repoMap}\n---\n\n`;

    const promptWithImages = buildMessageWithAttachments(job.prompt, job.images, worktreePath);
    let turn = await session.sendMessage(systemContext + promptWithImages);
    await updateUsage(jobId, turn.inputTokens, turn.outputTokens, turn.costUsd);

    // If resume was stale ("No conversation found"), retry fresh immediately.
    const returnedNothing = !turn.assistantText.trim() && !turn.resultText.trim();
    if (returnedNothing && resumeId) {
      projectSessions.delete(job.projectId);
      log(jobId, "Stale session, retrying fresh...");
      cleanupSession(jobId);
      session = createClaudeSession(worktreePath, undefined, opts);
      activeSessions.set(jobId, session);
      session.onSessionId((id) => { patchJob(jobId, { sessionId: id }).catch(() => {}); });
      session.onChunk((text) => emitOutput(jobId, text));
      const freshContext = `${baseRules}${claudeHint}${effortNote}${repoMap}\n---\n\n`;
      turn = await session.sendMessage(freshContext + promptWithImages);
      await updateUsage(jobId, turn.inputTokens, turn.outputTokens, turn.costUsd);
    }
    const sid = session.getSessionId();
    if (sid && !isChild) projectSessions.set(job.projectId, { sessionId: sid, inputTokens: turn.inputTokens });

    if (reapIfCancelled(jobId, worktreePath, project)) return;
    await handleTurnResult({ jobId, title: job.title, turn, worktreePath, branch, projectId: job.projectId, project, child: childCtx });
    processing.delete(jobId);
  } catch (err) {
    if (reapIfCancelled(jobId, worktreePath, project)) return;
    processing.delete(jobId);
    cleanupSession(jobId);
    const msg = String(err);
    console.error(`[startJob] unhandled error for ${jobId}: ${msg}`);
    log(jobId, `FATAL: ${msg}`);
    await updateStatus(jobId, "failed", { error: msg }).catch(() => {});
    await sendJobNotification({ jobId, title: jobTitle, status: "failed", projectName: project?.name, error: msg }).catch(() => {});
    if (worktreePath && project) {
      try { removeWorktree(project.localPath, worktreePath); } catch { /* ignore */ }
    }
    scheduleDelegationCheck();
  }
}

function cleanupSession(jobId: string) {
  const session = activeSessions.get(jobId);
  if (session) { session.cancel(); activeSessions.delete(jobId); }
  liveContext.delete(jobId);
}

function reapIfCancelled(jobId: string, worktreePath: string | undefined, project: { localPath: string } | null): boolean {
  if (!cancelledJobs.has(jobId)) return false;
  cancelledJobs.delete(jobId);
  processing.delete(jobId);
  cleanupSession(jobId);
  log(jobId, "Stopped by user.");
  if (worktreePath && project) {
    try { removeWorktree(project.localPath, worktreePath); } catch { /* ignore */ }
  }
  return true;
}

function responseHasQuestion(text: string): boolean {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  return lines[lines.length - 1].trim().endsWith("?");
}

interface TurnResultArgs {
  jobId: string;
  title: string;
  turn: TurnResult;
  worktreePath: string;
  branch: string;
  projectId: string;
  project: Project;
  child?: ChildContext;
}

async function handleTurnResult({ jobId, title, turn, worktreePath, branch, projectId, project, child }: TurnResultArgs): Promise<void> {
  log(jobId, "-".repeat(40));

  const claudeResponse = turn.assistantText.trim() || turn.resultText.trim();
  if (claudeResponse) emitChat(jobId, "assistant", claudeResponse);

  const changedFiles = getChangedFiles(worktreePath);
  log(jobId, `Changed files: ${changedFiles.length > 0 ? changedFiles.join(", ") : "none"}`);

  if (changedFiles.length === 0) {
    // A question with no changes → wait for the user to reply in the chat panel.
    if (responseHasQuestion(claudeResponse)) {
      const existing = liveContext.get(jobId);
      liveContext.set(jobId, {
        worktreePath, branch, projectId, project, title,
        busy: existing?.busy ?? false, queue: existing?.queue ?? [], child,
      });
      await updateStatus(jobId, "waiting_for_input");
      log(jobId, "Waiting for your reply — answer in the chat panel to continue.");
      return; // session stays alive
    }
    cleanupSession(jobId);
    await updateStatus(jobId, "completed");
    log(jobId, "Job completed successfully.");
    await sendJobNotification({ jobId, title, status: "completed", projectName: project.name }).catch(() => {});
    removeWorktree(project.localPath, worktreePath);
    if (child) scheduleDelegationCheck();
    return;
  }

  // Claude made changes.
  cleanupSession(jobId);

  // Delegated child task: commit on its branch, merge into the epic branch.
  if (child) {
    try {
      log(jobId, `Committing subtask to ${branch}...`);
      const committed = commitOnly(worktreePath, `feat: ${title}\n\nAutomated by Factory (delegated)`);
      if (committed) {
        await withEpicLock(child.parentJobId, async () =>
          mergeIntoBranch(child.epicWorktreePath, branch, `merge ${branch} into ${child.epicBranch}`));
        log(jobId, `Merged subtask into ${child.epicBranch}.`);
      } else {
        log(jobId, "No changes to merge.");
      }
      await updateStatus(jobId, "completed", { touchedPaths: changedFiles });
      log(jobId, "Subtask completed.");
    } catch (err) {
      const msg = String(err);
      log(jobId, `ERROR merging subtask: ${msg}`);
      await updateStatus(jobId, "failed", { error: msg });
    } finally {
      removeWorktree(project.localPath, worktreePath);
      scheduleDelegationCheck();
    }
    return;
  }

  // Plain job: open a PR if we have a GitHub repo + token, else push directly.
  try {
    const token = project.githubToken || (await getSetting("githubToken")) || "";
    if (project.repo.includes("/") && token) {
      log(jobId, `Committing and opening a PR…`);
      const committed = commitOnly(worktreePath, `feat: ${title}\n\nAutomated by Factory`);
      if (committed) {
        pushBranch(worktreePath, branch);
        const [owner, repo] = project.repo.split("/");
        const pr = await createPR(token, owner!, repo!, branch, project.defaultBranch, title, "Automated by Factory.");
        await updateStatus(jobId, "completed", { touchedPaths: changedFiles, prUrl: pr.url, prNumber: pr.number });
        log(jobId, `Opened PR #${pr.number}: ${pr.url}`);
      } else {
        await updateStatus(jobId, "completed", { touchedPaths: changedFiles });
        log(jobId, "Nothing to commit.");
      }
    } else {
      log(jobId, `Pushing changes to ${project.defaultBranch}...`);
      commitAndPushDirect(worktreePath, `feat: ${title}\n\nAutomated by Factory`, project.defaultBranch);
      await updateStatus(jobId, "completed", { touchedPaths: changedFiles });
      log(jobId, `Merged to ${project.defaultBranch}.`);
    }
    log(jobId, "Job completed successfully.");
    await sendJobNotification({ jobId, title, status: "completed", projectName: project.name, changedFiles }).catch(() => {});
  } catch (err) {
    const msg = String(err);
    log(jobId, `ERROR during commit/push: ${msg}`);
    await updateStatus(jobId, "failed", { error: msg });
    await sendJobNotification({ jobId, title, status: "failed", projectName: project.name, error: msg }).catch(() => {});
  } finally {
    removeWorktree(project.localPath, worktreePath);
  }
}

// ── Cancellation ─────────────────────────────────────────────────────────────

export function cancelJob(jobId: string): void {
  if (processing.has(jobId)) cancelledJobs.add(jobId);
  reapGuided(jobId);
  cleanupSession(jobId);
  processing.delete(jobId);
  const i = queue.indexOf(jobId);
  if (i >= 0) queue.splice(i, 1);
}

export function getActiveJobIds(): string[] {
  return Array.from(new Set([...processing, ...activeSessions.keys()]));
}

// ── Ephemeral chat ───────────────────────────────────────────────────────────

/** Entry point for a user reply (POST /api/reply/:jobId). Returns true if the
 *  reply was accepted (a live session exists, or a finished job can be resumed). */
export async function deliverReply(jobId: string, text: string, images: string[]): Promise<boolean> {
  if (isGuided(jobId)) return continueGuidedEpic(jobId, text); // guided discovery owns its replies
  // A clarifying epic whose in-memory session was lost (engine restart) — rehydrate it.
  const guidedJob = await getJob(jobId).catch(() => null);
  if (guidedJob?.status === "clarifying") return continueGuidedEpic(jobId, text);
  const ctx = liveContext.get(jobId);
  if (ctx && activeSessions.has(jobId)) {
    ctx.queue.push({ text, images });
    if (!ctx.busy) void drainReplies(jobId);
    return true;
  }
  return continueJob(jobId, text, images);
}

async function drainReplies(jobId: string): Promise<void> {
  const session = activeSessions.get(jobId);
  const ctx = liveContext.get(jobId);
  if (!session || !ctx || ctx.busy) return;

  ctx.busy = true;
  processing.add(jobId);

  try {
    await updateStatus(jobId, "running", { worktreePath: ctx.worktreePath, branch: ctx.branch });

    let turn: TurnResult | null = null;
    while (ctx.queue.length) {
      if (reapIfCancelled(jobId, ctx.worktreePath, ctx.project)) return;
      const pending = ctx.queue.splice(0, ctx.queue.length);
      const combined = pending.map((p) => p.text).filter(Boolean).join("\n\n");
      const allImages = pending.flatMap((p) => p.images);
      log(jobId, `User replied: "${combined}"`);
      log(jobId, "-".repeat(40));
      const message = buildMessageWithAttachments(combined, allImages, ctx.worktreePath);
      turn = await session.sendMessage(message);
      await updateUsage(jobId, turn.inputTokens, turn.outputTokens, turn.costUsd);
      const sid = session.getSessionId();
      if (sid) projectSessions.set(ctx.projectId, { sessionId: sid, inputTokens: turn.inputTokens });
    }

    if (!turn) return;
    if (reapIfCancelled(jobId, ctx.worktreePath, ctx.project)) return;
    await handleTurnResult({
      jobId, title: ctx.title, turn, worktreePath: ctx.worktreePath, branch: ctx.branch,
      projectId: ctx.projectId, project: ctx.project, child: ctx.child,
    });
  } catch (err) {
    if (reapIfCancelled(jobId, ctx.worktreePath, ctx.project)) return;
    const msg = String(err);
    log(jobId, `FATAL: ${msg}`);
    cleanupSession(jobId);
    await updateStatus(jobId, "failed", { error: msg }).catch(() => {});
  } finally {
    processing.delete(jobId);
    const c = liveContext.get(jobId);
    if (c) { c.busy = false; if (c.queue.length) void drainReplies(jobId); }
  }
}

/** Resume a finished job by its saved session id so the user can keep chatting.
 *  Also supports epic jobs (which may not have a session id) by starting fresh. */
async function continueJob(jobId: string, text: string, images: string[]): Promise<boolean> {
  if (activeSessions.has(jobId)) return false;

  const job = await getJob(jobId).catch(() => null);
  if (!job) return false;
  const project = await getProject(job.projectId).catch(() => null);
  if (!project) return false;

  let worktreePath: string;
  let branch: string;
  let childCtx: ChildContext | undefined;
  try {
    if (job.kind === "epic") {
      // Epic: use the integration worktree so the user chats in the merged context.
      const epic = ensureEpicWorktree(project.localPath, jobId, project.defaultBranch);
      worktreePath = epic.worktreePath;
      branch = epic.branch;
    } else if (job.worktreePath && fs.existsSync(job.worktreePath)) {
      worktreePath = job.worktreePath;
      branch = job.branch || `job/${jobId}`;
    } else {
      const baseBranch = job.parentJobId
        ? ((await getJob(job.parentJobId).catch(() => null))?.branch || project.defaultBranch)
        : project.defaultBranch;
      const wt = createWorktree(project.localPath, jobId, baseBranch);
      worktreePath = wt.worktreePath;
      branch = wt.branch;
      copyEnvToWorktree(project.localPath, worktreePath);
    }
    if (job.parentJobId) {
      const epic = ensureEpicWorktree(project.localPath, job.parentJobId, project.defaultBranch);
      childCtx = { parentJobId: job.parentJobId, epicBranch: epic.branch, epicWorktreePath: epic.worktreePath };
    }
  } catch (err) {
    log(jobId, `Could not reopen worktree to continue: ${String(err)}`);
    return false;
  }

  await updateStatus(jobId, "running", { worktreePath, branch }).catch(() => {});

  const resumeId = job.sessionId || undefined;
  if (resumeId) log(jobId, `Resuming session ${resumeId.slice(0, 8)}… to continue the conversation.`);
  else log(jobId, "Starting a new conversation…");

  const session = createClaudeSession(worktreePath, resumeId, sessionOptsFor(job));
  activeSessions.set(jobId, session);
  session.onSessionId((id) => { patchJob(jobId, { sessionId: id }).catch(() => {}); });
  session.onChunk((t) => emitOutput(jobId, t));

  liveContext.set(jobId, {
    worktreePath, branch, projectId: job.projectId, project, title: job.title,
    busy: false, queue: [{ text, images }], child: childCtx,
  });
  void drainReplies(jobId);
  return true;
}
