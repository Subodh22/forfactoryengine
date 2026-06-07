"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Trash2, Square, CornerDownLeft } from "lucide-react";
import { useFactory } from "@/lib/data";
import { terminalExec, terminalKill } from "@/lib/mutations";

const EXIT_MARK = "\x00exit\x00";
const STDERR_MARK = "\x00stderr\x00";

type Entry =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string }
  | { kind: "err"; text: string }
  | { kind: "exit"; code: number }
  | { kind: "info"; text: string };

type TerminalProject = { name: string; localPath: string };

/**
 * Non-interactive terminal: each command runs on the engine in the project's
 * localPath; stdout/stderr stream back over the engine WebSocket as term.output
 * events. Not a PTY, but enough for builds, git, npm, tests from the browser.
 */
export function TerminalPanel({ project }: { project: TerminalProject }) {
  const { onTerm, live } = useFactory();
  const [entries, setEntries] = useState<Entry[]>([{ kind: "info", text: `Connected to ${project.localPath}` }]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);

  const sessionIdRef = useRef<string>("");
  if (!sessionIdRef.current) sessionIdRef.current = `term-${Math.random().toString(36).slice(2)}-${project.localPath.length}`;
  const sessionId = sessionIdRef.current;

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  useEffect(() => {
    return onTerm(sessionId, (text) => {
      if (text.startsWith(EXIT_MARK)) {
        const code = Number(text.slice(EXIT_MARK.length)) || 0;
        setRunning(false);
        setEntries((prev) => [...prev, { kind: "exit", code }]);
        return;
      }
      if (text.startsWith(STDERR_MARK)) {
        setEntries((prev) => [...prev, { kind: "err", text: text.slice(STDERR_MARK.length) }]);
        return;
      }
      setEntries((prev) => [...prev, { kind: "out", text }]);
    });
  }, [sessionId, onTerm]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [entries]);

  async function run() {
    const command = input.trim();
    if (!command || running || !live) return;
    if (command === "clear" || command === "cls") { setEntries([]); setInput(""); return; }
    historyRef.current.push(command);
    setHistIdx(-1);
    setEntries((prev) => [...prev, { kind: "cmd", text: command }]);
    setInput("");
    setRunning(true);
    try {
      await terminalExec(sessionId, project.localPath, command);
    } catch (err) {
      setEntries((prev) => [...prev, { kind: "err", text: `${(err as Error).message}\n` }]);
      setRunning(false);
    }
  }

  async function kill() {
    try { await terminalKill(sessionId); } catch { /* ignore */ }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); run(); return; }
    if (e.key === "c" && e.ctrlKey && running) { e.preventDefault(); kill(); return; }
    const hist = historyRef.current;
    if (e.key === "ArrowUp" && hist.length) {
      e.preventDefault();
      const next = histIdx === -1 ? hist.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next); setInput(hist[next]);
    }
    if (e.key === "ArrowDown" && histIdx !== -1) {
      e.preventDefault();
      const next = histIdx + 1;
      if (next >= hist.length) { setHistIdx(-1); setInput(""); }
      else { setHistIdx(next); setInput(hist[next]); }
    }
  }

  return (
    <div className="flex flex-col h-full max-w-[840px] mx-auto w-full bg-ink border-4 border-ink brutal-shadow-muted overflow-hidden text-[#cfe8cf]">
      <div className="flex items-center gap-2 px-3 h-10 border-b-2 border-[#2a2722] flex-shrink-0">
        <TerminalIcon className="w-3.5 h-3.5 text-[#3bd16f]" />
        <span className="font-mono text-xs font-bold text-[#cfe8cf]">{project.name}</span>
        <span className="font-mono text-[10px] text-[#6b8a6b] truncate max-w-[40%]" title={project.localPath}>{project.localPath}</span>
        <span className={`ml-auto flex items-center gap-1 font-mono text-[10px] ${live ? "text-[#3bd16f]" : "text-[#6b8a6b]"}`}>
          <span className={`w-1.5 h-1.5 ${live ? "bg-[#3bd16f]" : "bg-[#6b8a6b]"}`} />{live ? "connected" : "offline"}
        </span>
        {running && (
          <button onClick={kill} className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] text-[#ff8a7a] hover:text-white border border-[#d6210f] transition-colors" title="Stop (Ctrl+C)"><Square className="w-2.5 h-2.5" /> stop</button>
        )}
        <button onClick={() => setEntries([])} className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] text-[#6b8a6b] hover:text-[#cfe8cf] border border-[#6b8a6b] transition-colors" title="Clear"><Trash2 className="w-2.5 h-2.5" /> clear</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[13px] leading-[1.7]" onClick={() => inputRef.current?.focus()}>
        {entries.map((e, i) => {
          if (e.kind === "cmd") return <div key={i} className="whitespace-pre-wrap break-words"><span className="text-[#3bd16f]">$ </span><span className="text-[#e7e4dc]">{e.text}</span></div>;
          if (e.kind === "err") return <pre key={i} className="whitespace-pre-wrap break-words text-red-400 font-mono">{e.text}</pre>;
          if (e.kind === "exit") return <div key={i} className={`text-[11px] ${e.code === 0 ? "text-[#6b8a6b]" : "text-red-500"}`}>[exit {e.code}]</div>;
          if (e.kind === "info") return <div key={i} className="text-[11px] text-[#6b8a6b]">{e.text}</div>;
          return <pre key={i} className="whitespace-pre-wrap break-words text-[#cfe8cf] font-mono">{e.text}</pre>;
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-4 h-11 border-t-2 border-[#2a2722] flex-shrink-0">
        <span className="text-[#3bd16f] font-mono text-[13px]">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!live}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder={live ? (running ? "running… (Ctrl+C to stop)" : "type a command and press Enter") : "connecting to engine…"}
          className="flex-1 bg-transparent outline-none font-mono text-[13px] text-[#e7e4dc] placeholder:text-[#6b8a6b] disabled:opacity-50"
        />
        <button onClick={run} disabled={!live || running || !input.trim()} className="flex items-center gap-1 text-[#6b8a6b] hover:text-[#cfe8cf] disabled:opacity-30 transition-colors" title="Run (Enter)"><CornerDownLeft className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}