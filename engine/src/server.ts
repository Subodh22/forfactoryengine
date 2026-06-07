import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listJobs, createJob, listProjects, createProject, getSetting, setSetting } from "./db";
import { attachWebsocket, broadcast } from "./events";
import { enqueue } from "./runner";
import { checkAuth, authEnabled } from "./auth";
import { getUser, fetchUserRepos } from "./agent/github";
import { oauthConfigured, OAUTH_CALLBACK, APP_URL } from "./config";
import { newState, consumeState, authorizeUrl, exchangeCode } from "./oauth";

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = path.resolve(__dirname, "../../ui/dist");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function serveStatic(pathname: string, res: http.ServerResponse): void {
  if (!fs.existsSync(UI_DIST)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Factory engine is running.</h2><p>UI not built — run <code>npm run dev</code> and open http://localhost:5173, or <code>npm run build:ui</code>.</p>`);
    return;
  }
  const rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(UI_DIST, rel);
  if (!fs.existsSync(file)) file = path.join(UI_DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function startServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const { pathname } = url;

    try {
      if (req.method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true });
      // Open: lets the UI know whether to prompt for a token before calling the API.
      if (req.method === "GET" && pathname === "/api/config") return sendJson(res, 200, { authEnabled });

      // ── GitHub OAuth (open: these are browser navigations + the GitHub callback,
      //    which can't carry the bearer token) ──
      if (req.method === "GET" && pathname === "/api/github/login") {
        if (!oauthConfigured) return sendJson(res, 400, { error: "OAuth not configured — set GITHUB_CLIENT_ID/SECRET in engine/.env" });
        return redirect(res, authorizeUrl(OAUTH_CALLBACK, newState()));
      }
      if (req.method === "GET" && pathname === "/api/github/callback") {
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

      // Gate the API (health stays open for deploy health checks). The static UI
      // is served unauthenticated so the login screen can load; it then sends the
      // token on every /api + WS call.
      if (pathname.startsWith("/api/") && !checkAuth(req)) {
        return sendJson(res, 401, { error: "unauthorized" });
      }

      // ── GitHub ──
      if (req.method === "GET" && pathname === "/api/github/status") {
        const login = await getSetting("githubLogin");
        return sendJson(res, 200, { connected: Boolean(login), login: login ?? "", oauthConfigured });
      }
      if (req.method === "POST" && pathname === "/api/github/connect") {
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
      if (req.method === "GET" && pathname === "/api/github/repos") {
        const token = await getSetting("githubToken");
        if (!token) return sendJson(res, 400, { error: "connect GitHub first" });
        return sendJson(res, 200, await fetchUserRepos(token));
      }

      // ── projects ──
      if (req.method === "GET" && pathname === "/api/projects") return sendJson(res, 200, await listProjects());
      if (req.method === "POST" && pathname === "/api/projects") {
        const b = await readBody(req);
        const name = String(b.name ?? "").trim();
        const localPath = String(b.localPath ?? "").trim();
        const repo = String(b.repo ?? "").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        // Local: a path that exists. Hosted: a GitHub repo the engine clones on
        // first run (ensureRepoCloned). One of the two is required.
        if (!localPath && !repo) return sendJson(res, 400, { error: "localPath or repo required" });
        if (localPath && !fs.existsSync(localPath)) return sendJson(res, 400, { error: `path not found: ${localPath}` });
        // Repo projects inherit the connected GitHub token (for private clones + PRs).
        const githubToken = String(b.githubToken ?? "") || (repo ? (await getSetting("githubToken")) ?? "" : "");
        const project = await createProject({
          name, localPath, repo,
          defaultBranch: String(b.defaultBranch ?? "main"),
          githubToken,
          agentRules: String(b.agentRules ?? ""),
        });
        broadcast({ type: "project.created", project });
        return sendJson(res, 201, project);
      }

      // ── jobs ──
      if (req.method === "GET" && pathname === "/api/jobs") return sendJson(res, 200, await listJobs());
      if (req.method === "POST" && pathname === "/api/jobs") {
        const b = await readBody(req);
        const projectId = String(b.projectId ?? "").trim();
        const prompt = String(b.prompt ?? "").trim();
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });
        if (!prompt) return sendJson(res, 400, { error: "prompt required" });
        const title = (String(b.title ?? "").trim() || prompt).slice(0, 80);
        const job = await createJob({ projectId, title, prompt });
        broadcast({ type: "job.created", job });
        enqueue(job.id); // the real runner picks it up
        return sendJson(res, 201, job);
      }

      if (req.method === "GET") return serveStatic(pathname, res);
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  attachWebsocket(server);
  // Defaults to localhost (safe for local dev). When deployed, set FACTORY_HOST=
  // 0.0.0.0 so the container's proxy can reach it — but ONLY with auth enabled
  // (FACTORY_AUTH_TOKEN), since /api/jobs runs Claude with shell access.
  const host = process.env.FACTORY_HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`⚙️  Factory engine → http://${host}:${port}`));
  return server;
}
