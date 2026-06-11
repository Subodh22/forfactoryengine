"use client";
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import {
  Plus, Trash2, Bot, Hand, ChevronDown, ChevronRight, ListTree, Check, Play,
  RotateCcw, LayoutGrid, List as ListIcon, Loader2, Flag,
} from "lucide-react";
import { toast } from "sonner";
import { useFactory, useDescendants } from "@/lib/data";
import {
  createJob, addTask, patchJob, setAssignee, setTaskDone, reparentTask, reorderTask,
  queueJob, requeueJob, removeJob, removeJobCascade, finishPlan,
} from "@/lib/mutations";
import type { Job } from "@/lib/types";
import { PlanBoard } from "@/components/PlanBoard";

// Sentinel that matches no job's parentJobId — keeps useDescendants("") from
// returning the whole project before a plan epic exists.
const NO_EPIC = "__no_epic__";
const GAP = 1000; // priority spacing so we can insert between rows without renumbering
const uid = () => crypto.randomUUID();

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

interface DisplayRow { job: Job; depth: number }

// Group the subtree by parent, sort each group by priority, and emit a
// pre-ordered (parent-before-children) list with a depth for indentation.
function buildRows(tasks: Job[], epicId: string): DisplayRow[] {
  const byParent = new Map<string, Job[]>();
  for (const j of tasks) {
    const arr = byParent.get(j.parentJobId);
    if (arr) arr.push(j); else byParent.set(j.parentJobId, [j]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.priority - b.priority);
  const rows: DisplayRow[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const j of byParent.get(parentId) ?? []) {
      rows.push({ job: j, depth });
      walk(j.id, depth + 1);
    }
  };
  walk(epicId, 0);
  return rows;
}

interface Props {
  projectId: string;
}

