import os from "node:os";
import fs from "node:fs";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";

// Real interactive web terminal. Each browser TerminalPanel opens a WebSocket to
// /term; we allocate a pseudo-terminal (PTY) running the user's shell in the
// project's directory and pipe raw bytes both ways. Unlike the old one-shot
// runner this gives a true TTY, so interactive programs (claude, vim, REPLs,
// less) work. One PTY per socket; it dies when the socket closes.

// Messages from the browser are JSON: {i:"keystrokes"} for input, {r:[cols,rows]}
// for a resize. PTY output is sent back as raw text frames.
interface TermClientMsg { i?: string; r?: [number, number] }

function pickShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
  for (const sh of [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (sh && fs.existsSync(sh)) return sh;
  }
  return "/bin/sh";
}

export function handleTerminalConnection(socket: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url ?? "/term", "http://localhost");
  const cwd = url.searchParams.get("cwd") || os.homedir();
  const cols = Number(url.searchParams.get("cols")) || 80;
  const rows = Number(url.searchParams.get("rows")) || 24;
  const safeCwd = fs.existsSync(cwd) ? cwd : os.homedir();

  let term: pty.IPty;
  try {
    term = pty.spawn(pickShell(), [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: safeCwd,
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    });
  } catch (err) {
    try { socket.send(`\r\n[factory] failed to start terminal: ${(err as Error).message}\r\n`); } catch { /* ignore */ }
    socket.close();
    return;
  }

  const onData = term.onData((data) => {
    if (socket.readyState === socket.OPEN) socket.send(data);
  });
  const onExit = term.onExit(({ exitCode }) => {
    try { if (socket.readyState === socket.OPEN) socket.send(`\r\n[exit ${exitCode}]\r\n`); } catch { /* ignore */ }
    socket.close();
  });

  socket.on("message", (raw) => {
    let msg: TermClientMsg;
    try { msg = JSON.parse(raw.toString()) as TermClientMsg; } catch { return; }
    if (typeof msg.i === "string") term.write(msg.i);
    else if (Array.isArray(msg.r)) { try { term.resize(msg.r[0] || 80, msg.r[1] || 24); } catch { /* ignore */ } }
  });

  socket.on("close", () => {
    onData.dispose();
    onExit.dispose();
    try { term.kill(); } catch { /* already gone */ }
  });
}
