import { createClient, type Client, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// Embedded local libSQL database — a single file on disk. This is the source of
// truth: all reads/writes are local and unmetered. When Turso is configured the
// engine connects DIRECTLY to the cloud DB so the engine and a hosted app share
// one live database.
const dataDir = process.env.FACTORY_DATA_DIR ?? process.cwd();
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "factory.db");

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

export const db: Client = tursoUrl
  ? createClient({ url: tursoUrl, authToken })
  : createClient({ url: `file:${dbPath}` });

export const cloudSyncEnabled = Boolean(tursoUrl);

// ── Types ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  localPath: string;
  repo: string;
  defaultBranch: string;
  githubToken: string;
  agentRules: string;
  color: string;
  sessionPrefix: string;
  createdAt: number;
}

export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_for_input"
  | "clarifying"    // guided create: agent is asking the user questions
  | "plan_review"   // epic planned; awaiting the user's "Approve & Build"
  | "delegating";

export type JobKind = "epic" | "task" | "";
export type JobEffort = "low" | "medium" | "high" | "max" | "";
// Who carries out a task. "" / "agent" → Claude runs it; "human" → you do it by
// hand and tick it off. Only meaningful for tasks inside a manual plan.
export type JobAssignee = "" | "agent" | "human";

// Push lifecycle, tracked separately from job status: the agent's work can
// succeed while the push to GitHub still fails. "" = nothing to push (yet).
export type PushState = "" | "pushing" | "pushed" | "needs_help";

export interface Job {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  images: string[];
  status: JobStatus;
  kind: JobKind;
  parentJobId: string;
  priority: number;
  touchedPaths: string[];
  blockedBy: string[];
  assignee: JobAssignee;
  worktreePath: string;
  branch: string;
  prUrl: string;
  prNumber: number;
  error: string;
  pushState: PushState;
  pushAttempts: number;
  pushError: string;
  pushedSha: string;
  pushedTo: string;
  sessionId: string;
  /** The commit recorded when the job's work landed — lets the diff endpoint
   *  show "what this job changed" long after its worktree/branch is gone. */
  commitSha: string;
  delegatorPlan: string;
  needsApproval: boolean;
  model: string;
  effort: JobEffort;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  mergedToMain: boolean;
  startedAt: number;
  completedAt: number;
  createdAt: number;
}

// ── Schema ──────────────────────────────────────────────────────────────────

