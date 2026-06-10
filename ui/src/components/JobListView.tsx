import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus, Bot, Hand, Check, Play, RotateCcw, Loader2, ChevronDown, ChevronRight,
  ArrowUpRight, Trash2, Paperclip, Monitor,
} from "lucide-react";
import { toast } from "sonner";
import { useFactory, useJobs } from "@/lib/data";
import {
  createJob, addTask, patchJob, setAssignee, setTaskDone, queueJob, requeueJob,
  removeJob, removeJobCascade, trackCreate,
} from "@/lib/mutations";
import { uploadFiles } from "@/lib/api";
import { AttachmentPreview } from "./AttachmentPreview";
import type { Job } from "@/lib/types";

// A fully-formed local Job for an optimistic row — shown instantly, saved in the
// background. Carries the same id the server will use (client-provided), so the
// row never remounts when the create confirms.
function optimisticJob(id: string, projectId: string, parentJobId: string, priority: number, assignee: Job["assignee"], title: string, images: string[] = []): Job {
  return {
    id, projectId, title, prompt: title, images, status: "pending", kind: "task",
    parentJobId, priority, touchedPaths: [], blockedBy: [], assignee,
    worktreePath: "", branch: "", prUrl: "", prNumber: 0, error: "", sessionId: "",
    delegatorPlan: "", needsApproval: false, model: "", effort: "",
    inputTokens: 0, outputTokens: 0, costUsd: 0, mergedToMain: false,
    startedAt: 0, completedAt: 0, createdAt: Date.now(),
  };
}

const GAP = 1000;
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

// Shared row context so deeply-nested rows don't drill a dozen props.
interface RowCtx {
  childrenOf: (id: string) => Job[];
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  pendingFocusId: string | null;
  consumeFocus: () => void;
  onSelect: (id: string) => void;
  addSubtask: (job: Job) => void;
  addSibling: (job: Job) => void;
  deleteEmpty: (job: Job) => void;
  deleteRow: (job: Job) => void;
}

