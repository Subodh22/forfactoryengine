"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Job, Project } from "@/lib/types";

// ⌘K / Ctrl+K palette: fuzzy-jump to any project or job, or fire a quick
// action. Everything it searches is already client-side (FactoryProvider),
// so there is no backend round-trip. Hand-rolled — no cmdk dependency.

interface Props {
  projects: Project[];
  jobs: Job[];
  onSelectProject: (id: string | null) => void;
  onSelectJob: (job: Job) => void;
  onSetTab: (tab: string) => void;
}

interface Item {
  id: string;
  kind: "action" | "project" | "job";
  label: string;
  hint: string;
  run: () => void;
}

/** Every whitespace-separated query word must appear somewhere in the text. */
function matches(query: string, text: string): boolean {
  const t = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

/** Dispatch this from anywhere (e.g. a header button) to open the palette. */
export const OPEN_PALETTE_EVENT = "factory:palette";

export function CommandPalette({ projects, jobs, onSelectProject, onSelectJob, onSetTab }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setIndex(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpenEvent = () => { setOpen(true); setQuery(""); setIndex(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const close = () => setOpen(false);
    const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";

    const actions: Item[] = [
      { id: "tab-board", kind: "action", label: "Go to Kanban Board", hint: "view", run: () => { onSetTab("board"); close(); } },
      { id: "tab-agents", kind: "action", label: "Go to Agents", hint: "view", run: () => { onSetTab("agents"); close(); } },
      { id: "tab-chat", kind: "action", label: "New Job", hint: "create", run: () => { onSetTab("chat"); close(); } },
      { id: "tab-create", kind: "action", label: "Create Project", hint: "create", run: () => { onSetTab("create"); close(); } },
      { id: "tab-env", kind: "action", label: "Edit .env", hint: "view", run: () => { onSetTab("env"); close(); } },
      { id: "tab-terminal", kind: "action", label: "Open Terminal", hint: "view", run: () => { onSetTab("terminal"); close(); } },
      { id: "all-projects", kind: "action", label: "All Projects", hint: "filter", run: () => { onSelectProject(null); close(); } },
    ];
    const projectItems: Item[] = projects.map((p) => ({
      id: `p-${p.id}`, kind: "project", label: p.name, hint: "project",
      run: () => { onSelectProject(p.id); close(); },
    }));
    const jobItems: Item[] = jobs.map((j) => ({
      id: `j-${j.id}`, kind: "job", label: j.title,
      hint: `${j.status}${projectName(j.projectId) ? ` · ${projectName(j.projectId)}` : ""}`,
      run: () => { onSelectJob(j); close(); },
    }));

    const all = [...actions, ...projectItems, ...jobItems];
    const filtered = query.trim()
      ? all.filter((i) => matches(query, `${i.label} ${i.hint}`))
      : all;
    return filtered.slice(0, 40);
  }, [open, query, projects, jobs, onSelectProject, onSelectJob, onSetTab]);

  useEffect(() => { setIndex(0); }, [query]);

  if (!open) return null;

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); items[index]?.run(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-[560px] max-w-[92vw] bg-concrete border border-[#332f28] brutal-shadow flex flex-col max-h-[60vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-[#332f28] bg-paper">
          <Search className="w-4 h-4 text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Jump to a job or project, or run a command…"
            className="flex-1 bg-transparent py-3 font-mono text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <span className="font-data text-[10px] uppercase text-muted flex-shrink-0">esc</span>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <p className="px-4 py-6 font-data text-[11px] uppercase text-muted">No matches</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={item.run}
              onMouseEnter={() => setIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-[#332f28]/10 transition-colors ${i === index ? "bg-ink text-concrete" : "bg-concrete text-ink"}`}
            >
              <span className="font-mono text-xs truncate flex-1">{item.label}</span>
              <span className={`font-data text-[10px] uppercase flex-shrink-0 ${i === index ? "text-concrete/70" : "text-muted"}`}>{item.hint}</span>
            </button>
          ))}
        </div>
        <div className="px-3 py-1.5 border-t border-[#332f28]/20 font-data text-[10px] uppercase text-muted flex gap-3">
          <span>↑↓ navigate</span><span>↵ open</span><span>⌘K toggle</span>
        </div>
      </div>
    </div>
  );
}
