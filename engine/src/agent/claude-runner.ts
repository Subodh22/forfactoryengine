import { spawn } from "child_process";

export interface TurnResult {
  assistantText: string;
  resultText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ClaudeSession {
  /** Send a message and wait for Claude to finish the turn. Spawns a new process
   *  per call but passes --resume <sessionId> so conversation context is preserved. */
  sendMessage: (text: string) => Promise<TurnResult>;
  onChunk: (fn: (text: string) => void) => void;
  onSessionId: (fn: (id: string) => void) => void;
  getSessionId: () => string | null;
  cancel: () => void;
}

export interface ClaudeSessionOptions {
  /** "opus" | "sonnet" | "haiku" — passed through as `--model`. */
  model?: string;
  /** Reasoning effort hint — surfaced to the agent as a system note (the CLI has
   *  no dedicated flag, so we prepend a one-line directive to the first turn). */
  effort?: "low" | "medium" | "high" | "max";
}

const isWin = process.platform === "win32";

// ── Process control ──────────────────────────────────────────────────────────
// Every live `claude` child is tracked so a graceful shutdown (or a hung turn)
// can kill the whole process group — otherwise a crashed engine leaves orphaned
// agents burning tokens with no job to report to.
const liveProcs = new Set<ReturnType<typeof spawn>>();

// A turn that produces no output for this long is considered hung (model/API
// outage, network partition) and killed; the job fails with a clear error
// instead of blocking its queue slot forever. 0 disables the timeout.
const IDLE_TIMEOUT_MS = Number(process.env.FACTORY_TURN_IDLE_TIMEOUT_MS ?? 600_000);

function killProcTree(proc: ReturnType<typeof spawn>): void {
  try {
    // Detached spawn (below) makes the child a process-group leader, so a
    // negative-pid kill takes down the CLI's own children too.
    if (!isWin && proc.pid) process.kill(-proc.pid, "SIGTERM");
    else proc.kill("SIGTERM");
  } catch { /* already gone */ }
  const hard = setTimeout(() => {
    try {
      if (!isWin && proc.pid) process.kill(-proc.pid, "SIGKILL");
      else proc.kill("SIGKILL");
    } catch { /* already gone */ }
  }, 10_000);
  hard.unref();
}

/** Kill every live agent process — called on engine shutdown. */
export function killAllClaudeProcs(): void {
  for (const p of liveProcs) killProcTree(p);
  liveProcs.clear();
}

function formatToolUse(name: string, input: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (n === "read") {
    return `\x00tool\x00Read    ${input.file_path ?? input.path ?? ""}\n`;
  }
  if (n === "write") {
    const lines = String(input.content ?? "").split("\n").length;
    return `\x00tool\x00Write   ${input.file_path ?? input.path ?? ""} (${lines} lines)\n`;
  }
  if (n === "edit") {
    return `\x00tool\x00Edit    ${input.file_path ?? input.path ?? ""}\n`;
  }
  if (n === "multiedit") {
    const count = Array.isArray(input.edits) ? input.edits.length : "?";
    return `\x00tool\x00Edit    ${count} file(s)\n`;
  }
  if (n === "bash") {
    const cmd = String(input.command ?? "").replace(/\n/g, " ").slice(0, 100);
    return `\x00bash\x00$ ${cmd}\n`;
  }
  if (n === "glob") {
    const loc = input.path ? ` in ${input.path}` : "";
    return `\x00tool\x00Glob    ${input.pattern ?? ""}${loc}\n`;
  }
  if (n === "grep") {
    const loc = input.path ? ` in ${input.path}` : "";
    return `\x00tool\x00Grep    "${input.pattern ?? ""}"${loc}\n`;
  }
  if (n === "todowrite") {
    return `\x00tool\x00Todo    updated\n`;
  }
  if (n === "websearch") {
    return `\x00tool\x00Search  ${input.query ?? ""}\n`;
  }
  if (n === "webfetch") {
    return `\x00tool\x00Fetch   ${input.url ?? ""}\n`;
  }
  if (n === "agent") {
    return `\x00tool\x00Agent   spawning subagent\n`;
  }
  const firstVal = Object.values(input)[0];
  return `\x00tool\x00${name.padEnd(8)}${String(firstVal ?? "").slice(0, 80)}\n`;
}

/**
 * Creates a Claude Code session.
 *
 * Each sendMessage() call spawns a fresh `claude -p` process (non-interactive,
 * so stdin piping works reliably). The session_id captured from the first turn
 * is passed as --resume on every subsequent turn, giving Claude full conversation
 * context without a persistent process.
 *
 * Chunks are prefixed with \x00tool\x00 / \x00bash\x00 / \x00stderr\x00
 * so the UI can colour-code them.
 */
export function createClaudeSession(cwd: string, resumeSessionId?: string, options: ClaudeSessionOptions = {}): ClaudeSession {
  let currentSessionId: string | null = resumeSessionId ?? null;
  let chunkHandler: ((text: string) => void) | null = null;
  let sessionIdHandler: ((id: string) => void) | null = null;
  let currentProc: ReturnType<typeof spawn> | null = null;
  let cancelled = false;

  function spawnTurn(text: string): Promise<TurnResult> {
    return new Promise((resolve, reject) => {
      if (cancelled) { reject(new Error("Session cancelled")); return; }

      const args: string[] = [
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--print",          // non-interactive: reads prompt from stdin
      ];
      if (currentSessionId) {
        args.push("--resume", currentSessionId);
      }
      if (options.model) {
        args.push("--model", options.model);
      }

      const proc = spawn("claude", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: isWin,
        detached: !isWin, // own process group → killProcTree reaps grandchildren
      });
      currentProc = proc;
      liveProcs.add(proc);

      // Feed the prompt via stdin then close — -p/--print reads from stdin when
      // no prompt argument is supplied
      proc.stdin!.write(text + "\n");
      proc.stdin!.end();

      let buffer = "";
      let assistantText = "";
      let resultText = "";
      let resolved = false;
      let needsNewline = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let costUsd = 0;

      function finish(result: TurnResult) {
        if (resolved) return;
        resolved = true;
        currentProc = null;
        resolve(result);
      }

      function fail(err: Error) {
        if (resolved) return;
        resolved = true;
        currentProc = null;
        reject(err);
      }

      // Inactivity watchdog — re-armed on every output chunk, so long turns are
      // fine as long as the agent keeps streaming.
      let idleTimer: NodeJS.Timeout | undefined;
      const armIdleTimer = () => {
        if (IDLE_TIMEOUT_MS <= 0) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          killProcTree(proc);
          fail(new Error(`Claude turn produced no output for ${Math.round(IDLE_TIMEOUT_MS / 60_000)} min — killed as hung`));
        }, IDLE_TIMEOUT_MS);
      };
      armIdleTimer();

      proc.stdout!.on("data", (chunk: Buffer) => {
        armIdleTimer();
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            if (parsed.session_id) {
              currentSessionId = parsed.session_id;
              sessionIdHandler?.(parsed.session_id);
            }

            if (parsed.type === "assistant" && parsed.message?.content) {
              const usage = parsed.message.usage;
              if (usage) {
                inputTokens = Math.max(inputTokens, usage.input_tokens ?? 0);
                outputTokens += usage.output_tokens ?? 0;
              }
              for (const block of parsed.message.content) {
                if (block.type === "text" && block.text) {
                  assistantText += block.text;
                  chunkHandler?.(block.text);
                  needsNewline = !block.text.endsWith("\n");
                } else if (block.type === "tool_use") {
                  const prefix = needsNewline ? "\n" : "";
                  chunkHandler?.(prefix + formatToolUse(block.name, block.input ?? {}));
                  needsNewline = false;
                }
              }
            } else if (parsed.type === "result") {
              resultText = parsed.result ?? "";
              costUsd = parsed.total_cost_usd ?? 0;
              finish({ assistantText, resultText, inputTokens, outputTokens, costUsd });
            }
          } catch {
            // Non-JSON startup noise — stream as plain text
            if (chunkHandler) chunkHandler(line + "\n");
          }
        }
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        armIdleTimer();
        const text = chunk.toString();
        if (chunkHandler) chunkHandler("\x00stderr\x00" + text);
      });

      proc.on("close", (code) => {
        clearTimeout(idleTimer);
        liveProcs.delete(proc);
        currentProc = null;
        if (!resolved) {
          if (code === 0 || assistantText) {
            finish({ assistantText, resultText, inputTokens, outputTokens, costUsd });
          } else {
            fail(new Error(`Claude exited with code ${code}`));
          }
        }
      });

      proc.on("error", (err) => {
        clearTimeout(idleTimer);
        liveProcs.delete(proc);
        fail(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  return {
    sendMessage: spawnTurn,
    onChunk(fn) { chunkHandler = fn; },
    onSessionId(fn) { sessionIdHandler = fn; },
    getSessionId() { return currentSessionId; },
    cancel() {
      cancelled = true;
      if (currentProc) killProcTree(currentProc);
    },
  };
}
