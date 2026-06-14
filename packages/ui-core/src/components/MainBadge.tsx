"use client";
import type { Job } from "@/lib/types";

// Push states where the work is still actively on its way to the remote — not
// "settled off main", so we don't flag them.
const PUSH_IN_FLIGHT = new Set(["pushing", "checking_ci", "fixing_ci"]);

/** A completed top-level job whose work has NOT landed on the default branch:
 *  it's sitting in an unmerged PR, or it was never pushed at all. These look
 *  "done" — the agent finished and a PR chip can even read green ("PR #N · CI ✓")
 *  — but nothing reached main, so Vercel never deploys them. Failed pushes
 *  (needs_help) and in-flight pushes are surfaced elsewhere, so they're excluded. */
export function jobNotOnMain(job: Job): boolean {
  return (
    job.status === "completed" &&
    !job.parentJobId &&
    !job.mergedToMain &&
    job.pushState !== "needs_help" &&
    !PUSH_IN_FLIGHT.has(job.pushState)
  );
}

// The missing axis next to StatusBadge / PushChip / DeployChip: even a green
// "PR #N · CI ✓" means the work is only in a PR, not merged to main. This amber
// badge makes "not actually live" unmistakable.
export function MainBadge({ job }: { job: Job }) {
  if (!jobNotOnMain(job)) return null;
  const title = job.prUrl
    ? `In PR #${job.prNumber} — not merged, so not on main and not deployed. Merge the PR to land it.`
    : "Completed but never pushed — not on main and not deployed. Push it to land it.";
  return (
    <span
      className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#e0a82e] bg-[#e0a82e]/15 text-[#e0a82e] px-1.5 leading-[1.5] flex-shrink-0"
      title={title}
    >
      Not on main
    </span>
  );
}
