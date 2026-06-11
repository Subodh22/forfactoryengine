"use client";
import { useState, useEffect, useRef } from "react";
import { X, Loader2, Lock, Search, ChevronDown, RefreshCw, FolderDown, Plus, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFactory } from "@/lib/data";
import { createProject, createRepo, cloneRepo, seedClaudeMd, fetchRepos } from "@/lib/mutations";
import type { Repo } from "@/lib/types";

const COLORS = ["#b86a39", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export function AddProjectModal({ onClose }: { onClose: () => void }) {
  const { ghLogin } = useFactory();
  const connected = !!ghLogin;

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [form, setForm] = useState({
    name: "", repo: "", localPath: "", defaultBranch: "main",
    agentRules: "Always run tests before pushing.\nUse conventional commits.\nFocus only on files relevant to the task — do not explore the full codebase.",
    codemapHint: "", color: COLORS[0],
  });
  const [isPrivate, setIsPrivate] = useState(true);

  const [ghRepos, setGhRepos] = useState<Repo[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const slug = slugify(form.name);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    const q = repoSearch.toLowerCase();
    setFilteredRepos(q ? ghRepos.filter((r) => r.fullName.toLowerCase().includes(q)) : ghRepos);
  }, [repoSearch, ghRepos]);

  useEffect(() => {
    if (connected && ghRepos.length === 0) loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function loadRepos() {
    setLoadingRepos(true);
    try {
      const repos = await fetchRepos();
      setGhRepos(repos);
      setFilteredRepos(repos);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load repos");
    } finally {
      setLoadingRepos(false);
    }
  }

  function selectRepo(r: Repo) {
    setSelectedRepo(r);
    setForm((f) => ({ ...f, repo: r.fullName, name: f.name || r.fullName.split("/")[1], defaultBranch: r.defaultBranch }));
    setShowDropdown(false);
    setRepoSearch("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "new") {
      if (!slug) { toast.error("Enter a project name"); return; }
      if (!connected) { toast.error("Connect GitHub first"); return; }
      setCloning(true);
      try {
        const data = await createRepo(slug, "", isPrivate);
        await createProject({ name: form.name, repo: data.repo, localPath: data.localPath, defaultBranch: data.defaultBranch, agentRules: form.agentRules, color: form.color });
        try { await seedClaudeMd(data.localPath, form.name, form.codemapHint, form.agentRules); } catch { /* ignore */ }
        toast.success("Repo created and cloned — ready to use");
        onClose();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create repo");
      } finally {
        setCloning(false);
      }
      return;
    }

    if (!form.name || !form.repo) { toast.error("Name and repo are required"); return; }

    let localPath = form.localPath;
    if (!localPath) {
      setCloning(true);
      try {
        const data = await cloneRepo(form.repo);
        localPath = data.localPath;
        toast[data.alreadyExists ? "info" : "success"](data.alreadyExists ? `Using existing clone at ${localPath}` : `Cloned to ${localPath}`);
      } catch {
        toast.info("Engine will clone this repo on first run");
      } finally {
        setCloning(false);
      }
    }

    try {
      await createProject({ name: form.name, repo: form.repo, localPath, defaultBranch: form.defaultBranch, agentRules: form.agentRules, color: form.color });
      if (localPath) {
        try { await seedClaudeMd(localPath, form.name, form.codemapHint, form.agentRules); } catch { /* ignore */ }
      }
      toast.success("Project added");
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add project");
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4">
      <div className="bg-paper border-4 border-ink brutal-shadow w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b-4 border-ink bg-ink text-concrete">
          <h2 className="font-display uppercase text-[15px]">Add Project</h2>
          <button onClick={onClose} className="text-concrete hover:opacity-60"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={submit} className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("existing")} className={`flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase border-2 border-ink transition-colors ${mode === "existing" ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-concrete-2"}`}>
              <FolderDown className="w-3 h-3" /> Existing Repo
            </button>
            <button type="button" onClick={() => setMode("new")} className={`flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase border-2 border-ink transition-colors ${mode === "new" ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-concrete-2"}`}>
              <Plus className="w-3 h-3" /> Create New
            </button>
          </div>

          {mode === "new" ? (
            <>
              <div>
                <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Project Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My App" className="bg-paper" />
                {slug && <p className="font-data text-[10px] text-muted uppercase mt-1">Repo: <span className="text-ink font-bold">{slug}</span></p>}
              </div>
              <div>
                <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Visibility</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsPrivate(true)} className={`flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase border-2 border-ink transition-colors ${isPrivate ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-concrete-2"}`}><Lock className="w-3 h-3" /> Private</button>
                  <button type="button" onClick={() => setIsPrivate(false)} className={`flex items-center gap-1.5 px-3 py-1.5 font-data text-[11px] uppercase border-2 border-ink transition-colors ${!isPrivate ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-concrete-2"}`}><Globe className="w-3 h-3" /> Public</button>
                </div>
              </div>
              {!connected && <p className="font-data text-[11px] uppercase text-ink bg-[#b8860b]/20 border-2 border-ink px-3 py-2">Connect GitHub (top right) to create repos.</p>}
            </>
          ) : (
            <>
              <div ref={dropdownRef} className="relative">
                <div className="flex items-center justify-between mb-1">
                  <label className="font-data text-[10px] text-muted uppercase tracking-widest">GitHub Repo</label>
                  {connected && (
                    <button type="button" onClick={loadRepos} disabled={loadingRepos} className="text-[10px] text-zinc-600 hover:text-zinc-400 flex items-center gap-1">
                      {loadingRepos ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      {loadingRepos ? "Loading…" : `${ghRepos.length} repos`}
                    </button>
                  )}
                </div>
                {connected ? (
                  <>
                    <button type="button" onClick={() => ghRepos.length && setShowDropdown((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-paper border-2 border-ink text-sm text-left transition-colors hover:bg-concrete-2">
                      {loadingRepos ? (
                        <span className="flex items-center gap-2 text-zinc-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your repos…</span>
                      ) : selectedRepo ? (
                        <span className="flex items-center gap-2 text-zinc-100">{selectedRepo.private && <Lock className="w-3 h-3 text-zinc-500 shrink-0" />}{selectedRepo.fullName}</span>
                      ) : (
                        <span className="text-zinc-500">{ghRepos.length ? "Select a repo…" : "Loading…"}</span>
                      )}
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    </button>
                    {showDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-paper border-2 border-ink brutal-shadow-sm z-10 overflow-hidden">
                        <div className="p-2 border-b-2 border-ink">
                          <div className="flex items-center gap-2 px-2 py-1 bg-concrete border-2 border-ink">
                            <Search className="w-3 h-3 text-muted shrink-0" />
                            <input autoFocus value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} placeholder="Filter repos…" className="flex-1 bg-transparent text-xs text-ink font-mono outline-none placeholder:text-muted" />
                          </div>
                        </div>
                        <div className="max-h-52 overflow-y-auto">
                          {filteredRepos.length === 0 ? (
                            <p className="text-xs text-muted p-3 text-center font-data uppercase">No repos found</p>
                          ) : (
                            filteredRepos.map((r) => (
                              <button key={r.fullName} type="button" onClick={() => selectRepo(r)} className="w-full text-left px-3 py-2 border-b border-ink/20 hover:bg-concrete-2 transition-colors">
                                <div className="flex items-center gap-2">
                                  {r.private && <Lock className="w-3 h-3 text-zinc-500 shrink-0" />}
                                  <span className="text-xs text-zinc-100">{r.fullName}</span>
                                  <span className="text-[10px] text-zinc-600 ml-auto">{r.defaultBranch}</span>
                                </div>
                                {r.description && <p className="text-[10px] text-zinc-600 mt-0.5 truncate pl-5">{r.description}</p>}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <Input value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} placeholder="org/repo" className="bg-paper" />
                )}
              </div>

              <div>
                <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My App" className="bg-paper" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-data text-[10px] text-muted uppercase tracking-widest">Local Path <span className="text-zinc-700 normal-case">(optional)</span></label>
                  {!form.localPath && selectedRepo && <span className="text-[10px] text-indigo-500 flex items-center gap-1"><FolderDown className="w-3 h-3" /> will auto-clone on add</span>}
                </div>
                <Input value={form.localPath} onChange={(e) => setForm({ ...form, localPath: e.target.value })} placeholder={selectedRepo ? "Leave empty to auto-clone" : "/Users/you/projects/my-app"} className="bg-paper" />
                <p className="text-[10px] text-zinc-600 mt-1">{form.localPath ? "Using this existing local path" : "Empty = repo will be cloned automatically into your workspace"}</p>
              </div>

              <div>
                <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Default Branch</label>
                <Input value={form.defaultBranch} onChange={(e) => setForm({ ...form, defaultBranch: e.target.value })} className="bg-paper" />
              </div>
            </>
          )}

          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Project Structure <span className="text-zinc-700 normal-case">(for CLAUDE.md)</span></label>
            <Textarea value={form.codemapHint} onChange={(e) => setForm({ ...form, codemapHint: e.target.value })} rows={4} placeholder={"Describe where things live, e.g.:\n- src/auth/ — all auth logic\n- src/app/api/ — API routes\n- Ignore: node_modules, dist, .next"} className="bg-paper text-xs resize-none placeholder:text-zinc-700" />
            <p className="text-[10px] text-zinc-600 mt-1">Written to CLAUDE.md in the repo root — helps Claude find the right files without exploring everything</p>
          </div>

          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Agent Rules</label>
            <Textarea value={form.agentRules} onChange={(e) => setForm({ ...form, agentRules: e.target.value })} rows={3} className="bg-paper text-xs resize-none" />
          </div>

          <div>
            <label className="font-data text-[10px] text-muted uppercase tracking-widest mb-1 block">Color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className="w-6 h-6 border-2 border-ink transition-all" style={{ backgroundColor: c, outline: form.color === c ? "2px solid var(--ink)" : "none", outlineOffset: "2px" }} />
              ))}
            </div>
          </div>

          <Button type="submit" disabled={cloning || (mode === "new" && (!slug || !connected))} className="mt-1 brutal-press">
            {cloning ? (
              <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{mode === "new" ? "Creating repo…" : "Cloning repo…"}</span>
            ) : mode === "new" ? (
              <span className="flex items-center gap-2"><Plus className="w-3.5 h-3.5" />Create &amp; Add Project</span>
            ) : "Add Project"}
          </Button>
        </form>
      </div>
    </div>
  );
}
