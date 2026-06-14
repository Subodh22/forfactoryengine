"use client";
import { useState } from "react";
import { LayoutGrid, Clock, Plus, ChevronRight, GitMerge, Folder, Settings, Trash2, Check, Loader2, CircleDot, AlertCircle, Pause, X } from "lucide-react";
import { toast } from "sonner";
import { removeJobCascade } from "@/lib/mutations";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UsagePanel } from "@/components/UsagePanel";
import { useJobs, useProjects } from "@/lib/data";
import type { Job, JobStatus } from "@/lib/types";

// Conductor-style left rail: Dashboard / History nav, then a Projects tree where
// each project expands to its workspaces (top-level jobs). A "workspace" in
// Factory is a root job; child jobs/subtasks hang off it. Usage meter pinned
// at the bottom. Pure UI over the existing data hooks — no engine changes.

export type ShellView =
  | "dashboard"
  | "history"
  | "new-job"
  | "create-project"
  | "env"
  | "agents"
  | "terminal"
  | "settings";

interface Props {
  view: ShellView;
  activeProject: string | null;
  selectedJob: string | null;
  onSelectView: (v: ShellView) => void;
  onSelectProject: (id: string | null) => void;
  onSelectJob: (id: string) => void;
  onNewWorkspace: (projectId: string) => void;
  onAddProject: () => void;
  onProjectSettings: (projectId: string) => void;
  /** Render as an always-visible mobile drawer instead of the desktop rail. */
  drawer?: boolean;
  /** Override sidebar width in pixels (desktop only). */
  width?: number;
}

