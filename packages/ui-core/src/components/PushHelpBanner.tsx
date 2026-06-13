"use client";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useJobs } from "@/lib/data";
import { retryPush } from "@/lib/mutations";

// Sticky alert above the board: jobs whose push exhausted its retries and is
// waiting on the user. Stays up until every push lands, so a failed push can't
// scroll out of sight.
export function PushHelpBanner({ projectId }: { projectId?: string }) {
  const jobs = useJobs(projectId);
  const stuck = jobs.filter((j) => j.pushState === "needs_help");
  if (stuck.length === 0) return null;

  async function handleRetry(id: string) {
    await retryPush(id);
    toast.info("Retrying push — watch the job's push chip");
  }

  return (
    <div className="rounded-lg border border-[#f4604f]/60 bg-[#f4604f]/10 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-full bg-[#f4604f] animate-pulse flex-shrink-0" />
        <span className="font-data text-[11px] uppercase tracking-wide font-bold text-[#f4604f]">
          {stuck.length} job{stuck.length === 1 ? "" : "s"} need{stuck.length === 1 ? "s" : ""} push help
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {stuck.map((j) => (
          <div key={j.id} className="flex items-center justify-between gap-3">
            <span className="font-data text-[10px] uppercase text-ink truncate min-w-0" title={j.pushError}>
              {j.title} — {j.pushError || "push failed"}
            </span>
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded-md font-data text-[10px] uppercase border border-[#f4604f] text-[#f4604f] hover:bg-[#f4604f] hover:text-surface-deep transition-colors flex-shrink-0"
              onClick={() => handleRetry(j.id)}
            >
              <RotateCcw className="w-2.5 h-2.5" /> Retry push
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