export async function initSchema(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      local_path     TEXT NOT NULL DEFAULT '',
      repo           TEXT NOT NULL DEFAULT '',
      default_branch TEXT NOT NULL DEFAULT 'main',
      github_token   TEXT NOT NULL DEFAULT '',
      agent_rules    TEXT NOT NULL DEFAULT '',
      color          TEXT NOT NULL DEFAULT '',
      session_prefix TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL DEFAULT '',
      title          TEXT NOT NULL,
      prompt         TEXT NOT NULL DEFAULT '',
      images         TEXT NOT NULL DEFAULT '[]',
      status         TEXT NOT NULL DEFAULT 'pending',
      kind           TEXT NOT NULL DEFAULT '',
      parent_job_id  TEXT NOT NULL DEFAULT '',
      priority       INTEGER NOT NULL DEFAULT 50,
      touched_paths  TEXT NOT NULL DEFAULT '[]',
      blocked_by     TEXT NOT NULL DEFAULT '[]',
      worktree_path  TEXT NOT NULL DEFAULT '',
      branch         TEXT NOT NULL DEFAULT '',
      pr_url         TEXT NOT NULL DEFAULT '',
      pr_number      INTEGER NOT NULL DEFAULT 0,
      error          TEXT NOT NULL DEFAULT '',
      push_state     TEXT NOT NULL DEFAULT '',
      push_attempts  INTEGER NOT NULL DEFAULT 0,
      push_error     TEXT NOT NULL DEFAULT '',
      pushed_sha     TEXT NOT NULL DEFAULT '',
      pushed_to      TEXT NOT NULL DEFAULT '',
      session_id     TEXT NOT NULL DEFAULT '',
      commit_sha     TEXT NOT NULL DEFAULT '',
      delegator_plan TEXT NOT NULL DEFAULT '',
      needs_approval INTEGER NOT NULL DEFAULT 0,
      model          TEXT NOT NULL DEFAULT '',
      effort         TEXT NOT NULL DEFAULT '',
      input_tokens   INTEGER NOT NULL DEFAULT 0,
      output_tokens  INTEGER NOT NULL DEFAULT 0,
      cost_usd       REAL NOT NULL DEFAULT 0,
      started_at     INTEGER NOT NULL DEFAULT 0,
      completed_at   INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    )
  `);
  // Upgrade older DBs: add any columns that predate this version (ignored if present).
  // Must run BEFORE the indexes below, which reference new columns.
  const projectCols: [string, string][] = [
    ["color", "TEXT NOT NULL DEFAULT ''"],
    ["session_prefix", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of projectCols) {
    try { await db.execute(`ALTER TABLE projects ADD COLUMN ${col} ${def}`); } catch { /* exists */ }
  }
  const jobCols: [string, string][] = [
    ["images", "TEXT NOT NULL DEFAULT '[]'"],
    ["kind", "TEXT NOT NULL DEFAULT ''"],
    ["parent_job_id", "TEXT NOT NULL DEFAULT ''"],
    ["priority", "INTEGER NOT NULL DEFAULT 50"],
    ["touched_paths", "TEXT NOT NULL DEFAULT '[]'"],
    ["blocked_by", "TEXT NOT NULL DEFAULT '[]'"],
    ["worktree_path", "TEXT NOT NULL DEFAULT ''"],
    ["pr_url", "TEXT NOT NULL DEFAULT ''"],
    ["pr_number", "INTEGER NOT NULL DEFAULT 0"],
    ["push_state", "TEXT NOT NULL DEFAULT ''"],
    ["push_attempts", "INTEGER NOT NULL DEFAULT 0"],
    ["push_error", "TEXT NOT NULL DEFAULT ''"],
    ["pushed_sha", "TEXT NOT NULL DEFAULT ''"],
    ["pushed_to", "TEXT NOT NULL DEFAULT ''"],
    ["session_id", "TEXT NOT NULL DEFAULT ''"],
    ["delegator_plan", "TEXT NOT NULL DEFAULT ''"],
    ["needs_approval", "INTEGER NOT NULL DEFAULT 0"],
    ["model", "TEXT NOT NULL DEFAULT ''"],
    ["effort", "TEXT NOT NULL DEFAULT ''"],
    ["input_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["output_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["cost_usd", "REAL NOT NULL DEFAULT 0"],
    ["merged_to_main", "INTEGER NOT NULL DEFAULT 0"],
    ["started_at", "INTEGER NOT NULL DEFAULT 0"],
    ["completed_at", "INTEGER NOT NULL DEFAULT 0"],
    ["assignee", "TEXT NOT NULL DEFAULT ''"],
    ["commit_sha", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of jobCols) {
    try { await db.execute(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`); } catch { /* exists */ }
  }
  // Migrate legacy "done" status from the pre-rewrite schema to "completed".
  try { await db.execute("UPDATE jobs SET status = 'completed' WHERE status = 'done'"); } catch { /* ignore */ }

  // Indexes last — after migrations have ensured the referenced columns exist.
  await db.execute(`CREATE INDEX IF NOT EXISTS jobs_by_created ON jobs (created_at DESC)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS jobs_by_status ON jobs (status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS jobs_by_parent ON jobs (parent_job_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const res = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return res.rows[0] ? String(res.rows[0].value) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonArray(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ── Projects ──────────────────────────────────────────────────────────────

function rowToProject(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    localPath: String(r.local_path),
    repo: String(r.repo),
    defaultBranch: String(r.default_branch),
    githubToken: String(r.github_token),
    agentRules: String(r.agent_rules),
    color: String(r.color ?? ""),
    sessionPrefix: String(r.session_prefix ?? ""),
    createdAt: Number(r.created_at),
  };
}

export async function listProjects(): Promise<Project[]> {
  const res = await db.execute("SELECT * FROM projects ORDER BY created_at DESC");
  return res.rows.map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const res = await db.execute({ sql: "SELECT * FROM projects WHERE id = ?", args: [id] });
  return res.rows[0] ? rowToProject(res.rows[0]) : null;
}

export async function createProject(input: {
  name: string; localPath?: string; repo?: string; defaultBranch?: string;
  githubToken?: string; agentRules?: string; color?: string; sessionPrefix?: string;
}): Promise<Project> {
  const p: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    localPath: input.localPath ?? "",
    repo: input.repo ?? "",
    defaultBranch: input.defaultBranch ?? "main",
    githubToken: input.githubToken ?? "",
    agentRules: input.agentRules ?? "",
    color: input.color ?? "",
    sessionPrefix: input.sessionPrefix ?? "",
    createdAt: Date.now(),
  };
  await db.execute({
    sql: `INSERT INTO projects (id, name, local_path, repo, default_branch, github_token, agent_rules, color, session_prefix, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [p.id, p.name, p.localPath, p.repo, p.defaultBranch, p.githubToken, p.agentRules, p.color, p.sessionPrefix, p.createdAt],
  });
  return p;
}

