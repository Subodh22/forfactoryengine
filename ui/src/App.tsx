import { useRef, useState } from "react";
import { Plus, X, Menu } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KanbanBoard } from "@/components/KanbanBoard";
import { ChatPanel } from "@/components/ChatPanel";
import { MasterFeed } from "@/components/MasterFeed";
import { JobDetail } from "@/components/JobDetail";
import { AgentsGrid } from "@/components/AgentsGrid";
import { TerminalTabs } from "@/components/TerminalTabs";
import { CreateProject } from "@/components/CreateProject";
import { AddProjectModal } from "@/components/AddProjectModal";
import { EnvPanel } from "@/components/EnvPanel";
import { JobNotifications } from "@/components/JobNotifications";
import { UsagePanel, useClaudeUsage, resetLabel } from "@/components/UsagePanel";
import { useFactory, useProjects, useJobs, useTodayStats } from "@/lib/data";
import { removeProject, connectGithub } from "@/lib/mutations";
import { setToken, ENGINE_URL } from "@/lib/api";

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
    <div className="font-data text-[11px] border-2 border-ink bg-concrete px-2.5 py-1 cursor-default flex items-center gap-2 uppercase" title={title}>
      <span className="leading-none">{fmtTokens(total)} tokens</span>
      {pct !== null && (
        <>
          <span className="w-px h-3 bg-ink" />
          <span className="leading-none">{pct}%</span>
          <span className="w-16 h-2 bg-paper border border-ink overflow-hidden">
            <span className="block h-full bg-ink transition-all duration-700" style={{ width: `${pct}%` }} />
          </span>
        </>
      )}
    </div>
  );
}

const TAB_LABELS: Record<string, string> = {
  board: "Kanban Board",
  agents: "Agents",
  chat: "New Job",
  create: "Create Project",
  env: "Env",
  terminal: "Terminal",
};

