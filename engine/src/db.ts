import { createClient, type Client, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// Embedded local libSQL database — a single file on disk. This is the source of
// truth: all reads/writes are local and unmetered. Later this same client gets a
// `syncUrl` to a Turso cloud copy (embedded replica) so a phone UI can read it.
const dataDir = process.env.FACTORY_DATA_DIR ?? process.cwd();
fs.mkdirSync(dataDir, { recursive: true }); // ensure the data dir exists
const dbPath = path.join(dataDir, "factory.db");

// Local file by default. If a Turso cloud DB is configured, this becomes an
// EMBEDDED REPLICA: reads/writes still hit the local file (instant, unmetered),
// and changes sync to the Turso copy that a phone/hosted UI reads from anywhere.
const syncUrl = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

export const db: Client = createClient(
  syncUrl ? { url: `file:${dbPath}`, syncUrl, authToken } : { url: `file:${dbPath}` },
);

export const cloudSyncEnabled = Boolean(syncUrl);

/** Pull/push the embedded replica against the Turso copy. No-op when local-only. */
export async function syncNow(): Promise<void> {
  if (!syncUrl) return;
  try { await db.sync(); } catch (err) { console.error("[sync]", String(err)); }
}

export interface Project {
  id: string;
  name: string;
  localPath: string;
  repo: string;
  defaultBranch: string;
  githubToken: string;
  agentRules: string;
  createdAt: number;
}

export interface Job {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: "pending" | "running" | "done" | "failed";
  branch: string;
  prUrl: string;
  error: string;
  createdAt: number;
}

export async function initSchema(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      local_path    TEXT NOT NULL,
      repo          TEXT NOT NULL DEFAULT '',
      default_branch TEXT NOT NULL DEFAULT 'main',
      github_token  TEXT NOT NULL DEFAULT '',
      agent_rules   TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      title      TEXT NOT NULL,
      prompt     TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'pending',
      branch     TEXT NOT NULL DEFAULT '',
      pr_url     TEXT NOT NULL DEFAULT '',
      error      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS jobs_by_created ON jobs (created_at DESC)`);
  // Upgrade older DBs that predate pr_url (ignore if the column already exists).
  try { await db.execute("ALTER TABLE jobs ADD COLUMN pr_url TEXT NOT NULL DEFAULT ''"); } catch { /* exists */ }

  // Simple key/value settings — e.g. the connected GitHub token + login.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
}

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

// ── projects ────────────────────────────────────────────────────────────────

function rowToProject(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    localPath: String(r.local_path),
    repo: String(r.repo),
    defaultBranch: String(r.default_branch),
    githubToken: String(r.github_token),
    agentRules: String(r.agent_rules),
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
  name: string; localPath: string; repo?: string; defaultBranch?: string; githubToken?: string; agentRules?: string;
}): Promise<Project> {
  const p: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    localPath: input.localPath,
    repo: input.repo ?? "",
    defaultBranch: input.defaultBranch ?? "main",
    githubToken: input.githubToken ?? "",
    agentRules: input.agentRules ?? "",
    createdAt: Date.now(),
  };
  await db.execute({
    sql: `INSERT INTO projects (id, name, local_path, repo, default_branch, github_token, agent_rules, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [p.id, p.name, p.localPath, p.repo, p.defaultBranch, p.githubToken, p.agentRules, p.createdAt],
  });
  return p;
}

// ── jobs ────────────────────────────────────────────────────────────────────

function rowToJob(r: Row): Job {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    title: String(r.title),
    prompt: String(r.prompt),
    status: String(r.status) as Job["status"],
    branch: String(r.branch),
    prUrl: String(r.pr_url),
    error: String(r.error),
    createdAt: Number(r.created_at),
  };
}

export async function listJobs(limit = 200): Promise<Job[]> {
  const res = await db.execute({ sql: "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", args: [limit] });
  return res.rows.map(rowToJob);
}

export async function listJobsByStatus(status: Job["status"]): Promise<Job[]> {
  const res = await db.execute({ sql: "SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC", args: [status] });
  return res.rows.map(rowToJob);
}

export async function getJob(id: string): Promise<Job | null> {
  const res = await db.execute({ sql: "SELECT * FROM jobs WHERE id = ?", args: [id] });
  return res.rows[0] ? rowToJob(res.rows[0]) : null;
}

export async function createJob(input: { projectId: string; title: string; prompt: string }): Promise<Job> {
  const job: Job = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title,
    prompt: input.prompt,
    status: "pending",
    branch: "",
    prUrl: "",
    error: "",
    createdAt: Date.now(),
  };
  await db.execute({
    sql: `INSERT INTO jobs (id, project_id, title, prompt, status, branch, pr_url, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [job.id, job.projectId, job.title, job.prompt, job.status, job.branch, job.prUrl, job.error, job.createdAt],
  });
  return job;
}

// Map camelCase Job fields → snake_case columns for the patchable subset.
const JOB_COLUMNS = { status: "status", branch: "branch", prUrl: "pr_url", error: "error" } as const;

export async function patchJob(
  id: string,
  fields: Partial<Pick<Job, "status" | "branch" | "prUrl" | "error">>,
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = JOB_COLUMNS[k as keyof typeof JOB_COLUMNS];
    if (!col) continue;
    sets.push(`${col} = ?`);
    args.push(v as string);
  }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, args });
}
