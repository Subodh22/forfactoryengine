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

/** Sync on an interval so the phone copy stays fresh (and inbound phone writes
 *  land locally). Returns a stop function. */
export function startSync(intervalMs = 4000): () => void {
  if (!syncUrl) return () => {};
  const t = setInterval(() => void syncNow(), intervalMs);
  return () => clearInterval(t);
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
      error      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS jobs_by_created ON jobs (created_at DESC)`);
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
    error: String(r.error),
    createdAt: Number(r.created_at),
  };
}

export async function listJobs(limit = 200): Promise<Job[]> {
  const res = await db.execute({ sql: "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", args: [limit] });
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
    error: "",
    createdAt: Date.now(),
  };
  await db.execute({
    sql: `INSERT INTO jobs (id, project_id, title, prompt, status, branch, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [job.id, job.projectId, job.title, job.prompt, job.status, job.branch, job.error, job.createdAt],
  });
  return job;
}

export async function patchJob(
  id: string,
  fields: Partial<Pick<Job, "status" | "branch" | "error">>,
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k === "status" ? "status" : k; // 1:1 mapping for these fields
    sets.push(`${col} = ?`);
    args.push(v as string);
  }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, args });
}
