"use client";
import { useEffect, useState } from "react";

interface Project { id: string; name: string; repo: string; defaultBranch: string; }
interface Job { id: string; projectId: string; title: string; status: string; prUrl: string; createdAt: number; }

const COLOR: Record<string, string> = {
  pending: "#888", running: "#e0a32e", done: "#3bd16f", failed: "#d6210f", cancelled: "#888",
};

async function jget<T>(url: string): Promise<T> { return (await fetch(url, { cache: "no-store" })).json(); }
async function jpost(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

export default function Page() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    jget<Project[]>("/api/projects").then((p) => { setProjects(p); if (p[0]) setProjectId(p[0].id); }).catch(() => {});
    const load = () => jget<Job[]>("/api/jobs").then(setJobs).catch(() => {});
    load();
    const t = setInterval(load, 3000); // the engine updates status in Turso; we poll it
    return () => clearInterval(t);
  }, []);

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      const p = await jpost("/api/projects", { name: f.get("name"), repo: f.get("repo"), defaultBranch: f.get("branch") || "main" }) as Project;
      setProjects((xs) => [p, ...xs]); setProjectId(p.id); setShowAdd(false);
    } catch (err) { alert(String(err)); }
  }
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const p = prompt.trim();
    if (!p || !projectId) return;
    setPrompt("");
    try { await jpost("/api/jobs", { projectId, prompt: p }); jget<Job[]>("/api/jobs").then(setJobs); }
    catch (err) { alert(String(err)); }
  }

  return (
    <div className="wrap">
      <header>
        <span className="logo" /><b>FACTORY</b>
        <span className="tag">control · runs on your machine</span>
      </header>

      <div className="row">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.length === 0 && <option value="">— no projects —</option>}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ⎇ {p.repo}</option>)}
        </select>
        <button className="ghost" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "×" : "+ repo"}</button>
      </div>

      {showAdd && (
        <form onSubmit={addProject} className="add">
          <input name="name" placeholder="name" required />
          <input name="repo" placeholder="owner/repo" required />
          <button type="submit">Add</button>
        </form>
      )}

      <form onSubmit={run} className="row">
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe a job…" disabled={!projectId} />
        <button type="submit" disabled={!projectId}>Queue</button>
      </form>
      <p className="muted section">Jobs queue here and run on your Mac when its engine is online.</p>

      <div className="section">
        {jobs.length === 0 && <p className="muted">No jobs yet.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="job">
            <span className="badge" style={{ borderColor: COLOR[j.status] ?? "#888", color: COLOR[j.status] ?? "#888" }}>{j.status}</span>
            <span className="title">{j.title}</span>
            {j.prUrl && <a className="pr" href={j.prUrl} target="_blank" rel="noreferrer">PR ↗</a>}
            <span className="time">{new Date(j.createdAt).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
