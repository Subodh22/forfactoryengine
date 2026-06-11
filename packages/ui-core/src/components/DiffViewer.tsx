"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { JobDiff } from "@/lib/types";

// Hand-rolled unified-diff renderer in the terminal aesthetic — no dependency.
// The engine reconstructs the patch (live worktree, recorded commit, or
// surviving branch); this just colors it and groups it per file.

interface Props {
  jobId: string;
  /** Change to refetch — JobDetail passes the job status so the diff flips
   *  from live-worktree to recorded-commit when the job completes. */
  refreshKey?: string;
}

interface FileSection {
  path: string;
  adds: number;
  dels: number;
  lines: string[];
}

function parsePatch(patch: string): FileSection[] {
  const sections: FileSection[] = [];
  let current: FileSection | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/ b\/(.*)$/);
      current = { path: m?.[1] ?? line.slice(11), adds: 0, dels: 0, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) current.adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) current.dels++;
  }
  return sections;
}

function lineClass(line: string): string {
  if (
    line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ") ||
    line.startsWith("new file") || line.startsWith("deleted file") ||
    line.startsWith("similarity") || line.startsWith("rename") || line.startsWith("Binary files")
  ) return "text-[#6b8a6b]";
  if (line.startsWith("@@")) return "text-cyan-400";
  if (line.startsWith("+")) return "text-[#3bd16f]";
  if (line.startsWith("-")) return "text-red-400";
  return "text-[#cfe8cf]";
}

const SOURCE_LABEL: Record<JobDiff["source"], string> = {
  worktree: "live worktree · uncommitted",
  commit: "recorded commit",
  branch: "branch vs default",
  none: "",
};

export function DiffViewer({ jobId, refreshKey }: Props) {
  const [diff, setDiff] = useState<JobDiff | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    api<JobDiff>(`/api/jobs/${jobId}/diff`)
      .then((d) => { if (!cancelled) setDiff(d); })
      .catch((err) => { if (!cancelled) setError(String(err instanceof Error ? err.message : err)); });
    return () => { cancelled = true; };
  }, [jobId, refreshKey]);

  if (error) return <p className="text-xs text-red-400 italic font-mono p-4">Could not load changes: {error}</p>;
  if (!diff) return <p className="text-xs text-[#6b8a6b] italic font-mono p-4">Loading changes…</p>;
  if (diff.source === "none" || !diff.patch.trim()) {
    return <p className="text-xs text-[#6b8a6b] italic font-mono p-4">No changes yet.</p>;
  }

  const files = parsePatch(diff.patch);
  return (
    <div className="text-xs font-mono leading-relaxed">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 font-data text-[10px] uppercase text-[#6b8a6b]">
        <span>{files.length} file{files.length !== 1 ? "s" : ""} · {SOURCE_LABEL[diff.source]}</span>
        {diff.truncated && <span className="text-amber-400">· truncated</span>}
      </div>
      {files.map((f) => (
        <details key={f.path} open className="border-b border-[#2a2722]">
          <summary className="px-4 py-2 cursor-pointer select-none flex items-center gap-2 text-[#cfe8cf] hover:bg-[#1a1a16] list-none">
            <span className="truncate">{f.path}</span>
            <span className="ml-auto flex-shrink-0 font-data text-[10px]">
              <span className="text-[#3bd16f]">+{f.adds}</span>{" "}
              <span className="text-red-400">−{f.dels}</span>
            </span>
          </summary>
          <pre className="px-4 pb-3 whitespace-pre-wrap break-all">
            {f.lines.map((line, i) => (
              <span key={i} className={lineClass(line)}>{line}{"\n"}</span>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}
