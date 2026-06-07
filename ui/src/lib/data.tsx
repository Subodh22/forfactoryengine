import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { api, wsUrl, getToken } from "./api";
import type { Job, Project, ChatMsg } from "./types";

// ── Live wire event shapes (mirror engine/src/events.ts) ─────────────────────
type ServerEvent =
  | { type: "hello" }
  | { type: "project.created"; project: Project }
  | { type: "project.updated"; project: Project }
  | { type: "project.removed"; id: string }
  | { type: "job.created"; job: Job }
  | { type: "job.updated"; job: Job }
  | { type: "job.removed"; id: string }
  | { type: "job.output"; jobId: string; chunk: string }
  | { type: "job.chat"; jobId: string; role: "assistant" | "user"; text: string; images?: string[] }
  | { type: "term.output"; sessionId: string; text: string };

interface FactoryCtx {
  ready: boolean;
  needToken: boolean;
  live: boolean;
  projects: Project[];
  jobs: Job[];
  ghLogin: string;
  ghOAuth: boolean;
  setGhLogin: (s: string) => void;
  addJob: (job: Job) => void;
  onOutput: (jobId: string, cb: (chunk: string) => void) => () => void;
  onChat: (jobId: string, cb: (msg: ChatMsg) => void) => () => void;
  onTerm: (sessionId: string, cb: (text: string) => void) => () => void;
}

const Ctx = createContext<FactoryCtx | null>(null);

export function useFactory(): FactoryCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFactory must be used inside <FactoryProvider>");
  return v;
}

type Listeners = Map<string, Set<(arg: never) => void>>;

function addListener<T>(map: Listeners, key: string, cb: (arg: T) => void): () => void {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(cb as (arg: never) => void);
  return () => {
    set!.delete(cb as (arg: never) => void);
    if (set!.size === 0) map.delete(key);
  };
}

function fire<T>(map: Listeners, key: string, arg: T): void {
  const set = map.get(key);
  if (set) for (const cb of set) (cb as (a: T) => void)(arg);
}

export function FactoryProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [needToken, setNeedToken] = useState(false);
  const [live, setLive] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ghLogin, setGhLogin] = useState("");
  const [ghOAuth, setGhOAuth] = useState(false);

  const outputListeners = useRef<Listeners>(new Map());
  const chatListeners = useRef<Listeners>(new Map());
  const termListeners = useRef<Listeners>(new Map());

  // Decide whether a token is needed before loading anything.
  useEffect(() => {
    api<{ authEnabled: boolean }>("/api/config")
      .then((cfg) => { if (cfg.authEnabled && !getToken()) setNeedToken(true); else setReady(true); })
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    api<Project[]>("/api/projects").then(setProjects).catch(() => {});
    api<Job[]>("/api/jobs").then(setJobs).catch(() => {});
    api<{ login: string; oauthConfigured: boolean }>("/api/github/status")
      .then((s) => { setGhLogin(s.login); setGhOAuth(s.oauthConfigured); }).catch(() => {});

    const ws = new WebSocket(wsUrl());
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = (e) => {
      let ev: ServerEvent;
      try { ev = JSON.parse(e.data) as ServerEvent; } catch { return; }
      switch (ev.type) {
        case "project.created": setProjects((p) => [ev.project, ...p.filter((x) => x.id !== ev.project.id)]); break;
        case "project.updated": setProjects((p) => p.map((x) => (x.id === ev.project.id ? ev.project : x))); break;
        case "project.removed": setProjects((p) => p.filter((x) => x.id !== ev.id)); break;
        case "job.created": setJobs((j) => (j.some((x) => x.id === ev.job.id) ? j : [ev.job, ...j])); break;
        case "job.updated": setJobs((j) => (j.some((x) => x.id === ev.job.id) ? j.map((x) => (x.id === ev.job.id ? ev.job : x)) : [ev.job, ...j])); break;
        case "job.removed": setJobs((j) => j.filter((x) => x.id !== ev.id)); break;
        case "job.output": fire(outputListeners.current, ev.jobId, ev.chunk); break;
        case "job.chat": fire<ChatMsg>(chatListeners.current, ev.jobId, { id: `${Date.now()}-${Math.random()}`, role: ev.role, text: ev.text, images: ev.images }); break;
        case "term.output": fire(termListeners.current, ev.sessionId, ev.text); break;
      }
    };
    return () => ws.close();
  }, [ready]);

  const addJob = useCallback((job: Job) => {
    setJobs((j) => (j.some((x) => x.id === job.id) ? j : [job, ...j]));
  }, []);

  const value = useMemo<FactoryCtx>(() => ({
    ready, needToken, live, projects, jobs, ghLogin, ghOAuth, setGhLogin, addJob,
    onOutput: (jobId, cb) => addListener(outputListeners.current, jobId, cb),
    onChat: (jobId, cb) => addListener(chatListeners.current, jobId, cb),
    onTerm: (sessionId, cb) => addListener(termListeners.current, sessionId, cb),
  }), [ready, needToken, live, projects, jobs, ghLogin, ghOAuth, addJob]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── Selector hooks ───────────────────────────────────────────────────────────

export function useProjects(): Project[] {
  return useFactory().projects;
}

export function useProject(id?: string): Project | undefined {
  const { projects } = useFactory();
  return useMemo(() => projects.find((p) => p.id === id), [projects, id]);
}

export function useJobs(projectId?: string): Job[] {
  const { jobs } = useFactory();
  return useMemo(() => (projectId ? jobs.filter((j) => j.projectId === projectId) : jobs), [jobs, projectId]);
}

export function useJob(id?: string): Job | undefined {
  const { jobs } = useFactory();
  return useMemo(() => jobs.find((j) => j.id === id), [jobs, id]);
}

export function useChildren(epicId: string): Job[] {
  const { jobs } = useFactory();
  return useMemo(
    () => jobs.filter((j) => j.parentJobId === epicId).sort((a, b) => a.priority - b.priority),
    [jobs, epicId],
  );
}

/** Accumulate a job's live terminal output while `active`. Output is never
 *  persisted, so a finished job shows nothing — matching the reference. */
export function useJobOutput(jobId: string, active: boolean): string {
  const { onOutput } = useFactory();
  const [output, setOutput] = useState("");
  useEffect(() => {
    setOutput("");
    if (!active) return;
    return onOutput(jobId, (chunk) => setOutput((o) => o + chunk));
  }, [jobId, active, onOutput]);
  return output;
}

/** Live chat-bubble thread for a job (ephemeral; resets when switching jobs). */
export function useJobChat(jobId: string, active: boolean): [ChatMsg[], (m: ChatMsg) => void] {
  const { onChat } = useFactory();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  useEffect(() => { setMessages([]); }, [jobId]);
  useEffect(() => {
    if (!active) return;
    return onChat(jobId, (msg) => setMessages((m) => [...m, msg]));
  }, [jobId, active, onChat]);
  return [messages, (m) => setMessages((prev) => [...prev, m])];
}

export interface TodayStats { inputTokens: number; outputTokens: number; costUsd: number; jobCount: number }

export function useTodayStats(): TodayStats | undefined {
  const [stats, setStats] = useState<TodayStats>();
  const { jobs } = useFactory();
  useEffect(() => {
    const load = () => api<TodayStats>("/api/today-stats").then(setStats).catch(() => {});
    load();
  }, [jobs.length]);
  return stats;
}
