"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Clock, MinusCircle, RefreshCw, ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { fetchJobChecks, sendReply, type CheckRun } from "@/lib/mutations";

// "Checks" tab: CI status for the job's PR (GitHub Actions + Vercel/commit
// statuses). Failing checks can be forwarded to Claude as a reply so the agent
// fixes them. Engine: GET /api/jobs/:id/checks.

interface Props {
  jobId: string;
  prNumber: number;
  prUrl?: string;
  canForward: boolean;
  refreshKey?: string;
}

function isFailure(c: CheckRun): boolean {
  return c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "action_required";
}
function isPending(c: CheckRun): boolean {
  return c.status !== "completed";
}

function StatusIcon({ c }: { c: CheckRun }) {
  if (isPending(c)) return <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />;
  if (c.conclusion === "success") return <CheckCircle2 className="w-4 h-4 text-[#4ade80] flex-shrink-0" />;
  if (isFailure(c)) return <XCircle className="w-4 h-4 text-[#f4604f] flex-shrink-0" />;
  return <MinusCircle className="w-4 h-4 text-muted flex-shrink-0" />;
}

export function Checks({ jobId, prNumber: _prNumber, prUrl, canForward, refreshKey }: Props) {
  const [checks, setChecks] = useState<CheckRun[]>([]);
  const [state, setState] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [forwarding, setForwarding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchJobChecks(jobId)
      .then((r) => { setChecks(r.checks); setState(r.state); })
      .catch(() => setState("error"))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Auto-poll while any check is still running.
  useEffect(() => {
    if (!checks.some(isPending)) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [checks, load]);

  const failing = checks.filter(isFailure);

  async function forwardFailing() {
    if (!failing.length) return;
    setForwarding(true);
    const lines = failing.map((c) => `- ${c.name}${c.url ? ` (${c.url})` : ""}`).join("\n");
    const msg = `The following CI checks are failing on this PR. Please investigate the logs and fix them:\n${lines}`;
    try {
      await sendReply(jobId, msg, []);
      toast.success("Forwarded failing checks to Claude");
    } catch {
      toast.error("Couldn't forward — no live session for this job");
    } finally {
      setForwarding(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted gap-2 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading checks…</div>;
  }

  if (state === "no-pr") {
    return <Empty title="No pull request yet" note="Checks appear once this workspace opens a PR." />;
  }
  if (state === "no-token") {
    return <Empty title="GitHub not connected" note="Connect a repo with a GitHub token to see CI status." />;
  }
  if (state === "error") {
    return <Empty title="Couldn't load checks" note="The engine failed to reach GitHub for this PR." />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[#2a2722] flex-shrink-0 bg-concrete">
        <span className="font-data text-[10px] uppercase tracking-wide text-muted">
          {checks.length} check{checks.length !== 1 ? "s" : ""}
          {failing.length > 0 && <span className="text-[#f4604f]"> · {failing.length} failing</span>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink transition-colors" title="Open PR">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={load} className="text-muted hover:text-ink transition-colors" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {failing.length > 0 && canForward && (
        <button
          onClick={forwardFailing}
          disabled={forwarding}
          className="flex items-center gap-2 m-2 px-3 py-2 rounded-md text-[12px] bg-[#3a1a18] text-[#f4a99f] border border-[#5a2f2c] hover:bg-[#4a221f] transition-colors disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          {forwarding ? "Forwarding…" : "Forward failing checks to Claude"}
        </button>
      )}

      <div className="flex-1 overflow-y-auto">
        {checks.length === 0 ? (
          <Empty title="No checks reported" note="This PR has no CI checks yet." />
        ) : (
          checks.map((c, i) => (
            <div key={`${c.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2 border-b border-[#2a2722]/60">
              <StatusIcon c={c} />
              <span className="text-[12.5px] text-ink/90 truncate flex-1">{c.name}</span>
              {isPending(c) && <Clock className="w-3 h-3 text-muted flex-shrink-0" />}
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink transition-colors flex-shrink-0" title="Details">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[13px] text-ink/80">{title}</p>
      <p className="font-data text-[11px] text-muted max-w-[260px] leading-relaxed">{note}</p>
    </div>
  );
}
