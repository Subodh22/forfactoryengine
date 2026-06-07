// Factory desktop — wraps the engine + UI in a native window.
//
// The engine is a Node server; Electron ships its own Node, so the main process
// starts the engine IN-PROCESS (dynamic import of the bundled ESM build) and then
// loads the served UI in a BrowserWindow. No sidecar binary, no separate port
// juggling beyond picking a free one. The DB + cloned repos live in the OS
// per-user app-data dir so each install is self-contained.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");

const RES = path.join(__dirname, "resources");
const ENGINE_BUNDLE = path.join(RES, "engine", "factory.mjs");
const UI_DIST = path.join(RES, "ui");

let mainWindow = null;
let tray = null;
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

async function waitForHealth(p, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${p}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startEngine() {
  port = await findFreePort(8787);
  // Configure the engine before importing it (the bundle reads env at load).
  process.env.PORT = String(port);
  process.env.FACTORY_HOST = "127.0.0.1"; // desktop app is always local-only
  process.env.FACTORY_UI_DIST = UI_DIST;
  process.env.FACTORY_DATA_DIR = app.getPath("userData");
  process.env.FACTORY_WORKSPACE = process.env.FACTORY_WORKSPACE || path.join(app.getPath("userData"), "repos");
  fs.mkdirSync(process.env.FACTORY_WORKSPACE, { recursive: true });
  // Importing the bundle boots the server (top-level startServer()).
  await import(`file://${ENGINE_BUNDLE}`);
  await waitForHealth(port);
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
    const { dialog } = require("electron");
    dialog.showErrorBox("Factory failed to start", String(err));
    app.quit();
    return;
  }
  createWindow();
  createTray();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { /* keep running in the tray; quit via tray menu */ });
