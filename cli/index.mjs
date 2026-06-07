#!/usr/bin/env node
// Factory CLI — preflight + launch the local engine, which serves the full UI.
// Zero runtime dependencies (Node builtins only) so it stays tiny and portable.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import net from "node:net";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

// Resolve the engine bundle + built UI. Works both from the repo (engine/dist,
// ui/dist) and from a packaged install (engine/, ui/ copied next to this file).
function firstExisting(...candidates) {
  return candidates.find((c) => c && existsSync(c));
}
const ENGINE_BUNDLE = firstExisting(
  process.env.FACTORY_ENGINE_BUNDLE,
  path.join(HERE, "engine", "factory.mjs"),            // packaged
  path.join(HERE, "..", "engine", "dist", "factory.mjs"), // repo
);
const UI_DIST = firstExisting(
  process.env.FACTORY_UI_DIST,
  path.join(HERE, "ui"),                                 // packaged
  path.join(HERE, "..", "ui", "dist"),                   // repo
);

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
const ok = (m) => console.log(`  ${C.green("✓")} ${m}`);
const warn = (m) => console.log(`  ${C.yellow("!")} ${m}`);
const bad = (m) => console.log(`  ${C.red("✗")} ${m}`);

function has(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "pipe", shell: process.platform === "win32" });
  return r.status === 0 ? (r.stdout?.toString().trim().split("\n")[0] ?? "ok") : null;
}

function claudeLoggedIn() {
  const p = path.join(os.homedir(), ".claude", ".credentials.json");
  if (!existsSync(p)) return { ok: false, reason: "no ~/.claude/.credentials.json" };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const o = raw.claudeAiOauth ?? raw;
    if (!o?.accessToken) return { ok: false, reason: "no access token in credentials" };
    if (o.expiresAt && o.expiresAt < Date.now()) return { ok: false, reason: "token expired — run `claude` to refresh" };
    return { ok: true, plan: o.subscriptionType };
  } catch {
    return { ok: false, reason: "could not read credentials" };
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.on("connect", () => { s.destroy(); resolve(false); });
    s.on("error", () => resolve(true));
  });
}

async function waitForHealth(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref(); } catch { /* ignore */ }
}

// ── doctor ───────────────────────────────────────────────────────────────────
function doctor({ silent = false } = {}) {
  if (!silent) console.log(C.bold("\nFactory preflight\n"));
  let fatal = false;

  const [maj] = process.versions.node.split(".").map(Number);
  maj >= 20 ? ok(`Node ${process.versions.node}`) : (bad(`Node ${process.versions.node} — need ≥ 20`), (fatal = true));

  const git = has("git");
  git ? ok(`git — ${git}`) : (bad("git not found on PATH — install Git"), (fatal = true));

  const claude = has("claude");
  if (claude) ok(`claude CLI — ${claude}`);
  else { bad("claude CLI not found — install Claude Code (npm i -g @anthropic-ai/claude-code)"); fatal = true; }

  const login = claudeLoggedIn();
  if (login.ok) ok(`claude signed in${login.plan ? ` (${login.plan})` : ""}`);
  else warn(`claude not signed in: ${login.reason} — run \`claude\` once to log in`);

  if (!ENGINE_BUNDLE) { bad("engine bundle not found — run `npm run build` in engine/"); fatal = true; }
  else ok("engine bundle");
  if (!UI_DIST) warn("built UI not found — run `npm run build:ui` (engine will show a placeholder)");
  else ok("UI build");

  return { fatal, claudeReady: login.ok };
}

// ── up ───────────────────────────────────────────────────────────────────────
async function up() {
  const { fatal } = doctor();
  if (fatal) { console.log(C.red("\nResolve the ✗ items above, then run `factory up` again.\n")); process.exit(1); }

  if (!(await portFree(PORT))) {
    console.log(C.yellow(`\nSomething is already listening on :${PORT}. `) + `Open http://localhost:${PORT} or run \`factory stop\`.\n`);
    openBrowser(`http://localhost:${PORT}`);
    return;
  }

  console.log(C.dim(`\nStarting engine on :${PORT} …`));
  const child = spawn(process.execPath, [ENGINE_BUNDLE], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT), FACTORY_UI_DIST: UI_DIST ?? "" },
  });
  child.on("exit", (code) => process.exit(code ?? 0));

  if (await waitForHealth(PORT)) {
    const url = `http://localhost:${PORT}`;
    console.log(C.green(`\n✓ Factory is live → ${C.bold(url)}\n`) + C.dim("  Ctrl+C to stop.\n"));
    openBrowser(url);
  } else {
    console.log(C.yellow("\nEngine did not report healthy in time — check the logs above.\n"));
  }
}

// ── stop ─────────────────────────────────────────────────────────────────────
function stop() {
  if (process.platform === "win32") {
    spawnSync("powershell", ["-Command", `Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: "ignore" });
  } else {
    const r = spawnSync("lsof", ["-ti", `:${PORT}`], { encoding: "utf8" });
    const pids = (r.stdout ?? "").split("\n").filter(Boolean);
    if (!pids.length) { console.log(`Nothing running on :${PORT}.`); return; }
    for (const pid of pids) try { process.kill(Number(pid), "SIGTERM"); } catch { /* gone */ }
    console.log(`Stopped Factory on :${PORT}.`);
  }
}

const cmd = process.argv[2] ?? "up";
switch (cmd) {
  case "up": case "start": await up(); break;
  case "doctor": { const { fatal } = doctor(); console.log(""); process.exit(fatal ? 1 : 0); }
  case "stop": stop(); break;
  case "open": openBrowser(`http://localhost:${PORT}`); break;
  default:
    console.log(`factory — local AI software factory\n\n  factory up       preflight + start the engine, open the app\n  factory doctor   check prerequisites (Node, git, Claude login)\n  factory stop     stop the running engine\n  factory open     open the app in your browser\n`);
}
