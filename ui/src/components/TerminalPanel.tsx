"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { termUrl } from "@/lib/api";

type TerminalProject = { name: string; localPath: string };

/**
 * Interactive terminal backed by a real PTY on the engine. We open a WebSocket to
 * /term (one socket ↔ one pseudo-terminal running the user's shell in the project
 * dir) and pipe raw bytes through xterm.js, so interactive programs — claude, vim,
 * REPLs, less — work as they would in a normal terminal. The PTY lives for as long
 * as this panel is mounted.
 */
export function TerminalPanel({ project }: { project: TerminalProject }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#1a1714", foreground: "#cfe8cf", cursor: "#3bd16f" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try { fit.fit(); } catch { /* container not laid out yet; ResizeObserver refits */ }
    termRef.current = term;

    const ws = new WebSocket(termUrl(project.localPath, term.cols, term.rows));
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
      term.focus();
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
      else if (e.data instanceof Blob) e.data.text().then((t) => term.write(t)).catch(() => {});
    };

    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ i: d }));
    });

    const refit = () => {
      try { fit.fit(); } catch { return; }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
    };
    const ro = new ResizeObserver(refit);
    ro.observe(container);

    return () => {
      ro.disconnect();
      onData.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, [project.localPath]);

  return (
    <div className="flex flex-col h-full max-w-[840px] mx-auto w-full bg-ink border-4 border-ink brutal-shadow-muted overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-10 border-b-2 border-[#2a2722] flex-shrink-0">
        <TerminalIcon className="w-3.5 h-3.5 text-[#3bd16f]" />
        <span className="font-mono text-xs font-bold text-[#cfe8cf]">{project.name}</span>
        <span className="font-mono text-[10px] text-[#6b8a6b] truncate max-w-[40%]" title={project.localPath}>{project.localPath}</span>
        <span className={`ml-auto flex items-center gap-1 font-mono text-[10px] ${connected ? "text-[#3bd16f]" : "text-[#6b8a6b]"}`}>
          <span className={`w-1.5 h-1.5 ${connected ? "bg-[#3bd16f]" : "bg-[#6b8a6b]"}`} />{connected ? "connected" : "offline"}
        </span>
        <button onClick={() => termRef.current?.clear()} className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] text-[#6b8a6b] hover:text-[#cfe8cf] border border-[#6b8a6b] transition-colors" title="Clear"><Trash2 className="w-2.5 h-2.5" /> clear</button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" style={{ backgroundColor: "#1a1714" }} />
    </div>
  );
}
