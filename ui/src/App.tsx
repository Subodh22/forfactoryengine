import { useEffect, useRef, useState } from "react";

interface Project { id: string; name: string; localPath: string; defaultBranch: string; }
interface Job {
  id: string; projectId: string; title: string; prompt: string;
  status: "pending" | "running" | "done" | "failed"; branch: string; error: string; createdAt: number;
}
type ServerEvent =
  | { type: "hello" }
  | { type: "project.created"; project: Project }
  | { type: "job.created"; job: Job }
  | { type: "job.updated"; job: Job }
  | { type: "job.output"; jobId: string; chunk: string };

const STATUS_COLOR: Record<Job["status"], string> = {
  pending: "#888", running: "#e0a32e", done: "#3bd16f", failed: "#d6210f",
};

function clean(raw: string): string {
  if (raw.startsWith("\x00tool\x00")) return raw.slice(7);
  if (raw.startsWith("\x00bash\x00")) return "$ " + raw.slice(7);
  if (raw.startsWith("\x00stderr\x00")) return raw.slice(9);
  return raw;
}

// ── auth: token lives in localStorage and rides every API + WS call ──
const tokenKey = "factory-token";
const getToken = () => localStorage.getItem(tokenKey) ?? "";
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
async function api(path: string, opts: RequestInit = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (r.status === 401) { localStorage.removeItem(tokenKey); location.reload(); throw new Error("unauthorized"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

export function App() {
  const [ready, setReady] = useState(false);
  const [needToken, setNeedToken] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [live, setLive] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Decide whether a token is required before loading anything.
  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((cfg: { authEnabled: boolean }) => {
      if (cfg.authEnabled && !getToken()) setNeedToken(true);
      else setReady(true);
    }).catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    api("/api/projects").then((p: Project[]) => { setProjects(p); if (p[0]) setProjectId(p[0].id); }).catch(() => {});
    api("/api/jobs").then(setJobs).catch(() => {});

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const t = getToken();
    const ws = new WebSocket(`${proto}://${location.host}/ws${t ? `?token=${encodeURIComponent(t)}` : ""}`);
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.type === "project.created") setProjects((p) => [ev.project, ...p]);
      else if (ev.type === "job.created") setJobs((j) => (j.some((x) => x.id === ev.job.id) ? j : [ev.job, ...j]));
      else if (ev.type === "job.updated") setJobs((j) => j.map((x) => (x.id === ev.job.id ? ev.job : x)));
      else if (ev.type === "job.output") setOutput((o) => ({ ...o, [ev.jobId]: (o[ev.jobId] ?? "") + ev.chunk }));
    };
    return () => ws.close();
  }, [ready]);

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [output, selected]);

  if (needToken) {
    return (
      <div className="wrap">
        <header><span className="logo" /><b>FACTORY</b><span className="tag">sign in</span></header>
        <form
          className="composer" style={{ marginTop: 24 }}
          onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.target as HTMLFormElement).get("t") as string).trim(); if (v) { localStorage.setItem(tokenKey, v); location.reload(); } }}
        >
          <input name="t" type="password" placeholder="Access token" autoFocus />
          <button type="submit">Enter</button>
        </form>
      </div>
    );
  }
  if (!ready) return <div className="wrap"><p className="empty">Loading…</p></div>;

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      const p = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: f.get("name"), localPath: f.get("localPath"), defaultBranch: f.get("defaultBranch") || "main" }) }) as Project;
      setProjectId(p.id); setShowAdd(false);
    } catch (err) { alert(String(err)); }
  }
  async function run(e: React.FormEvent) {
    e.preventDefault();
    const p = prompt.trim();
    if (!p || !projectId) return;
    setPrompt("");
    try { const job = await api("/api/jobs", { method: "POST", body: JSON.stringify({ projectId, prompt: p }) }) as Job; setSelected(job.id); }
    catch (err) { alert(String(err)); }
  }

  return (
    <div className="wrap">
      <header>
        <span className="logo" /><b>FACTORY</b>
        <span className="tag">ENGINE · libSQL + WS</span>
        <span className="live" style={{ opacity: live ? 1 : 0.3 }}>● {live ? "live" : "offline"}</span>
      </header>

      <div className="projbar">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.length === 0 && <option value="">— no projects —</option>}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "×" : "+ project"}</button>
      </div>

      {showAdd && (
        <form onSubmit={addProject} className="addproj">
          <input name="name" placeholder="Project name" required />
          <input name="localPath" placeholder="/absolute/path/to/repo" required />
          <input name="defaultBranch" placeholder="main" defaultValue="main" />
          <button type="submit">Add</button>
        </form>
      )}

      <form onSubmit={run} className="composer">
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe a job…" disabled={!projectId} />
        <button type="submit" disabled={!projectId}>Run</button>
      </form>

      <div className="cols">
        <div className="list">
          {jobs.length === 0 && <p className="empty">No jobs yet.</p>}
          {jobs.map((j) => (
            <div key={j.id} className={`job ${selected === j.id ? "sel" : ""}`} onClick={() => setSelected(j.id)}>
              <span className="badge" style={{ borderColor: STATUS_COLOR[j.status], color: STATUS_COLOR[j.status] }}>{j.status}</span>
              <span className="title">{j.title}</span>
              <span className="time">{new Date(j.createdAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
        {selected && (
          <div className="detail">
            <pre className="term">
              {(output[selected] ?? "streaming…").split("\n").map((l, i) => <span key={i}>{clean(l)}{"\n"}</span>)}
              <div ref={bottomRef} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
