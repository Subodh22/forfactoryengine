"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, GitBranch, RotateCcw, Send, Bot, Hand, Play, Check } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useChildren, useDescendants, useJobOutput } from "@/lib/data";
import { requeueJob, sendReply, queueJob, setTaskDone, setAssignee } from "@/lib/mutations";
import type { Job } from "@/lib/types";

function cleanLine(raw: string): string {
  if (raw.startsWith("\x00tool\x00")) return raw.slice(7);
  if (raw.startsWith("\x00bash\x00")) return "$ " + raw.slice(7);
  if (raw.startsWith("\x00stderr\x00")) return raw.slice(9);
  return raw;
}

export function DelegatorPanel({ epicId }: { epicId: string }) {
  const children = useChildren(epicId);
  const all = useDescendants(epicId);

  if (children.length === 0) {
    return <div className="p-4 font-data text-[10px] uppercase text-muted">No tasks yet — subtasks will appear here.</div>;
  }

  const titleById = new Map(all.map((c) => [c.id, c.title]));
  const done = all.filter((c) => c.status === "completed").length;

  return (
    <div className="border-t-4 border-ink bg-concrete flex-shrink-0 max-h-[60vh] overflow-y-auto">
      <div className="px-4 py-2 border-b-2 border-ink flex items-center justify-between sticky top-0 bg-concrete z-10">
        <span className="font-data text-[10px] text-muted tracking-widest uppercase">Tasks</span>
        <span className="font-data text-[10px] text-ink font-bold">{done}/{all.length} done</span>
      </div>
      <div className="divide-y-2 divide-ink/20">
        {children.map((c) => <ChildRow key={c.id} child={c} titleById={titleById} depth={0} />)}
      </div>
    </div>
  );
}

