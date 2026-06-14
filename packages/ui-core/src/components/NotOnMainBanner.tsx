"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, ArrowUpRight, RefreshCw, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { useJobs } from "@/lib/data";
import { reconcilePRs, mergeAllPRs } from "@/lib/mutations";
import { jobNotOnMain } from "./MainBadge";

// Dashboard surface: completed jobs whose work never landed on main — sitting in
// an unmerged PR, or never pushed. They look done but aren't deployed (Vercel
// builds production from main). Lets you see every un-landed job at a glance and
// jump to it / its PR. Collapsible because a PR-flow project racks up dozens.
export function NotOnMainBanner({ projectId, onSelectJob }: { projectId?: string; onSelectJob?: (id: string) => void }) {
  const jobs = useJobs(projectId);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [merging, setMerging] = useState(false);
  const unlanded = jobs.filter(jobNotOnMain).sort((a, b) => b.createdAt - a.createdAt);
  const mergeable = unlanded.filter((j) => j.prNumber > 0).length;

  async function sync() {
    setSyncing(true);
    try {
      const { updated } = await reconcilePRs();
      toast.success(updated ? `${updated} job${updated === 1 ? "" : "s"} now marked on main` : "Already up to date with GitHub");
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err) || "Could not check GitHub");
    } finally {
      setSyncing(false);
    }
  }

  async function mergeAll() {
    if (!projectId || merging) return;
    if (!window.confirm(`Merge ${mergeable} open PR${mergeable === 1 ? "" : "s"} into main? This deploys them to Vercel.`)) return;
    setMerging(true);
    try {
      const { merged, failed, errors } = await mergeAllPRs(projectId);
      if (merged) toast.success(`Merged ${merged} PR${merged === 1 ? "" : "s"} to main`);
      if (failed) toast.error(`${failed} could not merge${errors[0] ? ` — e.g. ${errors[0]}` : ""}`);
      if (!merged && !failed) toast.info("Nothing to merge");
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err) || "Merge-all failed");
    } finally {
      setMerging(false);
    }
  }

  if (unlanded.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#e0a82e]/60 bg-[#e0a82e]/10 px-3 py-2">
      <div className="w-full flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-[#e0a82e] flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[#e0a82e] flex-shrink-0" />}
          <span className="font-data text-[11px] uppercase tracking-wide font-bold text-[#e0a82e] truncate">
            {unlanded.length} job{unlanded.length === 1 ? "" : "s"} not on main — not deployed
          </span>
        </button>
        {mergeable > 0 && (
          <button
            onClick={mergeAll}
            disabled={merging}
            title={`Merge ${mergeable} open PR${mergeable === 1 ? "" : "s"} into main`}
            className="flex items-center gap-1 font-data text-[10px] uppercase text-[#a855f7] hover:text-ink transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <GitMerge className={`w-3 h-3 ${merging ? "animate-pulse" : ""}`} /> {merging ? "Merging…" : `Merge all (${mergeable})`}
          </button>
        )}
        <button
          onClick={sync}
          disabled={syncing}
          title="Check GitHub for merged PRs and update which jobs are on main"
          className="flex items-center gap-1 font-data text-[10px] uppercase text-[#e0a82e] hover:text-ink transition-colors flex-shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Checking…" : "Sync"}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 mt-2">
          {unlanded.map((j) => (
            <div key={j.id} className="flex items-center justify-between gap-3">
              <button
                onClick={() => onSelectJob?.(j.id)}
                className="flex items-center gap-1.5 min-w-0 text-left font-data text-[10px] uppercase text-ink hover:text-[#e0a82e] transition-colors"
                title={j.title}
              >
                <ArrowUpRight className="w-2.5 h-2.5 flex-shrink-0" />
                <span className="truncate">{j.title || "Untitled"}</span>
              </button>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="font-data text-[9px] uppercase text-muted">
                  {j.prUrl ? `PR #${j.prNumber} · unmerged` : "not pushed"}
                </span>
                {j.prUrl && (
                  <a href={j.prUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open PR" onClick={(e) => e.stopPropagation()}>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
