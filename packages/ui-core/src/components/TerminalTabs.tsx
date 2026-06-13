"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Plus, X } from "lucide-react";
import { TerminalPanel } from "./TerminalPanel";

type TerminalProject = { name: string; localPath: string };
interface TerminalPreset { label: string; command: string }
interface Session { id: string; label: string; command?: string }

// Globally-unique PTY ids so a remount never collides with a lingering socket.
let GLOBAL_SEQ = 0;

/**
 * Multiple interactive terminals for a project: a tab bar over a stack of PTYs.
 * Every session is its own shell (run `claude` in any of them). Tabs stay mounted
 * while the Terminal view is open so their shells keep running in the background;
 * only the active one is shown.
 */
export function TerminalTabs({ project, presets = [] }: { project: TerminalProject; presets?: TerminalPreset[] }) {
  const localSeq = useRef(0);
  const make = (): Session => { localSeq.current += 1; GLOBAL_SEQ += 1; return { id: `term-${GLOBAL_SEQ}`, label: `term ${localSeq.current}` }; };
  const makePreset = (p: TerminalPreset): Session => { GLOBAL_SEQ += 1; return { id: `term-${GLOBAL_SEQ}`, label: p.label, command: p.command }; };
  const initial = (): Session[] => (presets.length ? presets.map(makePreset) : [make()]);

  const [sessions, setSessions] = useState<Session[]>(initial);
  const [activeId, setActiveId] = useState<string>(() => sessions[0]?.id ?? "");

  // New project → reset to fresh terminals (skip the initial mount).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    localSeq.current = 0;
    const s = initial();
    setSessions(s); setActiveId(s[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.localPath]);

  function addTab() { const s = make(); setSessions((p) => [...p, s]); setActiveId(s.id); }
  function closeTab(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeId) setActiveId(next[next.length - 1]?.id ?? "");
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full max-w-[840px] mx-auto w-full bg-surface-deep border border-[#2a2722] rounded-lg brutal-shadow-muted overflow-hidden">
      <div className="flex items-center gap-1 px-2 h-10 border-b border-[#2a2722] flex-shrink-0 overflow-x-auto no-scrollbar">
        <TerminalIcon className="w-3.5 h-3.5 text-[#3bd16f] flex-shrink-0 mr-1" />
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={`group flex items-center gap-1.5 px-2.5 h-7 font-mono text-[11px] border cursor-pointer flex-shrink-0 transition-colors ${s.id === activeId ? "bg-[#2a2722] border-[#3bd16f] text-[#cfe8cf]" : "border-[#2a2722] text-[#6b8a6b] hover:text-[#cfe8cf]"}`}
          >
            {s.label}
            <button onClick={(e) => { e.stopPropagation(); closeTab(s.id); }} className="opacity-50 hover:opacity-100" title="Close terminal"><X className="w-3 h-3" /></button>
          </div>
        ))}
        <button onClick={addTab} className="flex items-center justify-center w-7 h-7 border border-[#2a2722] text-[#6b8a6b] hover:text-[#3bd16f] hover:border-[#3bd16f] flex-shrink-0 transition-colors" title="New terminal"><Plus className="w-3.5 h-3.5" /></button>
        <span className="ml-auto font-mono text-[10px] text-[#6b8a6b] truncate max-w-[40%] pl-2 flex-shrink-0" title={project.localPath}>{project.name}</span>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {sessions.map((s) => (
          <div key={s.id} className="absolute inset-0" style={{ display: s.id === activeId ? "block" : "none" }}>
            <TerminalPanel cwd={project.localPath} active={s.id === activeId} bootCommand={s.command} />
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button onClick={addTab} className="font-mono text-xs text-[#6b8a6b] hover:text-[#3bd16f] border border-[#2a2722] hover:border-[#3bd16f] px-4 py-2 flex items-center gap-2 transition-colors"><Plus className="w-4 h-4" /> New terminal</button>
          </div>
        )}
      </div>
    </div>
  );
}
