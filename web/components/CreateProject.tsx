"use client";
import { useState } from "react";
import { Loader2, Sparkles, Lock, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFactory } from "@/lib/data";
import { createRepo, createProject, seedClaudeMd, createJob } from "@/lib/mutations";

const COLORS = ["#b86a39", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

interface Props {
  onCreated: (projectId: string, jobId: string) => void;
}

export function CreateProject({ onCreated }: Props) {
  const { ghLogin } = useFactory();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState<string | null>(null);

  const slug = slugify(name);
  const canSubmit = !!slug && !!description.trim() && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ghLogin) { toast.error("Connect GitHub first"); return; }
    if (!slug) { toast.error("Enter a project name"); return; }
    if (!description.trim()) { toast.error("Describe what you want to build"); return; }

    try {
      setBusy("Creating GitHub repo…");
      const data = await createRepo(slug, description.trim().slice(0, 350), isPrivate);

      setBusy("Adding project…");
      const agentRules = "Always run tests before pushing.\nUse conventional commits.\nFocus only on files relevant to the task — do not explore the full codebase.";
      const project = await createProject({
        name: name.trim(), repo: data.repo, localPath: data.localPath, defaultBranch: data.defaultBranch, agentRules, color,
      });

      if (data.localPath) {
        try { await seedClaudeMd(data.localPath, name.trim(), "", agentRules); } catch { /* ignore */ }
      }

      setBusy("Starting build…");
      const prompt = [
        "Build the following project from scratch in this repository (it is currently empty apart from a README):",
        "",
        description.trim(),
        "",
        "Choose an appropriate tech stack and project structure, scaffold the app, implement an initial working version, and commit your work.",
      ].join("\n");
      const job = await createJob({ projectId: project.id, title: `Build: ${name.trim()}`.slice(0, 80), prompt, autoRun: true });

      toast.success("Repo created — building now");
      setName("");
      setDescription("");
      onCreated(project.id, job.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="flex flex-col gap-4 p-6 bg-paper border-4 border-ink brutal-shadow">
        <div className="flex items-center gap-2 pb-3 border-b-4 border-ink">
          <Sparkles className="w-4 h-4 text-ink" />
          <h2 className="font-display uppercase text-[15px] text-ink">Create a new project</h2>
        </div>
        <p className="font-data text-[11px] uppercase text-muted -mt-2">
          Describe what you want to build. Factory creates a fresh GitHub repo, adds it here, and an agent starts building it right away.
        </p>

        {!ghLogin && (
          <p className="font-data text-[11px] uppercase text-ink bg-[#b8860b]/20 border-2 border-ink px-3 py-2">Connect GitHub (top right) to create repos.</p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Project Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" />
            {slug && <p className="font-data text-[10px] text-muted uppercase mt-1">Repo will be created as <span className="text-ink font-bold">{slug}</span></p>}
          </div>

          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">What do you want to build?</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder={"e.g. A todo app with a Next.js frontend and a SQLite backend.\nUsers can add, complete, and delete tasks, and filter by status."}
              className="font-mono text-sm resize-none"
            />
          </div>

          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Visibility</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsPrivate(true)} className={`flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase border-2 border-ink transition-colors ${isPrivate ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-concrete-2"}`}>
                <Lock className="w-3 h-3" /> Private
              </button>
              <button type="button" onClick={() => setIsPrivate(false)} className={`flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase border-2 border-ink transition-colors ${!isPrivate ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-concrete-2"}`}>
                <Globe className="w-3 h-3" /> Public
              </button>
            </div>
          </div>

          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} className="w-6 h-6 border-2 border-ink transition-all" style={{ backgroundColor: c, outline: color === c ? "2px solid var(--ink)" : "none", outlineOffset: "2px" }} />
              ))}
            </div>
          </div>

          <Button type="submit" disabled={!canSubmit} className="mt-1 brutal-press">
            {busy ? (
              <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{busy}</span>
            ) : (
              <span className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" />Create &amp; Build</span>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}