export function PlanBuilder({ projectId }: Props) {
  const { addJob } = useFactory();
  const [epicId, setEpicId] = useState<string | null>(null);
  const [planName, setPlanName] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const creatingRef = useRef<Promise<string> | null>(null);

  const tasks = useDescendants(epicId ?? NO_EPIC);
  const rows = useMemo(() => (epicId ? buildRows(tasks, epicId) : []), [tasks, epicId]);
  const doneCount = tasks.filter((t) => t.status === "completed").length;

  const nameDebounce = useDebouncedCallback((v: string) => {
    if (epicId) patchJob(epicId, { title: v.trim() || "Untitled plan" });
  }, 400);

  // Lazily create the manual epic on first task. Promise-shared so two fast
  // Enters can't create two epics.
  const ensureEpic = useCallback(async (): Promise<string> => {
    if (epicId) return epicId;
    if (creatingRef.current) return creatingRef.current;
    const name = planName.trim() || "Untitled plan";
    creatingRef.current = (async () => {
      const epic = await createJob({ projectId, title: name, prompt: name, kind: "epic", manual: true });
      addJob(epic);
      setEpicId(epic.id);
      return epic.id;
    })();
    return creatingRef.current;
  }, [epicId, planName, projectId, addJob]);

  function siblingsOf(parentId: string): Job[] {
    return tasks.filter((t) => t.parentJobId === parentId).sort((a, b) => a.priority - b.priority);
  }
  function priorityForAppend(parentId: string): number {
    const sibs = siblingsOf(parentId);
    return sibs.length ? sibs[sibs.length - 1].priority + GAP : GAP;
  }
  // Renumber a sibling group to 1×GAP, 2×GAP… and return the new local view.
  async function renormalize(parentId: string): Promise<Job[]> {
    const sibs = siblingsOf(parentId);
    await Promise.all(sibs.map((s, i) => reorderTask(s.id, (i + 1) * GAP)));
    return sibs.map((s, i) => ({ ...s, priority: (i + 1) * GAP }));
  }
  // Priority for a new row inserted right after `afterId` within `parentId`.
  async function priorityAfter(parentId: string, afterId: string | null): Promise<number> {
    let sibs = siblingsOf(parentId);
    const idx = afterId ? sibs.findIndex((s) => s.id === afterId) : sibs.length - 1;
    const cur = idx >= 0 ? sibs[idx] : null;
    let next = sibs[idx + 1];
    if (!cur) return GAP;
    if (!next) return cur.priority + GAP;
    if (next.priority - cur.priority >= 2) return Math.floor((cur.priority + next.priority) / 2);
    // Gap collapsed — renumber and recompute from the fresh values.
    sibs = await renormalize(parentId);
    const i2 = afterId ? sibs.findIndex((s) => s.id === afterId) : sibs.length - 1;
    const c2 = sibs[i2];
    next = sibs[i2 + 1];
    return next ? Math.floor((c2.priority + next.priority) / 2) : c2.priority + GAP;
  }

  const newTask = useCallback(async (parentId: string, priority: number, assignee: Job["assignee"]) => {
    const eid = await ensureEpic();
    const realParent = parentId === NO_EPIC ? eid : parentId;
    const job = await addTask(eid, {
      localId: uid(), title: "", assignee: assignee || "agent", parentJobId: realParent, priority,
    });
    if (job) { addJob(job); setPendingFocusId(job.id); }
    return job;
  }, [ensureEpic, addJob]);

  // Enter on a row → insert a sibling right after it.
  const addAfter = useCallback(async (job: Job) => {
    const parentId = job.parentJobId || epicId || NO_EPIC;
    const priority = await priorityAfter(parentId, job.id);
    await newTask(parentId, priority, job.assignee);
  }, [epicId, newTask, tasks]);

  // Bottom "add task" row → append a top-level task.
  const addTopLevel = useCallback(async () => {
    const eid = await ensureEpic();
    await newTask(eid, priorityForAppend(eid), "agent");
  }, [ensureEpic, newTask, tasks]);

  const addChild = useCallback(async (job: Job) => {
    await newTask(job.id, priorityForAppend(job.id), "agent");
  }, [newTask, tasks]);

  // Tab → indent under the immediately-preceding sibling.
  const indent = useCallback(async (job: Job) => {
    if (job.status === "running" || job.status === "queued") return;
    const sibs = siblingsOf(job.parentJobId);
    const idx = sibs.findIndex((s) => s.id === job.id);
    if (idx <= 0) return; // first child can't indent
    const prev = sibs[idx - 1];
    await reparentTask(job.id, prev.id, priorityForAppend(prev.id));
  }, [tasks]);

  // Shift+Tab → outdent to the grandparent, just after the old parent.
  const outdent = useCallback(async (job: Job) => {
    if (job.status === "running" || job.status === "queued") return;
    if (!epicId || job.parentJobId === epicId) return; // already top-level
    const parent = tasks.find((t) => t.id === job.parentJobId);
    if (!parent) return;
    const grandparent = parent.parentJobId || epicId;
    const priority = await priorityAfter(grandparent, parent.id);
    await reparentTask(job.id, grandparent, priority);
  }, [epicId, tasks]);

  // Backspace on an empty leaf → delete it, focus the previous row.
  const deleteLeaf = useCallback(async (job: Job) => {
    const hasChildren = tasks.some((t) => t.parentJobId === job.id);
    if (hasChildren) return;
    const i = rows.findIndex((r) => r.job.id === job.id);
    if (i > 0) setPendingFocusId(rows[i - 1].job.id);
    await removeJob(job.id);
  }, [tasks, rows]);

  const deleteRow = useCallback(async (job: Job) => {
    const descendants = tasks.filter((t) => t.parentJobId === job.id).length;
    if (descendants > 0) {
      if (!window.confirm(`Delete "${job.title || "this task"}" and its ${descendants} subtask${descendants === 1 ? "" : "s"}?`)) return;
      await removeJobCascade(job.id);
    } else {
      await removeJob(job.id);
    }
  }, [tasks]);

  async function onFinish() {
    if (!epicId || finishing) return;
    setFinishing(true);
    try {
      await finishPlan(epicId);
      toast.success("Plan finished");
    } catch {
      toast.error("Could not finish the plan");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="bg-paper border-4 border-ink brutal-shadow grid-bg">
      <div className="flex justify-between items-center px-5 py-4 border-b-4 border-ink bg-paper gap-3">
        <b className="font-display uppercase text-[15px] flex items-center gap-2"><ListTree className="w-4 h-4" /> Plan it yourself</b>
        <div className="flex items-center gap-3">
          <span className="font-data text-[10px] uppercase text-muted">{doneCount}/{tasks.length} done</span>
          <div className="flex border-2 border-ink">
            <button
              onClick={() => setView("list")}
              className={`font-data text-[10px] px-2 py-1 uppercase flex items-center gap-1 transition-colors ${view === "list" ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-concrete"}`}
            ><ListIcon className="w-3 h-3" /> List</button>
            <button
              onClick={() => setView("board")}
              className={`font-data text-[10px] px-2 py-1 uppercase flex items-center gap-1 border-l-2 border-ink transition-colors ${view === "board" ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-concrete"}`}
            ><LayoutGrid className="w-3 h-3" /> Board</button>
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-b-4 border-ink bg-paper">
        <input
          value={planName}
          onChange={(e) => { setPlanName(e.target.value); nameDebounce.call(e.target.value); }}
          placeholder="Plan name — e.g. “Ship the billing page”"
          className="w-full border-[3px] border-ink bg-concrete px-3 py-2 font-mono text-[14px] text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]"
        />
      </div>

      {view === "board" ? (
        <div className="p-3 bg-paper min-h-[40vh]">
          {epicId
            ? <PlanBoard epicId={epicId} />
            : <p className="font-data text-[10px] uppercase text-muted p-4">Add a task to start the board.</p>}
        </div>
      ) : (
        <div className="p-3 bg-paper max-h-[55vh] overflow-y-auto">
          {rows.map((r) => (
            <TaskRow
              key={r.job.id}
              job={r.job}
              depth={r.depth}
              hasChildren={tasks.some((t) => t.parentJobId === r.job.id)}
              pendingFocusId={pendingFocusId}
              onFocusConsumed={() => setPendingFocusId(null)}
              onEnter={addAfter}
              onIndent={indent}
              onOutdent={outdent}
              onBackspaceEmpty={deleteLeaf}
              onAddChild={addChild}
              onDelete={deleteRow}
            />
          ))}
          <button
            onClick={addTopLevel}
            className="mt-1 w-full text-left font-data text-[11px] uppercase flex items-center gap-1.5 text-muted hover:text-ink transition-colors px-1.5 py-2 border-2 border-dashed border-ink/30 hover:border-ink"
          >
            <Plus className="w-3.5 h-3.5" /> Add task
          </button>
        </div>
      )}

      <div className="flex justify-between items-center px-5 py-4 border-t-4 border-ink bg-paper gap-3">
        <p className="font-data text-[10px] uppercase text-muted">
          <Bot className="w-3 h-3 inline mb-0.5" /> agent runs it · <Hand className="w-3 h-3 inline mb-0.5" /> you tick it off · ⏎ next · ⇥ indent
        </p>
        <button
          onClick={onFinish}
          disabled={!epicId || finishing}
          className="font-display uppercase text-[13px] bg-ink text-paper px-6 py-2.5 inline-flex items-center gap-2 brutal-press disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          <Flag className="w-3.5 h-3.5" /> {finishing ? "Finishing…" : "Finish plan"}
        </button>
      </div>
    </div>
  );
}

// ── Single task row ──────────────────────────────────────────────────────────
function TaskRow({
  job, depth, hasChildren, pendingFocusId, onFocusConsumed,
  onEnter, onIndent, onOutdent, onBackspaceEmpty, onAddChild, onDelete,
}: {
  job: Job; depth: number; hasChildren: boolean;
  pendingFocusId: string | null; onFocusConsumed: () => void;
  onEnter: (j: Job) => void; onIndent: (j: Job) => void; onOutdent: (j: Job) => void;
  onBackspaceEmpty: (j: Job) => void; onAddChild: (j: Job) => void; onDelete: (j: Job) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(job.title);
  const dirty = useRef(false);
  const isHuman = job.assignee === "human";
  const isDone = job.status === "completed";

  const titleDebounce = useDebouncedCallback((v: string) => {
    patchJob(job.id, { title: v });
    dirty.current = false;
  }, 300);
  const promptDebounce = useDebouncedCallback((v: string) => patchJob(job.id, { prompt: v }), 300);

  // Adopt server value only when the user isn't mid-edit (avoids cursor jumps).
  useEffect(() => { if (!dirty.current) setDraft(job.title); }, [job.title]);

  // Focus this row when it's the freshly-created / post-delete target.
  useEffect(() => {
    if (pendingFocusId === job.id) {
      const el = inputRef.current;
      el?.focus();
      if (el) el.setSelectionRange(el.value.length, el.value.length);
      onFocusConsumed();
    }
  }, [pendingFocusId, job.id, onFocusConsumed]);

  function flushTitle() {
    if (dirty.current) { titleDebounce.flush(); }
  }

  function onChange(v: string) {
    setDraft(v);
    dirty.current = true;
    titleDebounce.call(v);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      flushTitle();
      onEnter(job);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      onIndent(job);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onOutdent(job);
    } else if (e.key === "Backspace" && draft === "" && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      onBackspaceEmpty(job);
    }
  }

  function onCircleClick() {
    if (isHuman) { setTaskDone(job.id, !isDone); return; }
    // Agent task: circle drives the run lifecycle.
    if (isDone) { setTaskDone(job.id, false); return; }       // reopen
    if (job.status === "failed") { requeueJob(job.id); return; } // retry
    if (job.status === "pending") {
      if (!draft.trim()) { toast.error("Name the task first"); return; }
      queueJob(job.id); // run it
    }
    // queued/running/waiting → no-op
  }

  return (
    <div className="group">
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 22 }}>
        <StatusCircle job={job} isHuman={isHuman} isDone={isDone} onClick={onCircleClick} />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={flushTitle}
          placeholder={depth === 0 ? "Task name…" : "Subtask name…"}
          className={`flex-1 min-w-0 border-2 border-ink bg-concrete px-2 py-1.5 font-mono text-[13px] placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)] ${isDone ? "line-through text-muted" : "text-ink"}`}
        />
        {/* Hover row actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={() => setAssignee(job.id, isHuman ? "agent" : "human")}
            title={isHuman ? "Hand to the agent" : "Do it myself"}
            className="flex-shrink-0 text-muted hover:text-ink transition-colors"
          >{isHuman ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}</button>
          <button onClick={() => setOpen((o) => !o)} title="Details" className="flex-shrink-0 text-muted hover:text-ink transition-colors">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button onClick={() => onAddChild(job)} title="Add subtask" className="flex-shrink-0 text-muted hover:text-ink transition-colors"><Plus className="w-4 h-4" /></button>
          <button onClick={() => onDelete(job)} title="Delete" className="flex-shrink-0 text-muted hover:text-[#d6210f] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        {hasChildren && !open && <span className="flex-shrink-0 font-data text-[9px] text-muted">▾</span>}
      </div>

      {open && (
        <div className="py-1" style={{ paddingLeft: depth * 22 + 32 }}>
          <textarea
            defaultValue={job.prompt === job.title ? "" : job.prompt}
            onChange={(e) => promptDebounce.call(e.target.value)}
            onBlur={() => promptDebounce.flush()}
            placeholder={isHuman ? "Notes (optional)…" : "Instructions for the agent (optional — defaults to the task name)…"}
            className="w-full min-h-[60px] resize-y border-2 border-ink bg-concrete px-2 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]"
          />
        </div>
      )}
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

  return (
    <button onClick={onClick} title={title} className={`${base} ${cls}`}>{inner}</button>
  );
}
