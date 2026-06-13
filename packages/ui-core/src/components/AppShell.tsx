"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { ProjectBoard } from "@/components/ProjectBoard";
import { ChatPanel } from "@/components/ChatPanel";
import { MasterFeed } from "@/components/MasterFeed";
import { WorkspaceView } from "@/components/WorkspaceView";
import { RightDock } from "@/components/RightDock";
import { Sidebar, type ShellView } from "@/components/Sidebar";
import { Breadcrumb } from "@/components/Breadcrumb";
import { AgentsGrid } from "@/components/AgentsGrid";
import { TerminalTabs } from "@/components/TerminalTabs";
import { CreateProject } from "@/components/CreateProject";
import { AddProjectModal } from "@/components/AddProjectModal";
import { EnvPanel } from "@/components/EnvPanel";
import { ProjectSettings } from "@/components/ProjectSettings";
import { JobNotifications } from "@/components/JobNotifications";
import { CommandPalette, OPEN_PALETTE_EVENT } from "@/components/CommandPalette";
import { useClaudeUsage, resetLabel } from "@/components/UsagePanel";
import { useFactory, useProjects, useJobs, useTodayStats } from "@/lib/data";
import { connectGithub } from "@/lib/mutations";
import { setToken } from "@/lib/api";

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function UsagePill({ inputTokens, outputTokens, jobCount }: { inputTokens: number; outputTokens: number; jobCount: number }) {
  const { data } = useClaudeUsage();
  const total = inputTokens + outputTokens;
  const session = data?.session ?? null;
  const pct = session ? Math.min(Math.round(session.utilization), 100) : null;

  const title = session
    ? `Session: ${pct}% used · ${resetLabel(session.resets_at)}\nToday: ${total.toLocaleString()} tokens (${inputTokens.toLocaleString()} in · ${outputTokens.toLocaleString()} out) across ${jobCount} job${jobCount !== 1 ? "s" : ""}`
    : `Today: ${total.toLocaleString()} tokens across ${jobCount} job${jobCount !== 1 ? "s" : ""}`;

  return (
    <div className="hidden md:flex font-data text-[11px] rounded-md border border-[#332f28] bg-concrete-2 px-2.5 py-1 cursor-default items-center gap-2" title={title}>
      <span className="leading-none text-muted">{fmtTokens(total)} tok</span>
      {pct !== null && (
        <>
          <span className="w-px h-3 bg-[#332f28]" />
          <span className="leading-none text-ink">{pct}%</span>
          <span className="w-12 h-1.5 rounded-full bg-[#14110e] overflow-hidden">
            <span className="block h-full bg-[#b08a3e] transition-all duration-700" style={{ width: `${pct}%` }} />
          </span>
        </>
      )}
    </div>
  );
}

function TokenGate() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-concrete">
      <div className="flex items-center gap-2">
        <span className="w-[18px] h-[18px] rounded-[5px] bg-[#b08a3e] inline-block" />
        <span className="font-display text-[20px] tracking-tight leading-none">Factory</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (new FormData(e.target as HTMLFormElement).get("t") as string).trim();
          if (v) { setToken(v); location.reload(); }
        }}
      >
        <input name="t" type="password" placeholder="Access token" autoFocus className="rounded-md border border-[#332f28] bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#b08a3e]" />
        <button type="submit" className="font-data text-[12px] px-4 py-2 rounded-md bg-[#b08a3e] text-[#14110e] font-bold">Enter</button>
      </form>
    </div>
  );
}

/** Maps the command-palette's legacy tab strings onto the new shell views. */
const PALETTE_TAB_TO_VIEW: Record<string, ShellView> = {
  board: "dashboard",
  agents: "agents",
  chat: "new-job",
  create: "create-project",
  env: "env",
  terminal: "terminal",
};

function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[14px] text-ink/85">{title}</p>
      <p className="font-data text-[11px] text-muted">{note}</p>
    </div>
  );
}

