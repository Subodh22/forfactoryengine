"use client";
import type { Job } from "@/lib/types";

const MAX_PUSH_ATTEMPTS = 3;
const MAX_CI_FIX_ATTEMPTS = 3;

// Where the job's commits actually went — the second axis next to StatusBadge.
// Status says how the agent did; this chip says whether the work landed on the
// remote (PR opened / pushed to main), is still in flight, or needs the user.
export function PushChip({ job }: { job: Job }) {
  if (!job.pushState) return null;

  if (job.pushState === "pushing") {
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#e0a82e]/50 text-[#e0a82e] px-1.5 leading-[1.5] animate-pulse flex-shrink-0"
        title={`Pushing — attempt ${job.pushAttempts}/${MAX_PUSH_ATTEMPTS}`}
      >
        Pushing {job.pushAttempts}/{MAX_PUSH_ATTEMPTS}
      </span>
    );
  }

  // Watching GitHub Actions for the pushed commit.
  if (job.pushState === "checking_ci") {
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#e0a82e]/50 text-[#e0a82e] px-1.5 leading-[1.5] animate-pulse flex-shrink-0"
        title={job.ciRunUrl || "Checking GitHub Actions…"}
      >
        Checking CI
      </span>
    );
  }

  // Agent is troubleshooting a red CI run.
  if (job.pushState === "fixing_ci") {
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#e0a82e]/50 text-[#e0a82e] px-1.5 leading-[1.5] animate-pulse flex-shrink-0"
        title={`CI failed — agent fixing (attempt ${job.ciAttempts}/${MAX_CI_FIX_ATTEMPTS})`}
      >
        Fixing CI {job.ciAttempts}/{MAX_CI_FIX_ATTEMPTS}
      </span>
    );
  }

  if (job.pushState === "pushed") {
    const where = job.prUrl ? `PR #${job.prNumber}` : `→ ${job.pushedTo || "main"}`;
    // Append the CI verdict when GitHub Actions ran for this push.
    const label = job.ciStatus === "passed" ? `${where} · CI ✓`
      : job.ciStatus === "pending" ? `${where} · CI…`
      : where;
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#4ade80]/40 text-[#4ade80] px-1.5 leading-[1.5] flex-shrink-0"
        title={job.pushedSha ? `Pushed ${job.pushedSha.slice(0, 8)}${job.ciStatus ? ` — CI ${job.ciStatus}` : ""}` : "Pushed"}
      >
        {label}
      </span>
    );
  }

  // needs_help — the push exhausted its retries; the commit is safe in the worktree.
  return (
    <span
      className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#f4604f] bg-[#f4604f]/15 text-[#f4604f] px-1.5 leading-[1.5] animate-pulse flex-shrink-0"
      title={job.pushError || "Push failed — needs your help"}
    >
      Push failed
    </span>
  );
}
