"use client";
import { useEffect, useState } from "react";
import { Save, Play, TerminalSquare, Loader2, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useProject, useJobs } from "@/lib/data";
import { updateProject, unarchiveJob, removeJobCascade } from "@/lib/mutations";
import { VercelConnect } from "@/components/VercelConnect";

// Per-project settings: the setup script (runs once when a job's worktree is
// created) and the run script (a launchable dev command, surfaced as a "Run"
// terminal preset). Mirrors conductor.json's setup/run scripts.

export function ProjectSettings({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const [setupScript, setSetupScript] = useState("");
  const [runScript, setRunScript] = useState("");
  const [agentRules, setAgentRules] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (project && !loaded) {
      setSetupScript(project.setupScript ?? "");
      setRunScript(project.runScript ?? "");
      setAgentRules(project.agentRules ?? "");
      setLoaded(true);
    }
  }, [project, loaded]);

  if (!project) return <div className="text-muted text-[13px]">Project not found.</div>;

  const dirty = setupScript !== (project.setupScript ?? "") || runScript !== (project.runScript ?? "") || agentRules !== (project.agentRules ?? "");

  async function save() {
    setSaving(true);
    try {
      await updateProject(projectId, { setupScript, runScript, agentRules });
      toast.success("Project settings saved");
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err) || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[760px] mx-auto space-y-6">
      <div>
        <h2 className="font-display text-[18px] text-ink">{project.name}</h2>
        <p className="font-data text-[11px] text-muted mt-1">{project.localPath}</p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <TerminalSquare className="w-4 h-4 text-[#b08a3e]" /> Setup script
        </label>
        <p className="text-[12px] text-muted">Runs once in each new worktree before the agent starts — install deps, copy config, etc.</p>
        <textarea
          value={setupScript}
          onChange={(e) => setSetupScript(e.target.value)}
          rows={4}
          placeholder={"npm install\ncp .env.example .env"}
          className="w-full rounded-md bg-paper border border-[#332f28] px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:border-[#b08a3e] resize-y"
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Play className="w-4 h-4 text-[#4ade80]" /> Run script
        </label>
        <p className="text-[12px] text-muted">A dev/run command, launchable as the "Run" terminal in a workspace.</p>
        <textarea
          value={runScript}
          onChange={(e) => setRunScript(e.target.value)}
          rows={2}
          placeholder={"npm run dev"}
          className="w-full rounded-md bg-paper border border-[#332f28] px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:border-[#b08a3e] resize-y"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[13px] text-ink">Agent rules</label>
        <p className="text-[12px] text-muted">Guidance prepended to every agent run for this project.</p>
        <textarea
          value={agentRules}
          onChange={(e) => setAgentRules(e.target.value)}
          rows={4}
          className="w-full rounded-md bg-paper border border-[#332f28] px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:border-[#b08a3e] resize-y"
        />
      </div>

      <button
        onClick={save}
        disabled={!dirty || saving}
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#b08a3e] text-[#14110e] font-bold text-[13px] disabled:opacity-40 hover:brightness-110 transition-all"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "Saving…" : "Save settings"}
      </button>

      <ArchivedWorkspaces projectId={projectId} />

      <div className="border-t border-[#332f28] pt-6">
        <VercelConnect />
      </div>
    </div>
  );
}

function ArchivedWorkspaces({ projectId }: { projectId: string }) {
  const jobs = useJobs(projectId);
  const archived = jobs.filter((j) => !j.parentJobId && j.archived)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (archived.length === 0) return null;

  return (
    <div className="border-t border-[#332f28] pt-6 space-y-3">
      <h3 className="font-data text-[11px] tracking-[1.5px] uppercase text-muted">
        Archived workspaces ({archived.length})
      </h3>
      <div className="space-y-1">
        {archived.map((ws) => (
          <div
            key={ws.id}
            className="group flex items-center gap-2 px-3 py-2 rounded-md border border-[#332f28] bg-paper"
          >
            <span className="text-[12.5px] text-ink/60 min-w-0 flex-1 line-clamp-1">{ws.title || "Untitled"}</span>
            <button
              onClick={async () => {
                try {
                  await unarchiveJob(ws.id);
                  toast.success("Workspace restored");
                } catch {
                  toast.error("Failed to restore workspace");
                }
              }}
              title="Restore workspace"
              className="text-muted hover:text-[#4ade80] transition-colors flex-shrink-0 p-1"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={async () => {
                if (!window.confirm(`Permanently delete "${ws.title || "Untitled"}"? This cannot be undone.`)) return;
                try {
                  await removeJobCascade(ws.id);
                  toast.success("Workspace deleted");
                } catch {
                  toast.error("Failed to delete workspace");
                }
              }}
              title="Delete permanently"
              className="text-muted hover:text-[#f4604f] transition-colors flex-shrink-0 p-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
