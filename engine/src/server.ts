import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  listJobs, getJob, createJob, childrenOf, listProjects, getProject, createProject,
  updateProject, removeProject, removeJob, redoJob, appendPrompt, requeueJob, cancelEpic,
  getTodayStats, getSetting, setSetting, type JobKind, type JobEffort, type JobStatus,
} from "./db";
import { attachWebsocket, broadcast } from "./events";
import { updateStatus } from "./status";
import { enqueue, cancelJob, deliverReply } from "./runner";
import { readOutput, clearOutput } from "./output-log";
import { scheduleDelegationCheck } from "./delegator-scheduler";
import { runTerminalCommand, killTerminal } from "./terminal";
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sendJson(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 12_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
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
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
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
        const token = String((await readBody(req)).token ?? "").trim();
        if (!token) return sendJson(res, 400, { error: "token required" });
        try {
          const { login } = await getUser(token);
          await setSetting("githubToken", token);
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
        const b = await readBody(req);
        const name = String(b.name ?? "").trim();
        let localPath = String(b.localPath ?? "").trim();
        const repo = String(b.repo ?? "").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        if (!localPath && !repo) return sendJson(res, 400, { error: "localPath or repo required" });
        if (localPath && !fs.existsSync(localPath)) return sendJson(res, 400, { error: `path not found: ${localPath}` });
        const githubToken = String(b.githubToken ?? "") || (repo ? (await getSetting("githubToken")) ?? "" : "");
        const project = await createProject({
          name, localPath, repo,
          defaultBranch: String(b.defaultBranch ?? "main"),
          githubToken,
          agentRules: String(b.agentRules ?? ""),
          color: String(b.color ?? ""),
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
        const b = await readBody(req);
        const localPath = String(b.localPath ?? "");
        const content = b.content;
        if (!localPath) return sendJson(res, 400, { error: "localPath required" });
        if (typeof content !== "string") return sendJson(res, 400, { error: "content required" });
        if (!fs.existsSync(localPath)) return sendJson(res, 404, { error: "path not found" });
        const normalized = content === "" || content.endsWith("\n") ? content : content + "\n";
        fs.writeFileSync(path.join(localPath, ".env"), normalized, "utf8");
        return sendJson(res, 200, { ok: true, file: ".env" });
      }

      if (method === "POST" && pathname === "/api/projects/clone") {
        const b = await readBody(req);
        const repo = String(b.repo ?? "");
        if (!repo) return sendJson(res, 400, { error: "repo required" });
        const localPath = String(b.targetPath ?? "") || workspaceFor(repo);
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
        const b = await readBody(req);
        const token = (await getSetting("githubToken")) || process.env.GITHUB_TOKEN;
        if (!token) return sendJson(res, 401, { error: "Connect GitHub to create a repo" });
        const name = String(b.name ?? "").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        let repoInfo;
        try {
          repoInfo = await createRepo(token, name, String(b.description ?? ""), b.private !== false);
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
        const b = await readBody(req);
        const localPath = String(b.localPath ?? "");
        if (!localPath) return sendJson(res, 400, { error: "localPath required" });
        if (!fs.existsSync(localPath)) return sendJson(res, 404, { error: "path not found" });
        const claudeMdPath = path.join(localPath, "CLAUDE.md");
        if (fs.existsSync(claudeMdPath)) return sendJson(res, 200, { ok: true, skipped: true });
        const lines: string[] = [`# ${String(b.projectName ?? "Project")}`, ""];
        if (String(b.codemapHint ?? "").trim()) lines.push("## Project Structure", String(b.codemapHint).trim(), "");
        lines.push(
          "## Agent Guidelines",
          "- Read this file before exploring the codebase",
          "- Focus only on files directly relevant to the task",
          "- Do not read entire directories — read one file to understand a pattern, then apply it",
          "- Ignore: node_modules/, dist/, .next/, build/, .git/, *.lock files",
          "",
        );
        if (String(b.agentRules ?? "").trim()) lines.push("## Project Rules", String(b.agentRules).trim(), "");
        fs.writeFileSync(claudeMdPath, lines.join("\n"), "utf8");
        return sendJson(res, 200, { ok: true });
      }

      // /api/projects/:id  (PATCH update, DELETE remove)
      const projIdMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projIdMatch) {
        const id = decodeURIComponent(projIdMatch[1]);
        if (method === "PATCH") {
          const b = await readBody(req);
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
        const b = await readBody(req);
        const projectId = String(b.projectId ?? "").trim();
        const prompt = String(b.prompt ?? "").trim();
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });
        if (!prompt) return sendJson(res, 400, { error: "prompt required" });
        const title = (String(b.title ?? "").trim() || prompt).slice(0, 80);
        const kind = (String(b.kind ?? "") || "") as JobKind;
        // Epics must always be queued so the worker plans & splits them.
        const wantsRun = b.autoRun === true || b.status === "queued" || kind === "epic";
        const job = await createJob({
          projectId, title, prompt,
          images: Array.isArray(b.images) ? (b.images as string[]) : [],
          status: wantsRun ? "queued" : "pending",
          kind,
          model: String(b.model ?? ""),
          effort: (String(b.effort ?? "") || "") as JobEffort,
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
        if (method === "GET" && action === "output") {
          // Persisted agent log — fetched on open so finished jobs and reloads
          // show full history; the live tail continues over the WebSocket.
          return sendJson(res, 200, { output: readOutput(id) });
        }
        if (method === "DELETE" && !action) {
          await removeJob(id);
          clearOutput(id);
          broadcast({ type: "job.removed", id });
          return sendJson(res, 200, { ok: true });
        }
        if (method === "POST" && action === "status") {
          const b = await readBody(req);
          const status = String(b.status ?? "") as JobStatus;
          await updateStatus(id, status, b);
          if (status === "queued") enqueue(id);
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "queue") {
          await updateStatus(id, "queued");
          enqueue(id);
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "requeue") {
          await requeueJob(id);
          enqueue(id);
          scheduleDelegationCheck();
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "redo") {
          const b = await readBody(req);
          const job = await redoJob(id, b.extraPrompt as string | undefined, b.extraImages as string[] | undefined);
          broadcast({ type: "job.created", job });
          enqueue(job.id);
          return sendJson(res, 201, job);
        }
        if (method === "POST" && action === "append") {
          const b = await readBody(req);
          await appendPrompt(id, String(b.text ?? ""), b.images as string[] | undefined);
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
          const children = await childrenOf(id);
          for (const c of children) cancelJob(c.id);
          cancelJob(id);
          await cancelEpic(id);
          for (const c of children) { const j = await getJob(c.id); if (j) broadcast({ type: "job.updated", job: j }); }
          return sendJson(res, 200, await getJob(id));
        }
        if (method === "POST" && action === "reply") {
          const b = await readBody(req);
          const text = String(b.text ?? "").trim();
          const images = Array.isArray(b.images) ? (b.images as string[]) : [];
          if (!text && !images.length) return sendJson(res, 400, { error: "text or images required" });
          const accepted = await deliverReply(id, text, images);
          return accepted ? sendJson(res, 202, { ok: true }) : sendJson(res, 409, { error: "no live session for this job" });
        }
      }

      // ── Terminal ──
      if (method === "POST" && pathname === "/api/terminal/exec") {
        const b = await readBody(req);
        const sessionId = String(b.sessionId ?? "");
        const cwd = String(b.cwd ?? "");
        const command = String(b.command ?? "");
        if (!sessionId || !cwd || !command) return sendJson(res, 400, { error: "sessionId, cwd and command are required" });
        runTerminalCommand(sessionId, cwd, command);
        return sendJson(res, 202, { ok: true });
      }
      if (method === "POST" && pathname === "/api/terminal/kill") {
        const b = await readBody(req);
        const killed = killTerminal(String(b.sessionId ?? ""));
        return sendJson(res, 200, { ok: true, killed });
      }

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
