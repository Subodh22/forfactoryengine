"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Play, Square, Check } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useJobs } from "@/lib/data";
import { createJob, setJobStatus, queueJob } from "@/lib/mutations";
import type { Job } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  projectId?: string;
  onSelectJob: (id: string) => void;
}

const STATUS_DOTS: Record<string, string> = {
  pending: "#6b675f",
  queued: "#b8860b",
  running: "#1f7a3d",
  waiting_for_input: "#d97706",
  completed: "#1f7a3d",
  failed: "#d6210f",
  cancelled: "#6b675f",
  delegating: "#1f7a3d",
};

export function TaskListView({ projectId, onSelectJob }: Props) {
  const allJobs = useJobs(projectId);

  const topLevel = allJobs.filter((j) => !j.parentJobId);
  const childrenMap = new Map<string, Job[]>();
  for (const j of allJobs) {
    if (!j.parentJobId) continue;
    const list = childrenMap.get(j.parentJobId) ?? [];
    list.push(j);
    childrenMap.set(j.parentJobId, list);
  }
  // Sort children by priority
  for (const [, kids] of childrenMap) {
    kids.sort((a, b) => a.priority - b.priority);
  }

  // Sort top-level: pending first, then by createdAt desc
  const sorted = [...topLevel].sort((a, b) => {
    const aActive = a.status !== "completed" && a.status !== "cancelled" ? 0 : 1;
    const bActive = b.status !== "completed" && b.status !== "cancelled" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.createdAt - a.createdAt;
  });

  return (
    <div className="w-full border-4 border-ink bg-concrete brutal-shadow">
      <div className="flex items-center justify-between px-4 py-3 border-b-4 border-ink bg-ink text-concrete">
        <span className="font-display uppercase text-[13px] tracking-wide">Tasks</span>
        <span className="font-data text-[12px]">{topLevel.length} tasks</span>
      </div>
      <div className="divide-y-2 divide-ink/20">
        {sorted.map((job) => (
          <TaskRow
            key={job.id}
            job={job}
            depth={0}
            childrenMap={childrenMap}
            onSelectJob={onSelectJob}
          />
        ))}
        {sorted.length === 0 && (
          <div className="p-8 text-center font-data text-[10px] uppercase text-muted">
            No tasks yet
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  job,
  depth,
  childrenMap,
  onSelectJob,
}: {
  job: Job;
  depth: number;
  childrenMap: Map<string, Job[]>;
  onSelectJob: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const children = childrenMap.get(job.id) ?? [];
  const hasChildren = children.length > 0;
  const doneCount = children.filter((c) => c.status === "completed").length;
  const isDone = job.status === "completed";
  const isPending = job.status === "pending";

  async function toggleDone() {
    try {
      if (isDone) {
        await setJobStatus(job.id, "pending");
      } else {
        await setJobStatus(job.id, "completed");
      }
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function runJob() {
    try {
      await queueJob(job.id);
      toast.success("Queued for Claude");
    } catch {
      toast.error("Failed to queue");
    }
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createJob({
        projectId: job.projectId,
        title: newTitle.trim(),
        prompt: newTitle.trim(),
        parentJobId: job.id,
      });
      setNewTitle("");
      setAdding(false);
      setExpanded(true);
    } catch {
      toast.error("Failed to create subtask");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-2.5 hover:bg-concrete-2 transition-colors group"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded((o) => !o)}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted hover:text-ink transition-colors"
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Checkbox */}
        <button
          onClick={toggleDone}
          className={`w-4 h-4 border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            isDone
              ? "border-[#1f7a3d] bg-[#1f7a3d] text-concrete"
              : "border-ink hover:border-[#1f7a3d]"
          }`}
          title={isDone ? "Mark incomplete" : "Mark complete"}
        >
          {isDone && <Check className="w-3 h-3" />}
        </button>

        {/* Status dot */}
        <span
          className={`w-2 h-2 flex-shrink-0 ${job.status === "running" || job.status === "delegating" ? "animate-pulse" : ""}`}
          style={{ backgroundColor: STATUS_DOTS[job.status] ?? "#6b675f" }}
        />

        {/* Title — clickable */}
        <button
          onClick={() => onSelectJob(job.id)}
          className={`flex-1 text-left text-xs font-bold truncate ${isDone ? "line-through text-muted" : "text-ink"}`}
          title={job.title}
        >
          {job.title}
        </button>

        {/* Child progress badge */}
        {hasChildren && (
          <span className="font-data text-[9px] uppercase text-muted flex-shrink-0">
            {doneCount}/{children.length}
          </span>
        )}

        {/* Status badge */}
        <div className="flex-shrink-0">
          <StatusBadge status={job.status} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {isPending && (
            <button
              onClick={runJob}
              className="w-5 h-5 flex items-center justify-center border border-ink hover:bg-ink hover:text-concrete transition-colors"
              title="Assign to Claude"
            >
              <Play className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setAdding(true); setExpanded(true); }}
            className="w-5 h-5 flex items-center justify-center border border-ink hover:bg-ink hover:text-concrete transition-colors"
            title="Add subtask"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Inline add subtask form */}
      {adding && (
        <form
          onSubmit={addSubtask}
          className="flex items-center gap-2 px-4 py-2 bg-paper border-t border-ink/10"
          style={{ paddingLeft: `${16 + (depth + 1) * 24}px` }}
        >
          <span className="w-4" />
          <Square className="w-3 h-3 text-muted flex-shrink-0" />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Subtask title…"
            autoFocus
            className="flex-1 bg-transparent border-b-2 border-ink px-1 py-0.5 font-data text-[11px] text-ink placeholder:text-muted focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setNewTitle(""); } }}
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || submitting}
            className="font-data text-[10px] uppercase px-2 py-0.5 bg-ink text-concrete border border-ink disabled:opacity-40 brutal-press"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewTitle(""); }}
            className="font-data text-[10px] uppercase px-2 py-0.5 border border-ink text-ink hover:bg-ink hover:text-concrete transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Children */}
      {expanded && children.map((child) => (
        <TaskRow
          key={child.id}
          job={child}
          depth={depth + 1}
          childrenMap={childrenMap}
          onSelectJob={onSelectJob}
        />
      ))}
    </div>
  );
}
