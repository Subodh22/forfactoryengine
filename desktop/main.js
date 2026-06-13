// Factory desktop — wraps the engine + UI in a native window.
//
// The engine is a Node server with native deps (libsql, node-pty) compiled for
// the host's Node ABI. Electron ships a DIFFERENT Node, so we DON'T run the engine
// inside Electron — we spawn it as a child process using the host's `node`, exactly
// like the CLI does. That keeps the native modules working with zero rebuild and
// runs the identical engine the browser uses. The DB + cloned repos live in the OS
// per-user app-data dir so each install is self-contained.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");

// In dev the resources sit next to this file; in a packaged app they're shipped
// as extraResources (unpacked, so the child system-Node can read them — code
// inside an asar archive isn't reachable by a plain `node` process).
const RES = app.isPackaged
  ? path.join(process.resourcesPath, "resources")
  : path.join(__dirname, "resources");
const ENGINE_BUNDLE = path.join(RES, "engine", "factory.mjs");
const UI_DIST = path.join(RES, "ui");

let mainWindow = null;
let tray = null;
let engine = null;
let port = 8787;

function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", () => resolve(findFreePort(start + 1)));
  });
}

// Find the host's Node binary. GUI apps launch with a minimal PATH that usually
// omits Homebrew/nvm, so we probe the usual install locations directly. Returns
// null if no Node is found (we then tell the user to install it).
function findNode() {
  if (process.env.FACTORY_NODE && fs.existsSync(process.env.FACTORY_NODE)) return process.env.FACTORY_NODE;
  const candidates = [];
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const found = execFileSync(which, ["node"], { encoding: "utf8" }).split("\n")[0].trim();
    if (found) candidates.push(found);
  } catch { /* not on PATH */ }
  candidates.push(
    "/opt/homebrew/bin/node",     // Apple-silicon Homebrew
    "/usr/local/bin/node",        // Intel Homebrew / nodejs.org pkg
    "/usr/bin/node",
  );
  // nvm: newest installed version
  try {
    const nvm = path.join(require("node:os").homedir(), ".nvm", "versions", "node");
    if (fs.existsSync(nvm)) {
      const versions = fs.readdirSync(nvm).sort().reverse();
      for (const v of versions) candidates.push(path.join(nvm, v, "bin", "node"));
    }
  } catch { /* no nvm */ }
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

async function waitForHealth(p, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${p}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startEngine() {
  const node = findNode();
  if (!node) {
    throw new Error(
      "Node.js 20+ is required to run Factory but none was found.\n" +
      "Install it from https://nodejs.org and reopen the app.",
    );
  }
  port = await findFreePort(8787);

  const workspace = process.env.FACTORY_WORKSPACE || path.join(app.getPath("userData"), "repos");
  fs.mkdirSync(workspace, { recursive: true });

  engine = spawn(node, [ENGINE_BUNDLE], {
    env: {
      ...process.env,
      PORT: String(port),
      FACTORY_HOST: "127.0.0.1",           // desktop app is always local-only
      FACTORY_UI_DIST: UI_DIST,
      FACTORY_DATA_DIR: app.getPath("userData"),
      FACTORY_WORKSPACE: workspace,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  engine.stdout.on("data", (d) => process.stdout.write(`[engine] ${d}`));
  engine.stderr.on("data", (d) => process.stderr.write(`[engine] ${d}`));
  engine.on("exit", (code) => {
    engine = null;
    // If the engine dies unexpectedly while the app is up, surface it and quit.
    if (!app.isQuiting && code) {
      dialog.showErrorBox("Factory engine stopped", `The engine exited with code ${code}. Check the logs.`);
      app.quit();
    }
  });

  if (!(await waitForHealth(port))) {
    throw new Error("The engine did not become healthy in time. Check the logs for errors.");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#cfccc4",
    title: "Factory",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  // Open external links (PRs, GitHub) in the system browser, not the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("Factory");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Factory", click: () => (mainWindow ? mainWindow.show() : createWindow()) },
      { label: "Open in browser", click: () => shell.openExternal(`http://127.0.0.1:${port}`) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
  } catch { /* tray is best-effort */ }
}

app.whenReady().then(async () => {
  try {
    await startEngine();
  } catch (err) {
    dialog.showErrorBox("Factory failed to start", String(err.message ?? err));
    app.quit();
    return;
  }
  createWindow();
  createTray();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Tear the engine down with the app.
app.on("before-quit", () => { app.isQuiting = true; if (engine) try { engine.kill(); } catch { /* gone */ } });
app.on("window-all-closed", () => { /* keep running in the tray; quit via tray menu */ });