export function App() {
  const { ready, needToken, live, ghLogin, ghOAuth, setGhLogin } = useFactory();
  const projects = useProjects();
  const allJobsGlobal = useJobs();
  const todayStats = useTodayStats();

  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [view, setView] = useState<ShellView>("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (needToken) return <TokenGate />;
  if (!ready) return <div className="h-screen flex items-center justify-center font-data text-xs uppercase text-muted bg-concrete">Loading…</div>;

  const project = activeProject ? projects.find((p) => p.id === activeProject) ?? null : null;
  const projectId = project?.id;

  const selJob = selectedJob ? allJobsGlobal.find((j) => j.id === selectedJob) ?? null : null;
  const breadcrumbProject = selJob ? projects.find((p) => p.id === selJob.projectId) ?? null : project;

  const scopedJobs = projectId ? allJobsGlobal.filter((j) => j.projectId === projectId) : allJobsGlobal;
  const runningCount = scopedJobs.filter((j) => j.status === "running" || j.status === "queued").length;

  async function connect() {
    const token = window.prompt("Paste a GitHub Personal Access Token (scope: repo):");
    if (!token?.trim()) return;
    try { const r = await connectGithub(token.trim()); setGhLogin(r.login); }
    catch (err) { alert(String(err)); }
  }

  const goView = (v: ShellView) => { setSelectedJob(null); setView(v); };
  const openJob = (id: string) => {
    const j = allJobsGlobal.find((x) => x.id === id);
    if (j) setActiveProject(j.projectId);
    setSelectedJob(id);
  };
  const newWorkspace = (pid: string) => { setActiveProject(pid); setSelectedJob(null); setView("new-job"); };

  function CenterContent() {
    switch (view) {
      case "dashboard":
        return <div className="h-full overflow-y-auto p-4 sm:p-6"><ProjectBoard projectId={projectId} onSelectJob={openJob} /></div>;
      case "history":
        return <div className="h-full overflow-hidden"><MasterFeed onSelectJob={openJob} /></div>;
      case "new-job":
        return projectId ? (
          <div className="h-full overflow-y-auto p-4 sm:p-8"><div className="max-w-[760px] mx-auto"><ChatPanel projectId={projectId} onJobCreated={openJob} /></div></div>
        ) : <EmptyState title="Select a project to create a workspace" note="Pick a repo in the sidebar, then describe the task." />;
      case "create-project":
        return <div className="h-full overflow-y-auto p-4 sm:p-8"><CreateProject onCreated={(pid, jid) => { setActiveProject(pid); if (jid) setSelectedJob(jid); else setView("dashboard"); }} /></div>;
      case "env":
        return project ? (
          <div className="h-full overflow-y-auto p-4 sm:p-6"><EnvPanel key={project.id} localPath={project.localPath} projectName={project.name} /></div>
        ) : <EmptyState title="Select a project to edit its .env" note="Choose a repo from the sidebar to get started." />;
      case "agents":
        return <div className="h-full overflow-y-auto p-4 sm:p-6"><AgentsGrid projectId={projectId} /></div>;
      case "settings":
        return project ? (
          <div className="h-full overflow-y-auto p-4 sm:p-8"><ProjectSettings projectId={project.id} /></div>
        ) : <EmptyState title="Select a project to edit its settings" note="Pick a repo in the sidebar, then add setup / run scripts." />;
      case "terminal":
        return project ? (
          <div className="h-full p-3"><TerminalTabs project={{ name: project.name, localPath: project.localPath }} /></div>
        ) : <EmptyState title="Select a project to open a terminal" note="The terminal runs from the repo root." />;
      default:
        return null;
    }
  }

  return (
    <div className="h-screen flex flex-col bg-concrete text-ink overflow-hidden">
      <JobNotifications />
      <CommandPalette
        projects={projects}
        jobs={allJobsGlobal}
        onSelectProject={(id) => { setActiveProject(id); setSelectedJob(null); setView("dashboard"); }}
        onSelectJob={(job) => { setActiveProject(job.projectId); setSelectedJob(job.id); }}
        onSetTab={(t) => goView(PALETTE_TAB_TO_VIEW[t] ?? "dashboard")}
      />

      <Breadcrumb
        projectName={breadcrumbProject?.name}
        jobTitle={selJob?.title}
        live={live}
        runningCount={runningCount}
        ghLogin={ghLogin}
        ghOAuth={ghOAuth}
        onConnectGithub={connect}
        onOpenPalette={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
        onShowSidebar={() => setDrawerOpen(true)}
        onAgents={() => goView("agents")}
        rightExtra={<UsagePill inputTokens={todayStats?.inputTokens ?? 0} outputTokens={todayStats?.outputTokens ?? 0} jobCount={todayStats?.jobCount ?? 0} />}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          view={view}
          activeProject={activeProject}
          selectedJob={selectedJob}
          onSelectView={goView}
          onSelectProject={setActiveProject}
          onSelectJob={openJob}
          onNewWorkspace={newWorkspace}
          onAddProject={() => setShowAddProject(true)}
          onProjectSettings={(pid) => { setActiveProject(pid); goView("settings"); }}
        />

        {/* Mobile sidebar drawer */}
        {drawerOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
            <div className="relative">
              <Sidebar
                drawer
                view={view}
                activeProject={activeProject}
                selectedJob={selectedJob}
                onSelectView={(v) => { goView(v); setDrawerOpen(false); }}
                onSelectProject={setActiveProject}
                onSelectJob={(id) => { openJob(id); setDrawerOpen(false); }}
                onNewWorkspace={(pid) => { newWorkspace(pid); setDrawerOpen(false); }}
                onAddProject={() => { setShowAddProject(true); setDrawerOpen(false); }}
                onProjectSettings={(pid) => { setActiveProject(pid); goView("settings"); setDrawerOpen(false); }}
              />
              <button onClick={() => setDrawerOpen(false)} className="absolute top-3 right-[-40px] text-ink p-1" title="Close"><X className="w-5 h-5" /></button>
            </div>
          </div>
        )}

        {/* Center pane */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 bg-concrete">
          {selectedJob ? <WorkspaceView jobId={selectedJob} onRedo={openJob} /> : <CenterContent />}
        </main>

        {/* Right dock — only for a selected workspace */}
        {selectedJob && breadcrumbProject && (
          <RightDock jobId={selectedJob} project={{ name: breadcrumbProject.name, localPath: breadcrumbProject.localPath, setupScript: breadcrumbProject.setupScript, runScript: breadcrumbProject.runScript }} />
        )}
      </div>

      {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} />}
    </div>
  );
}