const PROJECT_COLUMNS: Record<string, string> = {
  name: "name", localPath: "local_path", repo: "repo", defaultBranch: "default_branch",
  githubToken: "github_token", agentRules: "agent_rules", color: "color", sessionPrefix: "session_prefix",
};

export async function updateProject(
  id: string,
  fields: Partial<Pick<Project, "name" | "localPath" | "repo" | "defaultBranch" | "githubToken" | "agentRules" | "color" | "sessionPrefix">>,
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = PROJECT_COLUMNS[k];
    if (!col || v === undefined) continue;
    sets.push(`${col} = ?`);
    args.push(v as string);
  }
  if (!sets.length) return;
  args.push(id);
  await db.execute({ sql: `UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, args });
}

export async function removeProject(id: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM projects WHERE id = ?", args: [id] });
}

// ── Jobs ────────────────────────────────────────────────────────────────────

function rowToJob(r: Row): Job {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    title: String(r.title),
    prompt: String(r.prompt),
    images: parseJsonArray(r.images),
    status: String(r.status) as JobStatus,
    kind: String(r.kind ?? "") as JobKind,
    parentJobId: String(r.parent_job_id ?? ""),
    priority: Number(r.priority ?? 50),
    touchedPaths: parseJsonArray(r.touched_paths),
    blockedBy: parseJsonArray(r.blocked_by),
    assignee: String(r.assignee ?? "") as JobAssignee,
    worktreePath: String(r.worktree_path ?? ""),
    branch: String(r.branch ?? ""),
    prUrl: String(r.pr_url ?? ""),
    prNumber: Number(r.pr_number ?? 0),
    error: String(r.error ?? ""),
    pushState: String(r.push_state ?? "") as PushState,
    pushAttempts: Number(r.push_attempts ?? 0),
    pushError: String(r.push_error ?? ""),
    pushedSha: String(r.pushed_sha ?? ""),
    pushedTo: String(r.pushed_to ?? ""),
    sessionId: String(r.session_id ?? ""),
    commitSha: String(r.commit_sha ?? ""),
    delegatorPlan: String(r.delegator_plan ?? ""),
    needsApproval: Boolean(Number(r.needs_approval ?? 0)),
    model: String(r.model ?? ""),
    effort: String(r.effort ?? "") as JobEffort,
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
    mergedToMain: Boolean(Number(r.merged_to_main ?? 0)),
    startedAt: Number(r.started_at ?? 0),
    completedAt: Number(r.completed_at ?? 0),
    createdAt: Number(r.created_at),
  };
}

export async function listJobs(projectId?: string, limit = 500): Promise<Job[]> {
  const res = projectId
    ? await db.execute({ sql: "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?", args: [projectId, limit] })
    : await db.execute({ sql: "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return res.rows.map(rowToJob);
}

export async function listJobsByStatus(status: JobStatus): Promise<Job[]> {
  const res = await db.execute({ sql: "SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC", args: [status] });
  return res.rows.map(rowToJob);
}

export async function getJob(id: string): Promise<Job | null> {
  const res = await db.execute({ sql: "SELECT * FROM jobs WHERE id = ?", args: [id] });
  return res.rows[0] ? rowToJob(res.rows[0]) : null;
}

export async function childrenOf(parentJobId: string): Promise<Job[]> {
  const res = await db.execute({ sql: "SELECT * FROM jobs WHERE parent_job_id = ?", args: [parentJobId] });
  return res.rows.map(rowToJob).sort((a, b) => a.priority - b.priority);
}

export async function createJob(input: {
  id?: string;
  projectId: string; title: string; prompt: string;
  images?: string[]; status?: JobStatus; kind?: JobKind; parentJobId?: string;
  priority?: number; touchedPaths?: string[]; blockedBy?: string[];
  model?: string; effort?: JobEffort; needsApproval?: boolean;
  assignee?: JobAssignee; delegatorPlan?: string;
}): Promise<Job> {
  const job: Job = {
    id: input.id || crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title,
    prompt: input.prompt,
    images: input.images ?? [],
    status: input.status ?? "pending",
    kind: input.kind ?? "",
    parentJobId: input.parentJobId ?? "",
    priority: input.priority ?? 50,
    touchedPaths: input.touchedPaths ?? [],
    blockedBy: input.blockedBy ?? [],
    assignee: input.assignee ?? "",
    worktreePath: "",
    branch: "",
    prUrl: "",
    prNumber: 0,
    error: "",
    pushState: "",
    pushAttempts: 0,
    pushError: "",
    pushedSha: "",
    pushedTo: "",
    sessionId: "",
    commitSha: "",
    delegatorPlan: input.delegatorPlan ?? "",
    needsApproval: input.needsApproval ?? false,
    model: input.model ?? "",
    effort: input.effort ?? "",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    mergedToMain: false,
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  };
  await db.execute({
    sql: `INSERT INTO jobs (id, project_id, title, prompt, images, status, kind, parent_job_id, priority, touched_paths, blocked_by, assignee, delegator_plan, model, effort, needs_approval, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      job.id, job.projectId, job.title, job.prompt, JSON.stringify(job.images), job.status,
      job.kind, job.parentJobId, job.priority, JSON.stringify(job.touchedPaths),
      JSON.stringify(job.blockedBy), job.assignee, job.delegatorPlan, job.model, job.effort,
      job.needsApproval ? 1 : 0, job.createdAt,
    ],
  });
  return job;
}

