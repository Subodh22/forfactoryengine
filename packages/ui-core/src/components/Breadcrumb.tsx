"use client";
import { Menu, ChevronRight, Search } from "lucide-react";
import { engineUrl } from "@/lib/api";

// Conductor-style top breadcrumb bar: repo › workspace on the left, live status
// + usage + GitHub on the right. Replaces the old project-tabs header. The usage
// pill is injected as `rightExtra` so the existing UsagePill logic is reused.

interface Props {
  projectName?: string;
  jobTitle?: string;
  live: boolean;
  runningCount: number;
  ghLogin: string;
  ghOAuth: boolean;
  onConnectGithub: () => void;
  onOpenPalette: () => void;
  onShowSidebar: () => void;
  onAgents: () => void;
  rightExtra?: React.ReactNode;
}

export function Breadcrumb({
  projectName,
  jobTitle,
  live,
  runningCount,
  ghLogin,
  ghOAuth,
  onConnectGithub,
  onOpenPalette,
  onShowSidebar,
  onAgents,
  rightExtra,
}: Props) {
  return (
    <header className="flex items-center gap-3 px-3 h-[46px] border-b border-[#332f28] bg-concrete flex-shrink-0">
      <button onClick={onShowSidebar} className="lg:hidden flex-shrink-0 text-muted hover:text-ink transition-colors" title="Menu">
        <Menu className="w-4.5 h-4.5" />
      </button>

      {/* Breadcrumb trail */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[13px]">
        {projectName ? (
          <>
            <span className="text-ink/90 truncate max-w-[200px]">{projectName}</span>
            {jobTitle && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                <span className="text-ink truncate max-w-[360px]">{jobTitle}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-muted">All projects</span>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onOpenPalette}
          className="hidden sm:flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-[#332f28] text-muted hover:text-ink hover:bg-concrete-2 transition-colors"
          title="Jump to any job or project (⌘K)"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="font-data text-[10px] tracking-wide">⌘K</span>
        </button>

        {runningCount > 0 && (
          <button onClick={onAgents} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] bg-[#1f3a28] text-[#4ade80] border border-[#2f5a3e]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
            {runningCount} running
          </button>
        )}

        {rightExtra}

        {ghLogin ? (
          <span className="hidden sm:inline font-data text-[11px] text-muted">@{ghLogin}</span>
        ) : ghOAuth ? (
          <a href={`${engineUrl()}/api/github/login`} className="text-[11px] px-2.5 py-1 rounded-md bg-concrete-2 text-ink border border-[#332f28] hover:bg-[#2f2b25] transition-colors">
            Login with GitHub
          </a>
        ) : (
          <button onClick={onConnectGithub} className="text-[11px] px-2.5 py-1 rounded-md bg-concrete-2 text-ink border border-[#332f28] hover:bg-[#2f2b25] transition-colors">
            Connect GitHub
          </button>
        )}

        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: live ? "#4ade80" : "#6b6559" }} title={live ? "live" : "offline"} />
      </div>
    </header>
  );
}
