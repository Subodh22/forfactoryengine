"use client";
import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { ExternalLink, X, Play, GitBranch, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { Job } from "@/lib/types";
import { queueJob, cancelJob, cancelEpic, createJob } from "@/lib/mutations";

export function JobCard({ job, onSelect, childProgress }: { job: Job; onSelect?: (id: string) => void; childProgress?: { done: number; total: number } }) {
  const [showRedoDialog, setShowRedoDialog] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState("");

  const elapsed = job.startedAt > 0 ? Math.round(((job.completedAt || Date.now()) - job.startedAt) / 1000) : null;

  async function handleRun() {
    await queueJob(job.id);
    toast.success("Queued — the engine will pick it up");
  }

  async function handleCancel() {
    if (job.kind === "epic") { await cancelEpic(job.id); toast.info("Epic cancelled"); }
    else { await cancelJob(job.id); toast.info("Job cancelled"); }
  }

  async function handleRedo() {
    const combined = additionalPrompt.trim() ? `${job.prompt}\n\n${additionalPrompt.trim()}` : job.prompt;
    await createJob({ projectId: job.projectId, title: job.title, prompt: combined, images: job.images });
    setShowRedoDialog(false);
    setAdditionalPrompt("");
    toast.success("Job re-created as pending");
  }

  function openRedo(e: React.MouseEvent) {
    e.stopPropagation();
    setAdditionalPrompt("");
    setShowRedoDialog(true);
  }

  return (
    <>
      <div
        className="bg-paper border border-[#332f28] p-3 cursor-pointer brutal-shadow-sm hover:-translate-x-px hover:-translate-y-px hover:brutal-shadow-sm transition-all group"
        onClick={() => onSelect?.(job.id)}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <h5 className="text-[13px] font-bold uppercase text-ink leading-[1.25] flex-1">{job.title}</h5>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {job.kind === "epic" && (
              <span className="font-data text-[9px] uppercase border border-[#332f28] px-1 bg-[#e0a32e]/25 text-ink">
                Epic{childProgress ? ` ${childProgress.done}/${childProgress.total}` : ""}
              </span>
            )}
            <StatusBadge status={job.status} />
            {job.mergedToMain && (
              <span className="w-2.5 h-2.5 rounded-full bg-[#1f7a3d] flex-shrink-0" title="Merged to main" />
            )}
            {!job.mergedToMain && job.prUrl && (
              <span className="w-2.5 h-2.5 rounded-full bg-[#e0a32e] flex-shrink-0" title="Pushed to PR" />
            )}
          </div>
        </div>

        <p className="font-data text-[11px] text-muted mb-3 leading-[1.45]">{job.prompt}</p>

        {job.images.length > 0 && (
          <div className="flex gap-1 mb-3 flex-wrap">
            {job.images.slice(0, 3).map((img, i) => (
              <img key={i} src={img} alt="" className="w-10 h-10 object-cover border border-[#332f28]" />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-data text-[10px] text-muted uppercase">
            {job.branch && (
              <span className="flex items-center gap-1">
                <GitBranch className="w-2.5 h-2.5" />
                {job.branch.replace("job/", "").slice(0, 8)}
              </span>
            )}
            {elapsed !== null && <span>{elapsed}s</span>}
            {job.costUsd > 0 && (
              <span className="text-ink" title={`${(job.inputTokens + job.outputTokens).toLocaleString()} tokens`}>
                ${job.costUsd.toFixed(3)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {job.prUrl && (
              <a href={job.prUrl} target="_blank" rel="noopener noreferrer" className="p-1 text-muted hover:text-ink" onClick={(e) => e.stopPropagation()}>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {job.status === "pending" && (
              <button
                className="flex items-center gap-1 px-2 py-0.5 font-data text-[10px] uppercase bg-ink text-concrete border border-[#332f28] hover:bg-concrete hover:text-ink transition-colors"
                onClick={(e) => { e.stopPropagation(); handleRun(); }}
              >
                <Play className="w-2.5 h-2.5" /> Run
              </button>
            )}
            {(job.status === "cancelled" || job.status === "failed") && (
              <button
                className="flex items-center gap-1 px-2 py-0.5 font-data text-[10px] uppercase border border-[#332f28] text-ink hover:bg-ink hover:text-concrete transition-colors opacity-0 group-hover:opacity-100"
                onClick={openRedo}
              >
                <RotateCcw className="w-2.5 h-2.5" /> Redo
              </button>
            )}
            {(job.status === "pending" || job.status === "running" || job.status === "queued" || job.status === "waiting_for_input" || job.status === "delegating") && (
              <button
                className="p-1 text-muted hover:text-[#d6210f] opacity-0 group-hover:opacity-100 transition-opacity"
                title="Cancel agent"
                onClick={(e) => { e.stopPropagation(); handleCancel(); }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showRedoDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowRedoDialog(false)}>
          <div className="bg-paper border border-[#332f28] brutal-shadow p-5 w-[480px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display uppercase text-[15px] text-ink mb-4 pb-3 border-b border-[#332f28]">Re-run job</h3>
            <div className="mb-3">
              <p className="font-data text-[10px] uppercase text-muted mb-1.5">Original prompt</p>
              <div className="text-xs text-ink bg-concrete border border-[#332f28] p-2.5 max-h-28 overflow-y-auto font-mono whitespace-pre-wrap">{job.prompt}</div>
            </div>
            <div className="mb-5">
              <p className="font-data text-[10px] uppercase text-muted mb-1.5">Additional instructions <span className="opacity-60">(optional)</span></p>
              <textarea
                className="w-full bg-concrete border border-[#332f28] p-2.5 text-xs text-ink font-mono resize-none focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)] transition-shadow"
                rows={3}
                placeholder="Add more context or updated instructions…"
                value={additionalPrompt}
                onChange={(e) => setAdditionalPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRedo(); }}
                autoFocus
              />
              <p className="font-data text-[10px] uppercase text-muted mt-1">⌘↵ to submit</p>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 font-data text-[11px] uppercase text-muted hover:text-ink transition-colors" onClick={() => setShowRedoDialog(false)}>Cancel</button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase bg-ink text-concrete border border-[#332f28] brutal-press" onClick={handleRedo}>
                <RotateCcw className="w-3 h-3" /> Re-run
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
