import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  listJobs, getJob, createJob, patchJob, childrenOf, descendantsOf, createSubtree, MANUAL_PLAN_MARKER, isManualEpic,
  listProjects, getProject, createProject,
  updateProject, removeProject, removeJob, redoJob, appendPrompt, requeueJob, cancelEpic,
  getTodayStats, getSetting, setSetting, approveDelegationPlan,
  type Job,
} from "./db";
import type { z } from "zod";
import { parse } from "./schema";
import {
  AppendBodySchema, ClaudeMdBodySchema, CloneBodySchema, CreateChildrenBodySchema,
  CreateJobBodySchema, CreateProjectBodySchema, CreateRepoBodySchema, EnvWriteBodySchema,
  GithubConnectBodySchema, PatchJobBodySchema, RedoBodySchema, ReplyBodySchema,
  SetStatusBodySchema, UpdateProjectBodySchema,
} from "./api-schemas";
import { attachWebsocket, broadcast } from "./events";
import { updateStatus } from "./status";
import { enqueue, cancelJob, deliverReply } from "./runner";
import { readOutput, clearOutput } from "./output-log";
import { scheduleDelegationCheck, finalizeEpic } from "./delegator-scheduler";
import { getClaudeUsage } from "./usage";
import { checkAuth, authEnabled } from "./auth";
import { getUser, fetchUserRepos, createRepo } from "./agent/github";
import { oauthConfigured, OAUTH_CALLBACK, APP_URL } from "./config";
import { newState, consumeState, authorizeUrl, exchangeCode } from "./oauth";

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Where the built UI lives. Defaults to the monorepo layout (engine/{src,dist} →
// ../../ui/dist) but is overridable so packaged builds (CLI / desktop app) can
// point at a bundled copy.
const UI_DIST = process.env.FACTORY_UI_DIST ?? path.resolve(__dirname, "../../ui/dist");

// Wide-open CORS is acceptable only while the engine is unauthenticated *and*
// loopback-bound (index.ts enforces that pairing at startup). Once auth is on
// the engine may be network-exposed, so browsers are limited to the configured
// app origin plus the local dev hosts.
const DEV_ORIGINS = [
  "http://localhost:5173", "http://127.0.0.1:5173",
  "http://localhost:3000", "http://127.0.0.1:3000",
];
function corsHeadersFor(req: http.IncomingMessage): Record<string, string> {
  const base = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (!authEnabled) return { ...base, "Access-Control-Allow-Origin": "*" };
  const origin = String(req.headers.origin ?? "");
  return new Set([APP_URL, ...DEV_ORIGINS]).has(origin)
    ? { ...base, "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : base;
}

function sendJson(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Read and JSON-parse the request body. Returns null for malformed JSON so
 *  routes answer 400 instead of treating it as an empty body. */
function readBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 12_000_000) req.destroy(); });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null);
      } catch { resolve(null); }
    });
  });
}

/** Parse a request body against its schema. On failure this sends the 400
 *  itself and returns null, so handlers can simply `if (!b) return;`. */
async function parseBody<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await readBody(req);
  if (raw === null) { sendJson(res, 400, { error: "invalid JSON body" }); return null; }
  const r = parse(schema, raw);
  if (!r.ok) { sendJson(res, 400, { error: r.error }); return null; }
  return r.value;
}

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff",
};