const JOB_COLUMNS: Record<string, string> = {
  title: "title", prompt: "prompt", status: "status", branch: "branch", prUrl: "pr_url",
  prNumber: "pr_number", error: "error", worktreePath: "worktree_path", sessionId: "session_id", commitSha: "commit_sha",
  pushState: "push_state", pushAttempts: "push_attempts", pushError: "push_error",
  pushedSha: "pushed_sha", pushedTo: "pushed_to",
  delegatorPlan: "delegator_plan", priority: "priority", parentJobId: "parent_job_id",
  startedAt: "started_at", completedAt: "completed_at", inputTokens: "input_tokens",
  outputTokens: "output_tokens", costUsd: "cost_usd", assignee: "assignee",
  mergedToMain: "merged_to_main",
};
const JOB_JSON_COLUMNS: Record<string, string> = {
  images: "images", touchedPaths: "touched_paths", blockedBy: "blocked_by",
};

function buildJobSets(fields: Partial<Job>): { sets: string[]; args: (string | number)[] } {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (JOB_JSON_COLUMNS[k]) {
      sets.push(`${JOB_JSON_COLUMNS[k]} = ?`);
      args.push(JSON.stringify(v));
      continue;
    }
    const col = JOB_COLUMNS[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    args.push(typeof v === "boolean" ? (v ? 1 : 0) : v as string | number);
  }
  return { sets, args };
}

export async function patchJob(
  id: string,
  fields: Partial<Job>,
): Promise<void> {
  const { sets, args } = buildJobSets(fields);
  if (!sets.length) return;
  args.push(id);
  await db.execute({ sql: `UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, args });
}

/** Conditionally patch a job: the UPDATE applies only while its status still
 *  matches `whereStatus`, and the rowsAffected check reports whether this call
 *  won the transition. This is the DB-level idempotency guard that keeps a
 *  restart (or a second engine sharing a Turso DB) from double-dispatching. */
export async function patchJobIf(
  id: string,
  fields: Partial<Job>,
  opts: { whereStatus: JobStatus },
): Promise<boolean> {
  const { sets, args } = buildJobSets(fields);
  if (!sets.length) return false;
  args.push(id, opts.whereStatus);
  const res = await db.execute({
    sql: `UPDATE jobs SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
    args,
  });
  return res.rowsAffected === 1;
}

