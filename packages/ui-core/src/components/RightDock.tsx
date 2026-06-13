"use client";
import { useRef, useState } from "react";
import { FileText, GitCompare, CheckCircle2, TerminalSquare } from "lucide-react";
import { DiffViewer } from "@/components/DiffViewer";
import { TerminalTabs } from "@/components/TerminalTabs";
import { AllFiles } from "@/components/AllFiles";
import { Checks } from "@/components/Checks";
import { useJob } from "@/lib/data";

// Conductor-style right pane for a workspace: All files | Changes | Checks |
// Terminal. Changes reuses the existing DiffViewer; Terminal reuses TerminalTabs
// (kept mounted once opened so its PTYs survive tab switches). "All files" and
// "Checks" are Phase-3/5 stubs for now.

type DockTab = "files" | "changes" | "checks" | "terminal";

interface Props {
  jobId: string;
  project: { name: string; localPath: string; setupScript?: string; runScript?: string };
  /** Override dock width in pixels (desktop only). */
  width?: number;
}

const TABS: { key: DockTab; label: string; icon: React.ReactNode }[] = [
  { key: "files", label: "All files", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "changes", label: "Changes", icon: <GitCompare className="w-3.5 h-3.5" /> },
  { key: "checks", label: "Checks", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { key: "terminal", label: "Terminal", icon: <TerminalSquare className="w-3.5 h-3.5" /> },
];

export function RightDock({ jobId, project, width }: Props) {
  const job = useJob(jobId);
  const [tab, setTab] = useState<DockTab>("changes");
  // Latch the terminal mounted after first visit so its shell sessions persist.
  const openedTerminal = useRef(false);
  if (tab === "terminal") openedTerminal.current = true;

  return (
    <div className={`hidden lg:flex flex-shrink-0 border-l border-[#332f28] flex-col overflow-hidden bg-concrete ${width ? "" : "w-[42%] min-w-[380px] max-w-[760px]"}`} style={width ? { width } : undefined}>
      {/* Tab strip */}
      <div className="flex items-center gap-0.5 px-2 h-[42px] border-b border-[#332f28] flex-shrink-0 bg-concrete">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] transition-colors ${
              tab === t.key ? "bg-concrete-2 text-ink" : "text-muted hover:text-ink hover:bg-concrete-2/60"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Panes */}
      <div className="flex-1 min-h-0 relative bg-surface-deep">
        {tab === "files" && <AllFiles jobId={jobId} refreshKey={job?.status ?? ""} />}

        {tab === "changes" && (
          <div className="h-full overflow-y-auto">
            <DiffViewer jobId={jobId} refreshKey={job?.status ?? ""} />
          </div>
        )}

        {tab === "checks" && (
          <Checks
            jobId={jobId}
            prNumber={job?.prNumber ?? 0}
            prUrl={job?.prUrl}
            canForward={!!job && job.status !== "pending" && job.status !== "plan_review"}
            refreshKey={job?.status ?? ""}
          />
        )}

        {/* Terminal kept mounted (just hidden) once opened so PTYs survive. */}
        {openedTerminal.current && (
          <div className="absolute inset-0 p-2" style={{ display: tab === "terminal" ? "block" : "none" }}>
            <TerminalTabs
              project={{ name: project.name, localPath: project.localPath }}
              presets={[
                ...(project.setupScript?.trim() ? [{ label: "Setup", command: project.setupScript }] : []),
                ...(project.runScript?.trim() ? [{ label: "Run", command: project.runScript }] : []),
                { label: "Shell", command: "" },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
