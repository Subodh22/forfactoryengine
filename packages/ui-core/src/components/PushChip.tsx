"use client";
import type { Job } from "@/lib/types";

const MAX_PUSH_ATTEMPTS = 3;

// Where the job's commits actually went — the second axis next to StatusBadge.
// Status says how the agent did; this chip says whether the work landed on the
// remote (PR opened / pushed to main), is still in flight, or needs the user.
export function PushChip({ job }: { job: Job }) {
  if (!job.pushState) return null;

  if (job.pushState === "pushing") {
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide border border-[#b8860b] text-[#b8860b] px-1 leading-[1.4] animate-pulse flex-shrink-0"
        title={`Pushing — attempt ${job.pushAttempts}/${MAX_PUSH_ATTEMPTS}`}
      >
        Pushing {job.pushAttempts}/{MAX_PUSH_ATTEMPTS}
      </span>
    );
  }

  if (job.pushState === "pushed") {
    const label = job.prUrl ? `PR #${job.prNumber}` : `→ ${job.pushedTo || "main"}`;
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide border border-[#1f7a3d] text-[#1f7a3d] px-1 leading-[1.4] flex-shrink-0"
        title={job.pushedSha ? `Pushed ${job.pushedSha.slice(0, 8)}` : "Pushed"}
      >
        {label}
      </span>
    );
  }

  // needs_help — the push exhausted its retries; the commit is safe in the worktree.
  return (
    <span
      className="inline-flex items-center font-data text-[9px] uppercase tracking-wide border border-[#d6210f] bg-[#d6210f] text-paper px-1 leading-[1.4] animate-pulse flex-shrink-0"
      title={job.pushError || "Push failed — needs your help"}
    >
      Push failed
    </span>
  );
}
