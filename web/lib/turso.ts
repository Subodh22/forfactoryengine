import { createClient, type Client, type Row } from "@libsql/client";

// Server-side only. Reads/writes the SAME Turso DB the engine syncs with. The
// token never reaches the browser (used in API routes). The engine owns the
// schema; we CREATE IF NOT EXISTS so the UI still works before the first sync.
function turso(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL not set");
  return createClient({ url, authToken });
}

async function ensure(db: Client): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, local_path TEXT NOT NULL DEFAULT '',
    repo TEXT NOT NULL DEFAULT '', default_branch TEXT NOT NULL DEFAULT 'main',
    github_token TEXT NOT NULL DEFAULT '', agent_rules TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    branch TEXT NOT NULL DEFAULT '', pr_url TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
}

export async function getSetting(key: string): Promise<string | null> {
  const db = turso(); await ensure(db);
  const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return r.rows[0] ? String(r.rows[0].value) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = turso(); await ensure(db);
  await db.execute({
    sql: "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    args: [key, value],
  });
}

export interface Project { id: string; name: string; repo: string; defaultBranch: string; }
export interface Job { id: string; projectId: string; title: string; status: string; prUrl: string; createdAt: number; }

export async function listProjects(): Promise<Project[]> {
  const db = turso(); await ensure(db);
  const r = await db.execute("SELECT * FROM projects ORDER BY created_at DESC");
  return r.rows.map((x: Row) => ({ id: String(x.id), name: String(x.name), repo: String(x.repo), defaultBranch: String(x.default_branch) }));
}

export async function createProject(input: { name: string; repo: string; defaultBranch: string }): Promise<Project> {
  const db = turso(); await ensure(db);
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO projects (id,name,local_path,repo,default_branch,github_token,agent_rules,created_at) VALUES (?,?,?,?,?,?,?,?)",
    args: [id, input.name, "", input.repo, input.defaultBranch, "", "", Date.now()],
  });
  return { id, ...input };
}

export async function listJobs(): Promise<Job[]> {
  const db = turso(); await ensure(db);
  const r = await db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100");
  return r.rows.map((x: Row) => ({
    id: String(x.id), projectId: String(x.project_id), title: String(x.title),
    status: String(x.status), prUrl: String(x.pr_url), createdAt: Number(x.created_at),
  }));
}

export async function createJob(input: { projectId: string; prompt: string }): Promise<{ id: string }> {
  const db = turso(); await ensure(db);
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO jobs (id,project_id,title,prompt,status,branch,pr_url,error,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [id, input.projectId, input.prompt.slice(0, 80), input.prompt, "pending", "", "", "", Date.now()],
  });
  return { id };
}
