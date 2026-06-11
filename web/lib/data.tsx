"use client";
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
  /** Bumped on every WebSocket reconnect — open panels use it to re-pull
   *  persisted state that streamed past while the socket was down. */
  wsEpoch: number;
  projects: Project[];
  jobs: Job[];
  ghLogin: string;
  ghOAuth: boolean;
  setGhLogin: (s: string) => void;
  addJob: (job: Job) => void;
  dropJob: (id: string) => void;
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
  const [wsEpoch, setWsEpoch] = useState(0);

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

    const loadSnapshot = () => {
      api<Project[]>("/api/projects").then(setProjects).catch(() => {});
      api<Job[]>("/api/jobs").then(setJobs).catch(() => {});
      api<{ login: string; oauthConfigured: boolean }>("/api/github/status")
        .then((s) => { setGhLogin(s.login); setGhOAuth(s.oauthConfigured); }).catch(() => {});
    };
    loadSnapshot();

    // Reconnect with exponential backoff. The server has no event replay, so a
    // successful reconnect refetches the snapshot (events missed while down)
    // and bumps wsEpoch so open panels re-pull their persisted logs.
    let ws: WebSocket | null = null;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        setLive(true);
        if (attempts > 0) { loadSnapshot(); setWsEpoch((n) => n + 1); }
        attempts = 0;
      };
      ws.onclose = () => {
        setLive(false);
        if (disposed) return;
        const delay = Math.min(1000 * 2 ** attempts, 30_000) + Math.random() * 250;
        attempts += 1;
        timer = setTimeout(connect, delay);
      };
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
    };
    connect();

    return () => { disposed = true; clearTimeout(timer); ws?.close(); };
  }, [ready]);

  const addJob = useCallback((job: Job) => {
    setJobs((j) => (j.some((x) => x.id === job.id) ? j : [job, ...j]));
  }, []);
  // Remove a job locally — used to roll back an optimistic create that failed.
  const dropJob = useCallback((id: string) => {
    setJobs((j) => j.filter((x) => x.id !== id));
  }, []);

  const value = useMemo<FactoryCtx>(() => ({
    ready, needToken, live, wsEpoch, projects, jobs, ghLogin, ghOAuth, setGhLogin, addJob, dropJob,
    onOutput: (jobId, cb) => addListener(outputListeners.current, jobId, cb),
    onChat: (jobId, cb) => addListener(chatListeners.current, jobId, cb),
    onTerm: (sessionId, cb) => addListener(termListeners.current, sessionId, cb),
  }), [ready, needToken, live, wsEpoch, projects, jobs, ghLogin, ghOAuth, addJob, dropJob]);

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

/** Every descendant of a job at any depth — used for subtree progress rollups. */
export function useDescendants(rootId: string): Job[] {
  const { jobs } = useFactory();
  return useMemo(() => {
    const byParent = new Map<string, Job[]>();
    for (const j of jobs) {
      const arr = byParent.get(j.parentJobId);
      if (arr) arr.push(j); else byParent.set(j.parentJobId, [j]);
    }
    const out: Job[] = [];
    const stack = [...(byParent.get(rootId) ?? [])];
    while (stack.length) {
      const j = stack.shift()!;
      out.push(j);
      stack.push(...(byParent.get(j.id) ?? []));
    }
    return out;
  }, [jobs, rootId]);
}

/** A job's terminal output. The persisted log is fetched on open (so finished
 *  jobs and reloads replay full history), then live chunks are tailed while the
 *  job is running (`live`). Subscribing only after the backfill resolves avoids
 *  duplicating chunks that are already in the persisted log. */
export function useJobOutput(jobId: string, live: boolean): string {
  const { onOutput, wsEpoch } = useFactory();
  const [output, setOutput] = useState("");
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    const tail = () => { off = onOutput(jobId, (chunk) => setOutput((o) => o + chunk)); };
    setOutput("");
    api<{ output: string }>(`/api/jobs/${jobId}/output`)
      .then((r) => { if (cancelled) return; setOutput(r.output); if (live) tail(); })
      .catch(() => { if (!cancelled && live) tail(); });
    return () => { cancelled = true; off?.(); };
    // wsEpoch: after a reconnect, re-pull the durable log to recover chunks
    // that streamed while the socket was down, then resubscribe.
  }, [jobId, live, onOutput, wsEpoch]);
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
