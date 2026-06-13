"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { termUrl } from "@/lib/api";

/**
 * A single interactive PTY rendered with xterm.js over a /term WebSocket. The PTY
 * runs the user's shell in `cwd` and lives for as long as this component is
 * mounted. `active` tells it when it's the visible tab so it can refit/refocus
 * (xterm can't measure a hidden element). Chrome (tabs) lives in TerminalTabs.
 */
export function TerminalPanel({ cwd, active, bootCommand }: { cwd: string; active: boolean; bootCommand?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bootedRef = useRef(false);
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
    try { fit.fit(); } catch { /* refit once laid out */ }
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(termUrl(cwd, term.cols, term.rows));
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
      term.focus();
      // Auto-run a boot command once (e.g. the project's setup / run script).
      if (bootCommand && bootCommand.trim() && !bootedRef.current) {
        bootedRef.current = true;
        setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ i: `${bootCommand}\n` })); }, 300);
      }
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
      else if (e.data instanceof Blob) e.data.text().then((t) => term.write(t)).catch(() => {});
    };

    const onData = term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ i: d })); });

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
      termRef.current = null; fitRef.current = null; wsRef.current = null;
    };
  }, [cwd]);

  // Refit + refocus when this terminal becomes the visible tab.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      const fit = fitRef.current, term = termRef.current, ws = wsRef.current;
      if (!fit || !term) return;
      try { fit.fit(); } catch { return; }
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="flex flex-col h-full w-full">
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" style={{ backgroundColor: "#1a1714" }} />
      <div className="flex items-center gap-2 px-3 h-7 border-t border-[#2a2722] flex-shrink-0 bg-concrete">
        <span className={`flex items-center gap-1 font-mono text-[10px] ${connected ? "text-[#3bd16f]" : "text-[#6b8a6b]"}`}>
          <span className={`w-1.5 h-1.5 ${connected ? "bg-[#3bd16f]" : "bg-[#6b8a6b]"}`} />{connected ? "connected" : "offline"}
        </span>
        <button onClick={() => termRef.current?.clear()} className="ml-auto flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] text-[#6b8a6b] hover:text-[#cfe8cf] transition-colors" title="Clear"><Trash2 className="w-2.5 h-2.5" /> clear</button>
      </div>
    </div>
  );
}
