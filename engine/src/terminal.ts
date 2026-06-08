import { spawn, type ChildProcess } from "node:child_process";
import { emitTerm } from "./events";

// Non-interactive web terminal. Each command is spawned in the project's
// localPath; stdout/stderr stream back over the engine WebSocket as `term.output`
// events keyed by the browser's session id. Not a PTY — but enough for builds,
// git, npm, tests, etc. stderr and the final exit code use \x00-markers the UI
// colour-codes, mirroring the agent stream convention.

const terminalProcs = new Map<string, ChildProcess>();

export function runTerminalCommand(sessionId: string, cwd: string, command: string): void {
  const existing = terminalProcs.get(sessionId);
  if (existing) {
    try { existing.kill(); } catch { /* already gone */ }
  }

  let child: ChildProcess;
  try {
    child = spawn(command, { cwd, shell: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    emitTerm(sessionId, `\x00stderr\x00${(err as Error).message}\n`);
    emitTerm(sessionId, `\x00exit\x001`);
    return;
  }

  terminalProcs.set(sessionId, child);
  child.stdout?.on("data", (d: Buffer) => emitTerm(sessionId, d.toString()));
  child.stderr?.on("data", (d: Buffer) => emitTerm(sessionId, `\x00stderr\x00${d.toString()}`));
  child.on("error", (err) => emitTerm(sessionId, `\x00stderr\x00${err.message}\n`));
  child.on("close", (code) => {
    terminalProcs.delete(sessionId);
    emitTerm(sessionId, `\x00exit\x00${code ?? 0}`);
  });
}

export function killTerminal(sessionId: string): boolean {
  const child = terminalProcs.get(sessionId);
  if (child) {
    try { child.kill(); } catch { /* already gone */ }
    return true;
  }
  return false;
}