function StatusIcon({ status, merged }: { status: JobStatus; merged?: boolean }) {
  if (status === "completed" && merged) {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#a855f7]/15">
        <GitMerge className="w-3 h-3 text-[#a855f7]" />
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#4ade80]/15">
        <Check className="w-3 h-3 text-[#4ade80]" />
      </span>
    );
  }
  if (status === "running" || status === "delegating") {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#4ade80]/10">
        <Loader2 className="w-3 h-3 text-[#4ade80] animate-spin" />
      </span>
    );
  }
  if (status === "waiting_for_input" || status === "clarifying") {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#e0a82e]/15">
        <CircleDot className="w-3 h-3 text-[#e0a82e] animate-pulse" />
      </span>
    );
  }
  if (status === "plan_review") {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#e0a82e]/15">
        <Pause className="w-3 h-3 text-[#e0a82e]" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#f4604f]/15">
        <AlertCircle className="w-3 h-3 text-[#f4604f]" />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded bg-[#6b6559]/15">
        <X className="w-3 h-3 text-[#6b6559]" />
      </span>
    );
  }
  // pending, queued
  return (
    <span
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: status === "queued" ? "#e0a82e" : "#9a9388" }}
    />
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
        active ? "bg-concrete-2 text-ink" : "text-muted hover:bg-concrete-2/60 hover:text-ink"
      }`}
    >
      <span className="flex-shrink-0 opacity-80">{icon}</span>
      {label}
    </button>
  );
}

function ProjectTree({
  project,
  expanded,
  onToggle,
  selectedJob,
  onSelectJob,
  onNewWorkspace,
  onSettings,
}: {
  project: { id: string; name: string; color?: string };
  expanded: boolean;
  onToggle: () => void;
  selectedJob: string | null;
  onSelectJob: (id: string) => void;
  onNewWorkspace: (projectId: string) => void;
  onSettings: (projectId: string) => void;
}) {
  const jobs = useJobs(project.id);
  const workspaces: Job[] = [...jobs.filter((j) => !j.parentJobId)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40);

  return (
    <div className="min-w-0">
      <div className="group flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-concrete-2/50">
        <button onClick={onToggle} className="flex items-center gap-1.5 min-w-0 flex-1 text-left overflow-hidden">
          <ChevronRight className={`w-3 h-3 flex-shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
          <span className="w-2 h-2 rounded-[3px] flex-shrink-0" style={{ backgroundColor: project.color || "#b08a3e" }} />
          <span className="text-[13px] truncate text-ink/90">{project.name}</span>
        </button>
        <button
          onClick={() => onSettings(project.id)}
          title="Project settings (setup / run scripts)"
          className="opacity-0 group-hover:opacity-100 text-muted hover:text-ink transition-opacity flex-shrink-0 p-0.5"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onNewWorkspace(project.id)}
          title="New workspace"
          className="text-ink hover:text-[#b08a3e] flex-shrink-0 p-0.5"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="ml-[14px] pl-2 border-l border-[#2a2722] flex flex-col min-w-0">
          <button
            onClick={() => onNewWorkspace(project.id)}
            className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-left text-[12px] text-muted hover:text-ink transition-colors"
          >
            <Plus className="w-3 h-3" /> New workspace
          </button>
          {workspaces.map((ws) => {
            const isSel = ws.id === selectedJob;
            return (
              <div
                key={ws.id}
                className={`group/ws flex items-center rounded-md transition-colors w-full min-w-0 ${
                  isSel ? "bg-concrete-2 text-ink" : "text-ink/90 hover:bg-concrete-2/50 hover:text-ink"
                }`}
              >
                <button
                  onClick={() => onSelectJob(ws.id)}
                  title={ws.title}
                  className="flex items-center gap-2 pl-2 pr-1.5 py-1 text-left min-w-0 flex-1 overflow-hidden"
                >
                  <StatusIcon status={ws.status} merged={ws.mergedToMain} />
                  <span className={`text-[12.5px] truncate min-w-0 flex-1 ${ws.status === "completed" && ws.mergedToMain ? "text-ink/40 line-through decoration-ink/20" : ""}`}>{ws.title || "Untitled"}</span>
                  {(ws.status === "running" || ws.status === "delegating") && (
                    <span className="flex-shrink-0 font-data text-[9px] tracking-wider uppercase text-[#4ade80] px-1 py-0.5 rounded bg-[#4ade80]/10">RUN</span>
                  )}
                  {ws.status === "completed" && ws.mergedToMain && (
                    <span className="flex-shrink-0 font-data text-[9px] tracking-wider uppercase text-[#a855f7]/70 px-1 py-0.5 rounded bg-[#a855f7]/10">MRG</span>
                  )}
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Delete "${ws.title || "Untitled"}"? This cannot be undone.`)) return;
                    try {
                      await removeJobCascade(ws.id);
                      toast.success("Workspace deleted");
                    } catch {
                      toast.error("Failed to delete workspace");
                    }
                  }}
                  title="Delete workspace"
                  className="opacity-0 group-hover/ws:opacity-100 text-muted hover:text-[#f4604f] transition-opacity flex-shrink-0 p-1 mr-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  view,
  activeProject,
  selectedJob,
  onSelectView,
  onSelectProject,
  onSelectJob,
  onNewWorkspace,
  onAddProject,
  onProjectSettings,
  drawer,
  width,
}: Props) {
  const projects = useProjects();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeProject ? [activeProject] : []));

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onSelectProject(id);
  };

  return (
    <div className={`${drawer ? "flex" : "hidden lg:flex"} h-full flex-shrink-0 border-r border-[#332f28] flex-col overflow-hidden bg-concrete`} style={{ width: width ?? 248 }}>
      {/* Brand */}
      <div className="flex items-center gap-2 px-3.5 h-[46px] flex-shrink-0">
        <span className="w-[14px] h-[14px] rounded-[4px] bg-[#b08a3e] inline-block" />
        <span className="font-display text-[14px] tracking-tight leading-none text-ink">Factory</span>
      </div>

      {/* Primary nav */}
      <div className="px-2 pb-2 flex flex-col gap-0.5 flex-shrink-0">
        <NavItem icon={<LayoutGrid className="w-4 h-4" />} label="Dashboard" active={view === "dashboard" && !selectedJob} onClick={() => onSelectView("dashboard")} />
        <NavItem icon={<Clock className="w-4 h-4" />} label="History" active={view === "history" && !selectedJob} onClick={() => onSelectView("history")} />
      </div>

      {/* Projects */}
      <div className="flex items-center justify-between px-3.5 pt-2 pb-1 flex-shrink-0">
        <span className="font-data text-[10px] tracking-[1.5px] uppercase text-muted">Projects</span>
        <button onClick={onAddProject} title="Add repo" className="text-muted hover:text-ink transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 pb-3 flex flex-col gap-0.5">
          {projects.map((p) => (
            <ProjectTree
              key={p.id}
              project={p}
              expanded={expanded.has(p.id)}
              onToggle={() => toggle(p.id)}
              selectedJob={selectedJob}
              onSelectJob={onSelectJob}
              onNewWorkspace={onNewWorkspace}
              onSettings={onProjectSettings}
            />
          ))}
          {projects.length === 0 && (
            <button onClick={onAddProject} className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[12.5px] text-muted hover:text-ink hover:bg-concrete-2/50 transition-colors">
              <Folder className="w-3.5 h-3.5" /> Add your first repo
            </button>
          )}
        </div>
      </ScrollArea>

      <div className="flex-shrink-0 border-t border-[#332f28] p-3">
        <UsagePanel />
      </div>
    </div>
  );
}