export async function removeJob(id: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM jobs WHERE id = ?", args: [id] });
}

export async function updateUsage(id: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  await patchJob(id, {
    inputTokens: job.inputTokens + inputTokens,
    outputTokens: job.outputTokens + outputTokens,
    costUsd: job.costUsd + costUsd,
  });
}

export interface TodayStats { inputTokens: number; outputTokens: number; costUsd: number; jobCount: number }

export async function getTodayStats(): Promise<TodayStats> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const res = await db.execute({
    sql: `SELECT COALESCE(SUM(input_tokens),0) AS inp, COALESCE(SUM(output_tokens),0) AS out,
                 COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS cnt
          FROM jobs WHERE created_at >= ?`,
    args: [dayStart.getTime()],
  });
  const r = res.rows[0];
  return {
    inputTokens: Number(r?.inp ?? 0),
    outputTokens: Number(r?.out ?? 0),
    costUsd: Number(r?.cost ?? 0),
    jobCount: Number(r?.cnt ?? 0),
  };
}

// Re-run a finished job: clone it into a fresh pending job, optionally adding
// extra prompt text and/or images. Leaves the original intact.
export async function redoJob(sourceJobId: string, extraPrompt?: string, extraImages?: string[]): Promise<Job> {
  const src = await getJob(sourceJobId);
  if (!src) throw new Error("source job not found");
  const extra = extraPrompt?.trim();
  const prompt = extra ? `${src.prompt}\n\n${extra}` : src.prompt;
  const images = [...src.images, ...(extraImages ?? [])];
  const title = src.title.startsWith("Redo: ") ? src.title : `Redo: ${src.title}`;
  return createJob({
    projectId: src.projectId, title, prompt, images, status: "queued",
    priority: src.priority, model: src.model, effort: src.effort,
  });
}

export async function appendPrompt(id: string, text: string, images?: string[]): Promise<void> {
  const job = await getJob(id);
  if (!job) throw new Error("job not found");
  if (job.status !== "pending" && job.status !== "queued") {
    throw new Error("can only add to the prompt before a job starts running");
  }
  const trimmed = text.trim();
  const prompt = trimmed ? `${job.prompt}\n\n${trimmed}` : job.prompt;
  const newImages = images?.length ? [...job.images, ...images] : job.images;
  await patchJob(id, { prompt, images: newImages });
}

// Reset a job back to queued, clearing per-run state (used by retry/requeue).
export async function requeueJob(id: string): Promise<void> {
  await patchJob(id, {
    status: "queued", error: "", prUrl: "", prNumber: 0, mergedToMain: false, startedAt: 0, completedAt: 0,
    pushState: "", pushAttempts: 0, pushError: "", pushedSha: "", pushedTo: "",
  });
}

// Materialize a planned DAG as child jobs. Two passes: insert each child (to get
// its id), then wire blockedBy from the planner's local ids.
export interface SubtaskInput {
  localId: string; title: string; prompt: string; touchedPaths: string[]; dependsOn: string[];
}

export async function createChildren(epicId: string, subtasks: SubtaskInput[]): Promise<string[]> {
  const epic = await getJob(epicId);
  if (!epic) throw new Error("epic not found");
  const idByLocal = new Map<string, string>();
  const inserted: string[] = [];
  for (let i = 0; i < subtasks.length; i++) {
    const t = subtasks[i];
    const child = await createJob({
      projectId: epic.projectId, title: t.title, prompt: t.prompt,
      kind: "task", parentJobId: epicId, priority: i, touchedPaths: t.touchedPaths,
    });
    idByLocal.set(t.localId, child.id);
    inserted.push(child.id);
  }
  for (const t of subtasks) {
    const id = idByLocal.get(t.localId)!;
    const blockedBy = t.dependsOn.map((d) => idByLocal.get(d)).filter((x): x is string => Boolean(x));
    if (blockedBy.length) await patchJob(id, { blockedBy });
  }
  return inserted;
}

// ── Manual plans (hand-authored task trees) ─────────────────────────────────

// Marks an epic whose subtree was authored by the user rather than the AI
// delegator. The non-empty delegatorPlan also makes the runner skip AI planning.
export const MANUAL_PLAN_MARKER = JSON.stringify({ manual: true });

