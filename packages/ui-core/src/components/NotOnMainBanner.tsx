"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, ArrowUpRight } from "lucide-react";
import { useJobs } from "@/lib/data";
import { jobNotOnMain } from "./MainBadge";

// Dashboard surface: completed jobs whose work never landed on main — sitting in
// an unmerged PR, or never pushed. They look done but aren't deployed (Vercel
// builds production from main). Lets you see every un-landed job at a glance and
// jump to it / its PR. Collapsible because a PR-flow project racks up dozens.
export function NotOnMainBanner({ projectId, onSelectJob }: { projectId?: string; onSelectJob?: (id: string) => void }) {
  const jobs = useJobs(projectId);
  const [open, setOpen] = useState(false);
  const unlanded = jobs.filter(jobNotOnMain).sort((a, b) => b.createdAt - a.createdAt);
  if (unlanded.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#e0a82e]/60 bg-[#e0a82e]/10 px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-[#e0a82e] flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[#e0a82e] flex-shrink-0" />}
        <span className="font-data text-[11px] uppercase tracking-wide font-bold text-[#e0a82e]">
          {unlanded.length} job{unlanded.length === 1 ? "" : "s"} not on main — not deployed
        </span>
        <span className="font-data text-[10px] uppercase text-muted ml-auto flex-shrink-0">{open ? "hide" : "show"}</span>
      </button>
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
