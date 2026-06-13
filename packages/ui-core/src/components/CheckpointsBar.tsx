"use client";
import { useEffect, useState } from "react";
import { History, RotateCcw, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchCheckpoints, rollbackJob, type Checkpoint } from "@/lib/mutations";

// A "rewind" bar above the chat thread: each turn that changed files is a
// checkpoint you can restore the workspace to. Only shown when checkpoints
// exist. Restore is only possible while the job's worktree is still around.

export function CheckpointsBar({ jobId, refreshKey }: { jobId: string; refreshKey?: string }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchCheckpoints(jobId).then((c) => { if (live) setCheckpoints(c); }).catch(() => {});
    return () => { live = false; };
  }, [jobId, refreshKey]);

  if (checkpoints.length === 0) return null;

  async function restore(cp: Checkpoint) {
    if (restoring) return;
    if (!confirm(`Rewind the workspace to turn ${cp.turn}? Uncommitted work after this point will be discarded.`)) return;
    setRestoring(cp.id);
    try {
      await rollbackJob(jobId, cp.sha);
      toast.success(`Rewound to turn ${cp.turn}`);
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err) || "Couldn't restore checkpoint");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-[#332f28] bg-concrete-2/40 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted hover:text-ink transition-colors">
        <History className="w-3.5 h-3.5" />
        <span>{checkpoints.length} checkpoint{checkpoints.length !== 1 ? "s" : ""}</span>
        <span className="ml-auto">{open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
      </button>
      {open && (
        <div className="border-t border-[#332f28] divide-y divide-[#332f28]/60">
          {checkpoints.map((cp) => (
            <div key={cp.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-data text-[10px] text-muted flex-shrink-0">#{cp.turn}</span>
              <span className="text-[12px] text-ink/80 truncate flex-1">{cp.label || "turn"}</span>
              <button
                onClick={() => restore(cp)}
                disabled={!!restoring}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-muted hover:text-ink hover:bg-concrete-2 transition-colors flex-shrink-0 disabled:opacity-50"
                title="Rewind the workspace to this turn"
              >
                {restoring === cp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
