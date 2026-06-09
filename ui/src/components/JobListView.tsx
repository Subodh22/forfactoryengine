import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus, Bot, Hand, Check, Play, RotateCcw, Loader2, ChevronDown, ChevronRight, ArrowUpRight, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useFactory, useJobs } from "@/lib/data";
import { createJob, patchJob, setAssignee, setTaskDone, queueJob, requeueJob, removeJob } from "@/lib/mutations";
import type { Job } from "@/lib/types";

// ── Debounced callback (no lodash) ───────────────────────────────────────────
function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const pending = useRef<A | null>(null);
  const call = useCallback((...args: A) => {
    pending.current = args;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const a = pending.current;
      pending.current = null;
      if (a) fnRef.current(...a);
    }, ms);
  }, [ms]);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) { const a = pending.current; pending.current = null; fnRef.current(...a); }
  }, []);
  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return { call, flush, cancel };
}

// Status groups, ClickUp-style. "running" folds in delegating.
const GROUPS = [
  { key: "pending", label: "To Do", dot: "#6b675f" },
  { key: "queued", label: "Queued", dot: "#b8860b" },
  { key: "running", label: "In Progress", dot: "#1f7a3d" },
  { key: "waiting_for_input", label: "Needs Reply", dot: "#d97706" },
  { key: "completed", label: "Done", dot: "#1f7a3d" },
  { key: "failed", label: "Failed", dot: "#d6210f" },
] as const;

function inGroup(job: Job, key: string): boolean {
  if (key === "running") return job.status === "running" || job.status === "delegating";
  return job.status === key;
}

export function JobListView({ projectId, onSelectJob }: { projectId: string; onSelectJob: (id: string) => void }) {
  const { addJob } = useFactory();
  const jobs = useJobs(projectId);
  const topLevel = jobs.filter((j) => !j.parentJobId).sort((a, b) => a.createdAt - b.createdAt);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setCollapsed((c) => {
      const next = new Set(c);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="w-full border-4 border-ink bg-paper brutal-shadow">
      {GROUPS.map((g) => {
        const rows = topLevel.filter((j) => inGroup(j, g.key));
        const isOpen = !collapsed.has(g.key);
        // Hide empty non-actionable groups, but always keep To Do (for quick add).
        if (rows.length === 0 && g.key !== "pending") return null;
        return (
          <div key={g.key} className="border-b-2 border-ink/15 last:border-b-0">
            <button
              onClick={() => toggleGroup(g.key)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-concrete hover:bg-concrete/70 transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-muted" />}
              <span className="w-2 h-2" style={{ backgroundColor: g.dot }} />
              <span className="font-display uppercase text-[12px] text-ink">{g.label}</span>
              <span className="font-data text-[11px] text-muted">{rows.length}</span>
            </button>

            {isOpen && (
              <div className="divide-y divide-ink/10">
                {rows.map((job) => (
                  <JobRow key={job.id} job={job} onSelect={onSelectJob} />
                ))}
                {g.key === "pending" && <QuickAdd projectId={projectId} onAdded={addJob} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuickAdd({ projectId, onAdded }: { projectId: string; onAdded: (j: Job) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function add() {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const job = await createJob({ projectId, title, prompt: title, kind: "task" });
      onAdded(job);
      setText("");
      inputRef.current?.focus();
    } catch {
      toast.error("Could not add the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <Plus className="w-3.5 h-3.5 text-muted flex-shrink-0" />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        placeholder="Add task — type and press Enter"
        className="flex-1 min-w-0 bg-transparent font-mono text-[13px] text-ink placeholder:text-muted focus:outline-none"
      />
    </div>
  );
}

function JobRow({ job, onSelect }: { job: Job; onSelect: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(job.title);
  const dirty = useRef(false);
  const isHuman = job.assignee === "human";
  const isDone = job.status === "completed";

  const titleDebounce = useDebouncedCallback((v: string) => { patchJob(job.id, { title: v }); dirty.current = false; }, 300);
  useEffect(() => { if (!dirty.current) setDraft(job.title); }, [job.title]);

  function onChange(v: string) { setDraft(v); dirty.current = true; titleDebounce.call(v); }
  function flush() { if (dirty.current) titleDebounce.flush(); }

  function onCircle() {
    if (isHuman) { setTaskDone(job.id, !isDone); return; }
    if (isDone) { setTaskDone(job.id, false); return; }
    if (job.status === "failed") { requeueJob(job.id); return; }
    if (job.status === "pending") {
      if (!draft.trim()) { toast.error("Name the task first"); return; }
      queueJob(job.id);
    }
  }

  return (
    <div className="group flex items-center gap-2 px-4 py-2">
      <StatusCircle job={job} isHuman={isHuman} isDone={isDone} onClick={onCircle} />
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
        placeholder="Task name…"
        className={`flex-1 min-w-0 bg-transparent font-mono text-[13px] focus:outline-none ${isDone ? "line-through text-muted" : "text-ink"}`}
      />
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={() => setAssignee(job.id, isHuman ? "agent" : "human")} title={isHuman ? "Hand to the agent" : "Do it myself"} className="text-muted hover:text-ink transition-colors">
          {isHuman ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => onSelect(job.id)} title="Open" className="text-muted hover:text-ink transition-colors"><ArrowUpRight className="w-4 h-4" /></button>
        <button onClick={() => removeJob(job.id)} title="Delete" className="text-muted hover:text-[#d6210f] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

function StatusCircle({ job, isHuman, isDone, onClick }: { job: Job; isHuman: boolean; isDone: boolean; onClick: () => void }) {
  const running = job.status === "running" || job.status === "queued" || job.status === "delegating";
  const failed = job.status === "failed";
  const base = "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors";
  let inner: React.ReactNode = null;
  let cls = "border-ink bg-paper hover:bg-concrete";
  let title = isHuman ? "Mark done" : "Run task";
  if (isDone) { cls = "border-ink bg-ink text-paper"; inner = <Check className="w-3 h-3" />; title = "Done — click to reopen"; }
  else if (running) { cls = "border-ink bg-paper text-ink"; inner = <Loader2 className="w-3 h-3 animate-spin" />; title = "Running…"; }
  else if (failed) { cls = "border-[#d6210f] bg-paper text-[#d6210f]"; inner = <RotateCcw className="w-3 h-3" />; title = "Failed — click to retry"; }
  else if (!isHuman) { inner = <Play className="w-2.5 h-2.5 text-muted" />; }
  return <button onClick={onClick} title={title} className={`${base} ${cls}`}>{inner}</button>;
}