function serveStatic(pathname: string, res: http.ServerResponse): void {
  if (!fs.existsSync(UI_DIST)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Factory engine is running.</h2><p>UI not built — run <code>npm run dev</code> and open http://localhost:5173, or <code>npm run build:ui</code>.</p>`);
    return;
  }
  const rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(UI_DIST, rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(UI_DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function workspaceFor(repo: string): string {
  const workspace = process.env.FACTORY_WORKSPACE ?? path.join(os.homedir(), "factory-workspace");
  return path.join(workspace, repo.split("/")[1]);
}

export function startServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(corsHeadersFor(req))) res.setHeader(k, v);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const { pathname } = url;
    const method = req.method ?? "GET";

    try {
      // ── Open endpoints ──
      if (method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true });
      if (method === "GET" && pathname === "/api/config") return sendJson(res, 200, { authEnabled, oauthConfigured });

      // GitHub OAuth (browser navigations + callback — can't carry the bearer token)
      if (method === "GET" && pathname === "/api/github/login") {
        if (!oauthConfigured) return sendJson(res, 400, { error: "OAuth not configured — set GITHUB_CLIENT_ID/SECRET in engine/.env" });
        return redirect(res, authorizeUrl(OAUTH_CALLBACK, newState()));
      }
      if (method === "GET" && pathname === "/api/github/callback") {
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        if (!code || !consumeState(state)) return redirect(res, `${APP_URL}?gh=error`);
        try {
          const token = await exchangeCode(code, OAUTH_CALLBACK);
          const { login } = await getUser(token);
          await setSetting("githubToken", token);
          await setSetting("githubLogin", login);
          return redirect(res, `${APP_URL}?gh=ok`);
        } catch {
          return redirect(res, `${APP_URL}?gh=error`);
        }
      }

      // ── Auth gate (UI static + health/config stay open) ──
      if (pathname.startsWith("/api/") && !checkAuth(req)) {
        return sendJson(res, 401, { error: "unauthorized" });
      }

      // ── GitHub ──
      if (method === "GET" && pathname === "/api/github/status") {
        const login = await getSetting("githubLogin");
        return sendJson(res, 200, { connected: Boolean(login), login: login ?? "", oauthConfigured });
      }
      if (method === "POST" && pathname === "/api/github/connect") {
        const b = await parseBody(req, res, GithubConnectBodySchema);
        if (!b) return;
        try {
          const { login } = await getUser(b.token);
          await setSetting("githubToken", b.token);
          await setSetting("githubLogin", login);
          return sendJson(res, 200, { login });
        } catch {
          return sendJson(res, 400, { error: "invalid GitHub token" });
        }
      }
      if (method === "GET" && pathname === "/api/github/repos") {
        const token = await getSetting("githubToken");
        if (!token) return sendJson(res, 400, { error: "connect GitHub first" });
        return sendJson(res, 200, { repos: await fetchUserRepos(token) });
      }

      // ── Usage ──
      if (method === "GET" && pathname === "/api/usage") {
        const { status, body } = await getClaudeUsage();
        return sendJson(res, status, body);
      }

      // ── Today stats ──
      if (method === "GET" && pathname === "/api/today-stats") {
        return sendJson(res, 200, await getTodayStats());
      }

      // ── Projects ──
      if (method === "GET" && pathname === "/api/projects") return sendJson(res, 200, await listProjects());
      if (method === "POST" && pathname === "/api/projects") {
        const b = await parseBody(req, res, CreateProjectBodySchema);
        if (!b) return;
        if (b.localPath && !fs.existsSync(b.localPath)) return sendJson(res, 400, { error: `path not found: ${b.localPath}` });
        const githubToken = b.githubToken || (b.repo ? (await getSetting("githubToken")) ?? "" : "");
        const project = await createProject({
          name: b.name, localPath: b.localPath, repo: b.repo,
          defaultBranch: b.defaultBranch,
          githubToken,
          agentRules: b.agentRules,
          color: b.color,
        });
        broadcast({ type: "project.created", project });
        return sendJson(res, 201, project);
      }

      const projEnvMatch = pathname === "/api/projects/env";
      if (method === "GET" && projEnvMatch) {
        const localPath = url.searchParams.get("localPath");
        if (!localPath) return sendJson(res, 400, { error: "localPath required" });
        if (!fs.existsSync(localPath)) return sendJson(res, 200, { content: "", exists: false, pathMissing: true, file: ".env" });
        const envPath = path.join(localPath, ".env");
        const exists = fs.existsSync(envPath);
        return sendJson(res, 200, { content: exists ? fs.readFileSync(envPath, "utf8") : "", exists, file: ".env" });
      }
      if (method === "POST" && projEnvMatch) {
        const b = await parseBody(req, res, EnvWriteBodySchema);
        if (!b) return;
        if (!fs.existsSync(b.localPath)) return sendJson(res, 404, { error: "path not found" });
        const normalized = b.content === "" || b.content.endsWith("\n") ? b.content : b.content + "\n";
        fs.writeFileSync(path.join(b.localPath, ".env"), normalized, "utf8");
        return sendJson(res, 200, { ok: true, file: ".env" });
      }

      if (method === "POST" && pathname === "/api/projects/clone") {
        const b = await parseBody(req, res, CloneBodySchema);
        if (!b) return;
        const repo = b.repo;
        const localPath = b.targetPath || workspaceFor(repo);
        if (fs.existsSync(localPath)) return sendJson(res, 200, { localPath, alreadyExists: true });
        const token = await getSetting("githubToken");
        const cloneUrl = token ? `https://${token}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
        try {
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          execSync(`git clone "${cloneUrl}" "${localPath}"`, { timeout: 120_000, stdio: "pipe" });
          return sendJson(res, 200, { localPath });
        } catch (err) {
          const msg = String((err as Error).message ?? err).split(token ?? "\0").join("***");
          return sendJson(res, 500, { error: msg });
        }
      }

      if (method === "POST" && pathname === "/api/projects/create-repo") {
        const b = await parseBody(req, res, CreateRepoBodySchema);
        if (!b) return;
        const token = (await getSetting("githubToken")) || process.env.GITHUB_TOKEN;
        if (!token) return sendJson(res, 401, { error: "Connect GitHub to create a repo" });
        let repoInfo;
        try {
          repoInfo = await createRepo(token, b.name, b.description, b.private);
        } catch (err) {
          const msg = (err as Error).message ?? "Failed to create repo";
          return sendJson(res, /already exists/i.test(msg) ? 409 : 500, { error: msg });
        }
        const localPath = workspaceFor(repoInfo.fullName);
        if (!fs.existsSync(localPath)) {
          try {
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            execSync(`git clone "https://${token}@github.com/${repoInfo.fullName}.git" "${localPath}"`, { timeout: 120_000, stdio: "pipe" });
          } catch (err) {
            return sendJson(res, 500, { error: String((err as Error).message ?? err) });
          }
        }
        return sendJson(res, 200, { repo: repoInfo.fullName, defaultBranch: repoInfo.defaultBranch, htmlUrl: repoInfo.htmlUrl, localPath });
      }

      if (method === "POST" && pathname === "/api/projects/claudemd") {
        const b = await parseBody(req, res, ClaudeMdBodySchema);
        if (!b) return;
        if (!fs.existsSync(b.localPath)) return sendJson(res, 404, { error: "path not found" });
        const claudeMdPath = path.join(b.localPath, "CLAUDE.md");
        if (fs.existsSync(claudeMdPath)) return sendJson(res, 200, { ok: true, skipped: true });
        const lines: string[] = [`# ${b.projectName}`, ""];
        if (b.codemapHint.trim()) lines.push("## Project Structure", b.codemapHint.trim(), "");
        lines.push(
          "## Agent Guidelines",
          "- Read this file before exploring the codebase",
          "- Focus only on files directly relevant to the task",
          "- Do not read entire directories — read one file to understand a pattern, then apply it",
          "- Ignore: node_modules/, dist/, .next/, build/, .git/, *.lock files",
          "",
        );
        if (b.agentRules.trim()) lines.push("## Project Rules", b.agentRules.trim(), "");
        fs.writeFileSync(claudeMdPath, lines.join("\n"), "utf8");
        return sendJson(res, 200, { ok: true });
      }

      // /api/projects/:id  (PATCH update, DELETE remove)
      const projIdMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projIdMatch) {
        const id = decodeURIComponent(projIdMatch[1]);
        if (method === "PATCH") {
          const b = await parseBody(req, res, UpdateProjectBodySchema);
          if (!b) return;
          await updateProject(id, b);
          const project = await getProject(id);
          if (project) broadcast({ type: "project.updated", project });
          return sendJson(res, 200, project ?? {});
        }
        if (method === "DELETE") {
          await removeProject(id);
          broadcast({ type: "project.removed", id });
          return sendJson(res, 200, { ok: true });
        }
      }

      // ── Jobs ──
      if (method === "GET" && pathname === "/api/jobs") {
        const projectId = url.searchParams.get("projectId") || undefined;
        return sendJson(res, 200, await listJobs(projectId));
      }
      if (method === "POST" && pathname === "/api/jobs") {
        const b = await parseBody(req, res, CreateJobBodySchema);
        if (!b) return;
        const title = (b.title || b.prompt).slice(0, 80);
        // Manual plan: a hand-authored epic. It skips the AI planner and the
        // queue entirely — it sits in "delegating" while the user adds tasks and
        // runs/ticks them one by one.
        const manual = b.kind === "epic" && b.manual;
        // Epics must always be queued so the worker plans & splits them.
        const wantsRun = !manual && (b.autoRun || b.status === "queued" || b.kind === "epic");
        const job = await createJob({
          id: b.id || undefined, // client-provided id for optimistic UI
          projectId: b.projectId, title, prompt: b.prompt,
          images: b.images,
          status: manual ? "delegating" : (wantsRun ? "queued" : "pending"),
          kind: b.kind,
          assignee: b.assignee,
          delegatorPlan: manual ? MANUAL_PLAN_MARKER : undefined,
          model: b.model,
          effort: b.effort,
          needsApproval: b.needsApproval, // guided create → clarify + plan gate
        });
        broadcast({ type: "job.created", job });
        if (wantsRun) enqueue(job.id);
        return sendJson(res, 201, job);
      }

      const jobIdMatch = pathname.match(/^\/api\/jobs\/([^/]+)(\/[a-z-]+)?$/);
      if (jobIdMatch) {
        const id = decodeURIComponent(jobIdMatch[1]);
        const action = jobIdMatch[2]?.slice(1);

        if (method === "GET" && !action) {
          const job = await getJob(id);
          return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: "not found" });
        }
        if (method === "GET" && action === "children") {
          return sendJson(res, 200, await childrenOf(id));
        }
        if (method === "POST" && action === "children") {
          // Materialize a hand-authored plan tree under a manual epic.
          const b = await parseBody(req, res, CreateChildrenBodySchema);
          if (!b) return;
          const ids = await createSubtree(id, b.nodes);
          const created = [];
          for (const cid of ids) {
            const j = await getJob(cid);
            if (j) { created.push(j); broadcast({ type: "job.created", job: j }); }
          }
          const epic = await getJob(id);
          if (epic) broadcast({ type: "job.updated", job: epic });
          scheduleDelegationCheck();
          return sendJson(res, 201, created);
        }
        if (method === "GET" && action === "output") {
          // Persisted agent log — fetched on open so finished jobs and reloads
          // show full history; the live tail continues over the WebSocket.
          return sendJson(res, 200, { output: readOutput(id) });
        }
        if (method === "PATCH" && !action) {
          // In-place edits to a plan task: rename, re-prompt, reassign, or
          // restructure (re-parent / reorder for the live ClickUp-style list).
          const b = await parseBody(req, res, PatchJobBodySchema);
          if (!b) return;
          const fields: Partial<Job> = {};
          if (typeof b.title === "string") fields.title = b.title.trim().slice(0, 80);
          if (typeof b.prompt === "string") fields.prompt = b.prompt;
          if (typeof b.assignee === "string") fields.assignee = b.assignee;
          if (typeof b.priority === "number") fields.priority = b.priority;
          if (typeof b.parentJobId === "string") {
            // Re-parent (indent / outdent). Guard against self-parenting,
            // cycles, and moving a task that's mid-flight.
            const target = await getJob(id);
            if (!target) return sendJson(res, 404, { error: "not found" });
            if (b.parentJobId === id) return sendJson(res, 400, { error: "cannot parent a task to itself" });
            if (target.status === "running" || target.status === "queued") {
              return sendJson(res, 409, { error: "cannot move a task while it is running" });
            }
            // Walk up from the proposed parent; if we reach this task, the move
            // would make it a descendant of its own subtree (a cycle).
            let cursor: Job | null = await getJob(b.parentJobId);
            const seen = new Set<string>();
            while (cursor && !seen.has(cursor.id)) {
              if (cursor.id === id) return sendJson(res, 409, { error: "would create a cycle" });
              seen.add(cursor.id);
              cursor = cursor.parentJobId ? await getJob(cursor.parentJobId) : null;
            }
            fields.parentJobId = b.parentJobId;
          }
          await patchJob(id, fields);
          const job = await getJob(id);
          if (job) broadcast({ type: "job.updated", job });
          scheduleDelegationCheck();
          return sendJson(res, 200, job);
        }
        if (method === "DELETE" && !action) {
          // ?cascade=1 removes the whole subtree (leaf-first) so deleting a
          // parent task can't orphan its children — there's no DB cascade.
          if (url.searchParams.get("cascade") === "1") {
            const subtree = await descendantsOf(id);
            for (const d of [...subtree].reverse()) {
              await removeJob(d.id);
              clearOutput(d.id);
              broadcast({ type: "job.removed", id: d.id });
            }
          }
          await removeJob(id);
          clearOutput(id);
          broadcast({ type: "job.removed", id });
          return sendJson(res, 200, { ok: true });
        }
        if (method === "POST" && action === "status") {
          const b = await parseBody(req, res, SetStatusBodySchema);
          if (!b) return;
          const { status, ...extra } = b;
          await updateStatus(id, status, extra as Partial<Job>);
          if (status === "queued") enqueue(id);
          // Ticking a manual task to completed (or reopening it) may unblock the
          // owning epic's finalize check.
          scheduleDelegationCheck();
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "queue") {
          await updateStatus(id, "queued");
          enqueue(id);
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "finish") {
          // Explicit finalize for a hand-authored (manual) plan. Completed agent
          // work is pushed (PR / merge); a pure human checklist just marks done.
          const epic = await getJob(id);
          if (!epic) return sendJson(res, 404, { error: "not found" });
          if (!isManualEpic(epic)) return sendJson(res, 400, { error: "not a manual plan" });
          await finalizeEpic(epic);
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "approve-plan") {
          // Guided-create approval gate: build the plan the user just reviewed.
          const job = await getJob(id);
          if (!job) return sendJson(res, 404, { error: "not found" });
          if (job.status !== "plan_review") return sendJson(res, 409, { error: "job is not awaiting plan approval" });
          await approveDelegationPlan(id);
          scheduleDelegationCheck();
          const updated = await getJob(id);
          if (updated) broadcast({ type: "job.updated", job: updated });
          return sendJson(res, 200, updated);
        }
        if (method === "POST" && action === "requeue") {
          await requeueJob(id);
          enqueue(id);
          scheduleDelegationCheck();
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "redo") {
          const b = await parseBody(req, res, RedoBodySchema);
          if (!b) return;
          const job = await redoJob(id, b.extraPrompt, b.extraImages);
          broadcast({ type: "job.created", job });
          enqueue(job.id);
          return sendJson(res, 201, job);
        }
        if (method === "POST" && action === "append") {
          const b = await parseBody(req, res, AppendBodySchema);
          if (!b) return;
          await appendPrompt(id, b.text, b.images);
          const job = await getJob(id);
          if (job) broadcast({ type: "job.updated", job });
          return sendJson(res, 200, job);
        }
        if (method === "POST" && action === "cancel") {
          cancelJob(id);
          await updateStatus(id, "cancelled");
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "cancel-epic") {
          const children = await descendantsOf(id);
          for (const c of children) cancelJob(c.id);
          cancelJob(id);
          await cancelEpic(id);
          for (const c of children) { const j = await getJob(c.id); if (j) broadcast({ type: "job.updated", job: j }); }
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "reply") {
          const b = await parseBody(req, res, ReplyBodySchema);
          if (!b) return;
          const accepted = await deliverReply(id, b.text.trim(), b.images);
          return accepted ? sendJson(res, 202, { ok: true }) : sendJson(res, 409, { error: "no live session for this job" });
        }
      }

      // Terminal is now a PTY over the /term WebSocket (see events.ts + terminal.ts).

      if (method === "GET") return serveStatic(pathname, res);
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  attachWebsocket(server);
  const host = process.env.FACTORY_HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`⚙️  Factory engine → http://${host}:${port}`));
  return server;
}