export function JobListView({ projectId, onSelectJob }: { projectId: string; onSelectJob: (id: string) => void }) {
  const { addJob, dropJob } = useFactory();
  const jobs = useJobs(projectId);
  const topLevel = jobs.filter((j) => !j.parentJobId).sort((a, b) => a.createdAt - b.createdAt);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const childrenOf = useCallback(
    (id: string) => jobs.filter((j) => j.parentJobId === id).sort((a, b) => a.priority - b.priority),
    [jobs],
  );

  function toggleGroup(key: string) {
    setCollapsed((c) => { const n = new Set(c); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  const toggleExpand = useCallback((id: string) => {
    setExpanded((e) => { const n = new Set(e); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  function priorityForAppend(parentId: string): number {
    const sibs = childrenOf(parentId);
    return sibs.length ? sibs[sibs.length - 1].priority + GAP : GAP;
  }

  // Create a row optimistically: it appears + focuses instantly, then saves in
  // the background. parentJobId null = a top-level task; otherwise a subtask.
  const createOptimistic = useCallback((
    parentJobId: string | null, priority: number,
    opts?: { title?: string; assignee?: Job["assignee"]; focus?: boolean; images?: string[] },
  ) => {
    const id = uid();
    const title = opts?.title ?? "";
    const assignee = opts?.assignee ?? "agent";
    const images = opts?.images ?? [];
    addJob(optimisticJob(id, projectId, parentJobId ?? "", priority, assignee, title, images));
    if (parentJobId) setExpanded((e) => new Set(e).add(parentJobId));
    if (opts?.focus !== false) setPendingFocusId(id);
    const req = parentJobId
      ? addTask(parentJobId, { localId: id, id, title, assignee, parentJobId, priority })
      : createJob({ id, projectId, title, prompt: title, kind: "task", images });
    trackCreate(id, req);
    req.catch(() => { dropJob(id); toast.error("Could not add the task"); });
    return id;
  }, [projectId, addJob, dropJob]);

  const addSubtask = useCallback((parent: Job) => {
    createOptimistic(parent.id, priorityForAppend(parent.id));
  }, [createOptimistic, childrenOf]);

  const addSibling = useCallback((sib: Job) => {
    const sibs = childrenOf(sib.parentJobId);
    const idx = sibs.findIndex((s) => s.id === sib.id);
    const cur = sibs[idx];
    const next = sibs[idx + 1];
    const priority = next ? Math.floor((cur.priority + next.priority) / 2) : cur.priority + GAP;
    createOptimistic(sib.parentJobId, priority, { assignee: sib.assignee || "agent" });
  }, [createOptimistic, childrenOf]);

  const deleteEmpty = useCallback(async (job: Job) => {
    if (childrenOf(job.id).length) return;
    const sibs = childrenOf(job.parentJobId);
    const idx = sibs.findIndex((s) => s.id === job.id);
    if (idx > 0) setPendingFocusId(sibs[idx - 1].id);
    else if (job.parentJobId) setPendingFocusId(job.parentJobId);
    await removeJob(job.id);
  }, [childrenOf]);

  const deleteRow = useCallback(async (job: Job) => {
    const kids = childrenOf(job.id).length;
    if (kids > 0) {
      if (!window.confirm(`Delete "${job.title || "this task"}" and its ${kids} subtask${kids === 1 ? "" : "s"}?`)) return;
      await removeJobCascade(job.id);
    } else {
      await removeJob(job.id);
    }
  }, [childrenOf]);

  const ctx: RowCtx = {
    childrenOf, expanded, toggleExpand,
    pendingFocusId, consumeFocus: () => setPendingFocusId(null),
    onSelect: onSelectJob, addSubtask, addSibling, deleteEmpty, deleteRow,
  };

  return (
    <div className="w-full border-4 border-ink bg-paper brutal-shadow">
      {GROUPS.map((g) => {
        const rows = topLevel.filter((j) => inGroup(j, g.key));
        const isOpen = !collapsed.has(g.key);
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
                {rows.map((job) => <JobRow key={job.id} job={job} depth={0} ctx={ctx} />)}
                {g.key === "pending" && <QuickAdd onAdd={(title, images) => createOptimistic(null, 50, { title, images, focus: false })} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuickAdd({ onAdd }: { onAdd: (title: string, images: string[]) => void }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const { images, skipped } = await uploadFiles(files);
    setAttachments((prev) => [...prev, ...images]);
    if (skipped.length) toast.error(`Too large to attach: ${skipped.join(", ")}`);
  }, []);

  const captureScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => requestAnimationFrame(r));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      track.stop();
      setAttachments((prev) => [...prev, canvas.toDataURL("image/png")]);
    } catch { /* cancelled */ }
  }, []);

  function add() {
    const title = text.trim();
    if (!title && attachments.length === 0) return;
    onAdd(title || "Untitled task", attachments); // optimistic — fires instantly
    setText("");
    setAttachments([]);
    inputRef.current?.focus();
  }

  return (
    <div
      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      onDragOver={(e) => e.preventDefault()}
    >
      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap px-4 pt-2">
          {attachments.map((src, i) => (
            <AttachmentPreview key={i} src={src} size={40} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Plus className="w-3.5 h-3.5 text-muted flex-shrink-0" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onPaste={(e) => { const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); addFiles(f); } }}
          placeholder="Add task — type, paste images, press Enter"
          className="flex-1 min-w-0 bg-transparent font-mono text-[13px] text-ink placeholder:text-muted focus:outline-none"
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <button className="p-1 text-muted hover:text-ink transition-colors" onClick={() => fileRef.current?.click()} title="Attach files"><Paperclip className="w-3.5 h-3.5" /></button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button className="p-1 text-muted hover:text-ink transition-colors" onClick={captureScreen} title="Screenshot"><Monitor className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, depth, ctx }: { job: Job; depth: number; ctx: RowCtx }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(job.title);
  const dirty = useRef(false);
  const isHuman = job.assignee === "human";
  const isDone = job.status === "completed";
  const kids = ctx.childrenOf(job.id);
  const hasKids = kids.length > 0;
  const open = ctx.expanded.has(job.id);

  const titleDebounce = useDebouncedCallback((v: string) => { patchJob(job.id, { title: v }); dirty.current = false; }, 300);
  useEffect(() => { if (!dirty.current) setDraft(job.title); }, [job.title]);

  useEffect(() => {
    if (ctx.pendingFocusId === job.id) {
      const el = inputRef.current;
      el?.focus();
      if (el) el.setSelectionRange(el.value.length, el.value.length);
      ctx.consumeFocus();
    }
  }, [ctx.pendingFocusId, job.id, ctx]);

  function onChange(v: string) { setDraft(v); dirty.current = true; titleDebounce.call(v); }
  function flush() { if (dirty.current) titleDebounce.flush(); }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && depth > 0) {
      e.preventDefault();
      flush();
      ctx.addSibling(job);
    } else if (e.key === "Backspace" && depth > 0 && draft === "" && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      ctx.deleteEmpty(job);
    }
  }

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
    <>
      <div className="group flex items-center gap-1.5 px-4 py-2" style={{ paddingLeft: 16 + depth * 22 }}>
        {hasKids ? (
          <button onClick={() => ctx.toggleExpand(job.id)} className="flex-shrink-0 text-muted hover:text-ink transition-colors" title={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          // ClickUp-style: a faint triangle on a leaf row creates a subtask.
          <button onClick={() => ctx.addSubtask(job)} className="flex-shrink-0 text-muted/40 hover:text-ink transition-colors" title="Create subtask">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        <StatusCircle job={job} isHuman={isHuman} isDone={isDone} onClick={onCircle} />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={flush}
          placeholder={depth === 0 ? "Task name…" : "Subtask name…"}
          className={`flex-1 min-w-0 bg-transparent font-mono text-[13px] focus:outline-none ${isDone ? "line-through text-muted" : "text-ink"}`}
        />
        {job.images.length > 0 && <span className="flex-shrink-0 font-data text-[9px] uppercase text-muted">{job.images.length} img</span>}
        {hasKids && <span className="flex-shrink-0 font-data text-[10px] text-muted">{kids.filter((k) => k.status === "completed").length}/{kids.length}</span>}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button onClick={() => setAssignee(job.id, isHuman ? "agent" : "human")} title={isHuman ? "Hand to the agent" : "Do it myself"} className="text-muted hover:text-ink transition-colors">
            {isHuman ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => ctx.addSubtask(job)} title="Add subtask" className="text-muted hover:text-ink transition-colors"><Plus className="w-4 h-4" /></button>
          <button onClick={() => ctx.onSelect(job.id)} title="Open" className="text-muted hover:text-ink transition-colors"><ArrowUpRight className="w-4 h-4" /></button>
          <button onClick={() => ctx.deleteRow(job)} title="Delete" className="text-muted hover:text-[#d6210f] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {open && kids.map((k) => <JobRow key={k.id} job={k} depth={depth + 1} ctx={ctx} />)}
    </>
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