function ChildRow({ child, titleById, depth }: { child: Job; titleById: Map<string, string>; depth: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const subChildren = useChildren(child.id);
  const deps = child.blockedBy.map((id) => titleById.get(id)).filter(Boolean) as string[];
  const active = child.status === "running" || child.status === "waiting_for_input";
  const isHuman = child.assignee === "human";
  const isDone = child.status === "completed";
  const canFlip = child.status === "pending";

  async function guard(fn: () => Promise<unknown>, ok?: string) {
    if (busy) return;
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); }
    catch { toast.error("Could not reach the engine"); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="px-4 py-3" style={{ paddingLeft: 16 + depth * 20 }}>
        <div className="flex items-start gap-2">
          <button onClick={() => setOpen((o) => !o)} className="mt-0.5 text-muted hover:text-ink transition-colors flex-shrink-0" title={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {/* Assignee / completion control */}
          {isHuman ? (
            <button
              onClick={() => guard(() => setTaskDone(child.id, !isDone))}
              title={isDone ? "Done — click to reopen" : "Mark done"}
              className={`mt-0.5 flex-shrink-0 w-4 h-4 border-2 border-ink flex items-center justify-center transition-colors ${isDone ? "bg-ink text-paper" : "bg-paper hover:bg-concrete"}`}
            >
              {isDone && <Check className="w-3 h-3" />}
            </button>
          ) : (
            <span className="mt-0.5 flex-shrink-0 text-muted" title="Agent task"><Bot className="w-4 h-4" /></span>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold leading-snug ${isHuman && isDone ? "text-muted line-through" : "text-ink"}`}>{child.title}</span>
              {!isHuman && <StatusBadge status={child.status} />}

              {/* Reassign between agent / me (only before it starts) */}
              {canFlip && (
                <button
                  onClick={() => guard(() => setAssignee(child.id, isHuman ? "agent" : "human"))}
                  title={isHuman ? "Hand to the agent" : "Do it myself"}
                  className="flex items-center gap-1 px-1.5 py-0.5 font-data text-[9px] uppercase border border-ink/40 text-muted hover:bg-ink hover:text-paper hover:border-ink transition-colors"
                >
                  {isHuman ? <Bot className="w-2.5 h-2.5" /> : <Hand className="w-2.5 h-2.5" />}
                  {isHuman ? "To agent" : "To me"}
                </button>
              )}

              {/* Run an agent task */}
              {!isHuman && child.status === "pending" && (
                <button onClick={() => guard(() => queueJob(child.id), "Running task")} disabled={busy} className="flex items-center gap-1 px-1.5 py-0.5 font-data text-[10px] uppercase border-2 border-ink bg-ink text-paper hover:opacity-80 transition-opacity disabled:opacity-40" title="Run this task now">
                  <Play className="w-2.5 h-2.5" /> Run
                </button>
              )}
              {!isHuman && child.status === "failed" && (
                <button onClick={() => guard(() => requeueJob(child.id), "Retrying task")} disabled={busy} className="flex items-center gap-1 px-1.5 py-0.5 font-data text-[10px] uppercase border-2 border-[#d6210f] text-[#d6210f] hover:bg-[#d6210f] hover:text-concrete transition-colors disabled:opacity-40" title="Re-run this task">
                  <RotateCcw className="w-2.5 h-2.5" /> Retry
                </button>
              )}
            </div>
            {deps.length > 0 && <p className="font-data text-[9px] uppercase text-muted mt-1">after: {deps.join(", ")}</p>}
            {child.touchedPaths.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {child.touchedPaths.slice(0, 6).map((p, i) => (
                  <span key={i} className="font-data text-[9px] text-ink/70 border border-ink/30 px-1 inline-flex items-center gap-0.5"><GitBranch className="w-2 h-2" />{p}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {open && (
          <div className="mt-2 ml-5">
            {child.prompt && <p className="font-mono text-[11px] text-ink/80 whitespace-pre-wrap mb-2">{child.prompt}</p>}
            {child.error && <pre className="text-[10px] text-[#a8190b] font-mono whitespace-pre-wrap border-2 border-[#d6210f]/40 bg-[#d6210f]/10 p-2 mb-2">{child.error}</pre>}
            {!isHuman && active && <ChildTerminal jobId={child.id} waiting={child.status === "waiting_for_input"} />}
            {!isHuman && !active && !child.prompt && (
              <p className="font-data text-[10px] text-muted uppercase">{child.status === "pending" ? "Not started — click Run." : "No live output."}</p>
            )}
          </div>
        )}
      </div>

      {subChildren.map((sc) => (
        <ChildRow key={sc.id} child={sc} titleById={titleById} depth={depth + 1} />
      ))}
    </div>
  );
}

function ChildTerminal({ jobId, waiting }: { jobId: string; waiting: boolean }) {
  const output = useJobOutput(jobId, true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [output]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    const text = reply.trim();
    setReply("");
    try { await sendReply(jobId, text, []); }
    catch { toast.error("Could not reach the engine"); }
    finally { setSending(false); }
  }

  return (
    <div>
      <div className="bg-ink p-2 max-h-40 overflow-y-auto">
        {output ? (
          <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed text-[#cfe8cf]">
            {output.split("\n").map((raw, i) => (raw ? <span key={i}>{cleanLine(raw)}{"\n"}</span> : <span key={i}>{"\n"}</span>))}
          </pre>
        ) : (
          <p className="text-[10px] text-[#6b8a6b] italic font-mono">streaming…</p>
        )}
        <div ref={bottomRef} />
      </div>
      {waiting && (
        <form onSubmit={send} className="flex gap-2 mt-2">
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to this subtask…" className="flex-1 bg-paper border-2 border-ink px-2 py-1.5 font-mono text-[11px] text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]" autoFocus />
          <button type="submit" disabled={!reply.trim() || sending} className="px-2 py-1.5 bg-ink text-concrete border-2 border-ink disabled:opacity-40 font-data text-[10px] uppercase flex items-center gap-1 brutal-press"><Send className="w-3 h-3" /> {sending ? "…" : "Send"}</button>
        </form>
      )}
    </div>
  );
}
