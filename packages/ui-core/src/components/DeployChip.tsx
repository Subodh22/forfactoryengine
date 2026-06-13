"use client";
import type { Job } from "@/lib/types";

// Vercel deploy state for the commit a job pushed — the third axis next to
// StatusBadge (agent) and PushChip (remote). Says whether the build is running,
// live, failed, or canceled. Hidden until a deploy is being watched.
export function DeployChip({ job }: { job: Job }) {
  if (!job.deployState) return null;
  const target = job.deployTarget || "preview";

  if (job.deployState === "building") {
    return (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#e0a82e]/50 text-[#e0a82e] px-1.5 leading-[1.5] animate-pulse flex-shrink-0"
        title={`Vercel ${target} deploy building`}
      >
        ▲ Deploying
      </span>
    );
  }

  if (job.deployState === "ready") {
    const chip = (
      <span
        className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#4ade80]/40 text-[#4ade80] px-1.5 leading-[1.5] flex-shrink-0"
        title={`Vercel ${target} deploy live`}
      >
        ▲ Deployed
      </span>
    );
    return job.deployUrl
      ? <a href={job.deployUrl} target="_blank" rel="noreferrer" className="no-underline">{chip}</a>
      : chip;
  }

  if (job.deployState === "canceled") {
    return (
      <span className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#6b6559] text-muted px-1.5 leading-[1.5] flex-shrink-0">
        ▲ Canceled
      </span>
    );
  }

  // error
  return (
    <span
      className="inline-flex items-center font-data text-[9px] uppercase tracking-wide rounded-sm border border-[#f4604f] bg-[#f4604f]/15 text-[#f4604f] px-1.5 leading-[1.5] flex-shrink-0"
      title={job.deployError ? job.deployError.slice(-300) : "Vercel build failed"}
    >
      ▲ Deploy failed
    </span>
  );
}