function TokenGate() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-transparent">
      <div className="flex items-center gap-2">
        <span className="w-[18px] h-[18px] bg-ink inline-block" />
        <span className="font-display uppercase text-[20px] tracking-tight leading-none">Factory</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (new FormData(e.target as HTMLFormElement).get("t") as string).trim();
          if (v) { setToken(v); location.reload(); }
        }}
      >
        <input name="t" type="password" placeholder="Access token" autoFocus className="border-2 border-ink bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]" />
        <button type="submit" className="font-data text-[12px] uppercase px-4 py-2 bg-ink text-concrete border-2 border-ink brutal-press">Enter</button>
      </form>
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
  const [tab, setTab] = useState("board");
  const [feedOpen, setFeedOpen] = useState(false);
  // Latches once the terminal is first opened; after that we keep it mounted
  // (hidden on other tabs) so its sessions/PTYs survive — but don't spawn shells
  // until the user actually visits the terminal.
  const openedTerminal = useRef(false);
  if (tab === "terminal") openedTerminal.current = true;

  if (needToken) return <TokenGate />;
  if (!ready) return <div className="h-screen flex items-center justify-center font-data text-xs uppercase text-muted">Loading…</div>;

  const project = activeProject ? projects.find((p) => p.id === activeProject) ?? null : null;
  const projectId = project?.id;

  const scopedJobs = projectId ? allJobsGlobal.filter((j) => j.projectId === projectId) : allJobsGlobal;
  const runningCount = scopedJobs.filter((j) => j.status === "running" || j.status === "queued").length;

  async function connect() {
    const token = window.prompt("Paste a GitHub Personal Access Token (scope: repo):");
    if (!token?.trim()) return;
    try { const r = await connectGithub(token.trim()); setGhLogin(r.login); }
    catch (err) { alert(String(err)); }
  }

  return (
    <div className="h-screen flex flex-col bg-transparent text-ink overflow-hidden">
      <JobNotifications />

      {/* ───────── TOP BAR ───────── */}
      <header className="flex items-center gap-4 px-3 sm:px-[22px] h-[62px] border-b-4 border-ink bg-concrete flex-shrink-0">
        <button onClick={() => setFeedOpen(true)} className="lg:hidden flex-shrink-0 text-ink hover:opacity-60 transition-opacity" title="Show jobs"><Menu className="w-5 h-5" /></button>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="w-[18px] h-[18px] bg-ink inline-block" />
          <span className="font-display uppercase text-[17px] tracking-tight leading-none">Factory</span>
        </div>

        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <button onClick={() => setActiveProject(null)} className={`font-data text-[11px] px-2.5 py-1 border-2 border-ink uppercase flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap transition-colors ${activeProject === null ? "bg-ink text-concrete" : "bg-concrete hover:bg-concrete-2"}`}>All</button>

          {projects.map((p) => (
            <div key={p.id} className={`font-data text-[11px] px-2.5 py-1 border-2 border-ink uppercase flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap transition-colors ${p.id === activeProject ? "bg-ink text-concrete" : "bg-concrete hover:bg-concrete-2"}`}>
              <button onClick={() => setActiveProject(p.id)} className="flex items-center gap-1.5">
                <span className="w-[7px] h-[7px] flex-shrink-0" style={{ backgroundColor: p.color || "#d6210f" }} />
                {p.name}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); if (confirm(`Remove "${p.name}" from Factory?`)) { removeProject(p.id); if (activeProject === p.id) setActiveProject(null); } }}
                className={`ml-1 hover:opacity-60 transition-opacity ${p.id === activeProject ? "text-concrete" : "text-ink"}`}
                title={`Remove ${p.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          <button onClick={() => setShowAddProject(true)} className="font-data text-[11px] px-2.5 py-1 border-2 border-ink uppercase flex items-center gap-1 flex-shrink-0 whitespace-nowrap bg-concrete hover:bg-ink hover:text-concrete transition-colors">
            <Plus className="w-3 h-3" />Add repo
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {runningCount > 0 && (
            <button onClick={() => setTab("agents")} className="flex items-center gap-1.5 px-2.5 py-1 font-data text-[11px] bg-ink text-concrete uppercase">
              <span className="w-1.5 h-1.5 bg-concrete animate-pulse" />{runningCount} running
            </button>
          )}

          <div className="hidden sm:block">
            <UsagePill inputTokens={todayStats?.inputTokens ?? 0} outputTokens={todayStats?.outputTokens ?? 0} jobCount={todayStats?.jobCount ?? 0} />
          </div>

          <span className="hidden lg:inline font-data text-[11px] bg-ink text-concrete px-2.5 py-1 uppercase">Claude Code · Local</span>

          {ghLogin ? (
            <span className="font-data text-[11px] uppercase">@{ghLogin}</span>
          ) : ghOAuth ? (
            <a href={`${ENGINE_URL}/api/github/login`} className="font-data text-[11px] px-3 py-1.5 bg-ink text-concrete uppercase brutal-press border-2 border-ink">Login with GitHub</a>
          ) : (
            <button onClick={connect} className="font-data text-[11px] px-3 py-1.5 bg-ink text-concrete uppercase brutal-press border-2 border-ink">Connect GitHub</button>
          )}

          <span className="font-data text-[10px] uppercase" style={{ opacity: live ? 1 : 0.3 }} title={live ? "live" : "offline"}>● {live ? "live" : "offline"}</span>
        </div>
      </header>

      {/* ───────── BODY ───────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden lg:flex w-[262px] flex-shrink-0 border-r-4 border-ink flex-col overflow-hidden bg-concrete">
          <div className="flex-1 overflow-hidden"><MasterFeed projectId={projectId} onSelectJob={setSelectedJob} /></div>
          <div className="flex-shrink-0 border-t-4 border-ink p-3"><UsagePanel /></div>
        </div>

        {feedOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-ink/40" onClick={() => setFeedOpen(false)} />
            <div className="relative w-72 max-w-[82vw] bg-concrete border-r-4 border-ink flex flex-col">
              <div className="flex items-center justify-end px-2 h-10 border-b-4 border-ink flex-shrink-0">
                <button onClick={() => setFeedOpen(false)} className="text-ink hover:opacity-60 p-1" title="Close"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-hidden"><MasterFeed projectId={projectId} onSelectJob={(id) => { setSelectedJob(id); setFeedOpen(false); }} /></div>
              <div className="flex-shrink-0 border-t-4 border-ink p-3"><UsagePanel /></div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden bg-transparent">
          <div className="border-b-4 border-ink flex-shrink-0 bg-concrete sticky top-0 z-[5]">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="bg-transparent p-0 h-auto gap-0 rounded-none w-full justify-start overflow-x-auto no-scrollbar">
                {["board", "agents", "chat", "create", "env", "terminal"].map((t) => (
                  <TabsTrigger key={t} value={t} className="font-sans font-bold uppercase text-[13px] tracking-[.3px] px-[22px] py-4 rounded-none border-r-2 border-ink data-[state=active]:bg-ink data-[state=active]:text-concrete data-[state=inactive]:bg-concrete data-[state=inactive]:text-ink hover:data-[state=inactive]:bg-concrete-2 transition-colors flex-shrink-0">
                    {t === "agents" ? (
                      <span className="flex items-center gap-1.5">Agents{runningCount > 0 && <span className="w-1.5 h-1.5 bg-current animate-pulse" />}</span>
                    ) : TAB_LABELS[t]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-y-auto p-6 sm:p-12">
            {tab === "board" && <KanbanBoard projectId={projectId} onSelectJob={setSelectedJob} />}
            {tab === "agents" && <AgentsGrid projectId={projectId} />}
            {tab === "chat" && projectId && (
              <div className="max-w-[760px] mx-auto"><ChatPanel projectId={projectId} onJobCreated={(id) => { setSelectedJob(id); setTab("board"); }} /></div>
            )}
            {tab === "create" && <CreateProject onCreated={(pid, jid) => { setActiveProject(pid); setSelectedJob(jid); setTab("board"); }} />}
            {tab === "chat" && !projectId && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="font-display uppercase text-sm text-ink">Select a project to create a job</p>
                <p className="font-data text-[11px] uppercase text-muted">Choose a repo from the top bar to get started</p>
              </div>
            )}
            {tab === "env" && project && <EnvPanel key={project.id} localPath={project.localPath} projectName={project.name} />}
            {tab === "env" && !project && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="font-display uppercase text-sm text-ink">Select a project to edit its .env</p>
                <p className="font-data text-[11px] uppercase text-muted">Choose a repo from the top bar to get started</p>
              </div>
            )}
            {/* Kept mounted (just hidden) on other tabs so terminal sessions + PTYs survive tab switches. */}
            {openedTerminal.current && project && (
              <div className="h-full" style={{ display: tab === "terminal" ? "block" : "none" }}>
                <TerminalTabs project={{ name: project.name, localPath: project.localPath }} />
              </div>
            )}
            {tab === "terminal" && !project && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="font-display uppercase text-sm text-ink">Select a project to open a terminal</p>
                <p className="font-data text-[11px] uppercase text-muted">The terminal runs commands from the repo&apos;s root directory</p>
              </div>
            )}
          </div>
        </div>

        {selectedJob && tab !== "agents" && tab !== "terminal" && (
          <div className="fixed inset-0 z-30 bg-concrete lg:static lg:inset-auto lg:z-auto lg:w-96 flex-shrink-0 border-l-4 border-ink flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b-4 border-ink bg-ink text-concrete">
              <span className="font-display text-[13px] tracking-wide uppercase">Job Detail</span>
              <button onClick={() => setSelectedJob(null)} className="text-concrete hover:opacity-60 text-sm">✕</button>
            </div>
            <div className="flex-1 overflow-hidden"><JobDetail jobId={selectedJob} onRedo={(id) => { setSelectedJob(id); setTab("board"); }} /></div>
          </div>
        )}
      </div>

      {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} />}
    </div>
  );
}