export function isManualEpic(job: Job): boolean {
  if (job.kind !== "epic" || !job.delegatorPlan) return false;
  try { return JSON.parse(job.delegatorPlan)?.manual === true; } catch { return false; }
}

// Every descendant of a job at any depth (breadth-first over parent links).
// `seen` guards against a corrupt parent cycle (e.g. a bad re-parent) so the
// walk can never loop forever.
export async function descendantsOf(rootId: string): Promise<Job[]> {
  const out: Job[] = [];
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length) {
    const kids = await childrenOf(queue.shift()!);
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      queue.push(k.id);
    }
  }
  return out;
}

// Walk up parent links to the owning top-level epic. Used to point a nested
// task's git integration at the root epic branch (nesting is organizational;
// every agent task still merges into the one epic branch).
export async function rootEpicOf(job: Job): Promise<Job | null> {
  let current: Job | null = job;
  const seen = new Set<string>();
  while (current && current.parentJobId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = await getJob(current.parentJobId);
    if (!parent) break;
    current = parent;
  }
  return current && current.kind === "epic" ? current : null;
}

// Materialize a hand-authored plan tree under an epic. Nodes may nest via
// parentLocalId and carry an assignee; dependsOn references sibling localIds.
// Callers must send nodes pre-ordered (each parent before its children).
export interface PlanNodeInput {
  localId: string; parentLocalId?: string; title: string; prompt?: string;
  assignee?: JobAssignee; touchedPaths?: string[]; dependsOn?: string[]; priority?: number;
  // An explicit existing parent id — used by the live list to append a single
  // task under any existing task. Falls back to parentLocalId, then the epic.
  parentJobId?: string;
  // A client-provided job id, so an optimistic UI row keeps the same id after
  // the server confirms (no temp→real swap / remount).
  id?: string;
}

export async function createSubtree(epicId: string, nodes: PlanNodeInput[]): Promise<string[]> {
  const epic = await getJob(epicId);
  if (!epic) throw new Error("epic not found");
  const idByLocal = new Map<string, string>();
  const inserted: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const parentJobId = n.parentLocalId
      ? (idByLocal.get(n.parentLocalId) ?? epicId)
      : (n.parentJobId ?? epicId);
    const child = await createJob({
      id: n.id, projectId: epic.projectId, title: n.title, prompt: n.prompt?.trim() || n.title,
      kind: "task", parentJobId, priority: typeof n.priority === "number" ? n.priority : i,
      assignee: n.assignee ?? "agent", touchedPaths: n.touchedPaths ?? [],
    });
    idByLocal.set(n.localId, child.id);
    inserted.push(child.id);
  }
  for (const n of nodes) {
    const id = idByLocal.get(n.localId)!;
    const blockedBy = (n.dependsOn ?? []).map((d) => idByLocal.get(d)).filter((x): x is string => Boolean(x));
    if (blockedBy.length) await patchJob(id, { blockedBy });
  }
  return inserted;
}

/** Stage a planned epic. `status` is "plan_review" when the epic opted into the
 *  approval gate (guided create), or "delegating" to build immediately. */
export async function setDelegatorPlan(
  id: string, delegatorPlan: string, branch: string,
  status: Extract<JobStatus, "plan_review" | "delegating"> = "delegating",
): Promise<void> {
  await patchJob(id, { delegatorPlan, branch, status });
}

/** Approve a plan_review epic so the scheduler starts building its subtasks. */
export async function approveDelegationPlan(id: string): Promise<void> {
  await patchJob(id, { status: "delegating" });
}

export interface EpicState { epic: Job; children: Job[] }

export async function listDelegationState(): Promise<EpicState[]> {
  const epics = await listJobsByStatus("delegating");
  const out: EpicState[] = [];
  for (const epic of epics) {
    // Full subtree: AI epics are flat (descendants == direct children) while
    // manual plans may nest arbitrarily deep.
    out.push({ epic, children: await descendantsOf(epic.id) });
  }
  return out;
}

export async function cancelEpic(id: string): Promise<void> {
  const now = Date.now();
  for (const c of await descendantsOf(id)) {
    if (c.status !== "completed" && c.status !== "cancelled" && c.status !== "failed") {
      await patchJob(c.id, { status: "cancelled", completedAt: now });
    }
  }
  await patchJob(id, { status: "cancelled", completedAt: now });
}
