"use client";
import { api } from "./api";
import type { Job, Project, JobStatus, JobAssignee, Repo } from "./types";

// All mutations go through the engine REST API. State updates arrive back over
// the WebSocket (job.created / job.updated / project.* events), so callers don't
// need to touch local state — they just await and, where useful, use the return.

export interface CreateJobInput {
  id?: string;             // client-provided id so optimistic rows keep their id
  projectId: string;
  title: string;
  prompt: string;
  images?: string[];
  kind?: "epic" | "task" | "";
  model?: string;
  effort?: string;
  autoRun?: boolean;
  needsApproval?: boolean; // guided create: clarify + plan approval before building
  manual?: boolean;        // manual plan: hand-authored epic, no AI planner / queue
  assignee?: JobAssignee;
}

export const createJob = (input: CreateJobInput) =>
  api<Job>("/api/jobs", { method: "POST", body: JSON.stringify(input) });

// ── Optimistic-create gating ─────────────────────────────────────────────────
// When a row is created optimistically (its id exists in the UI before the
// server confirms), an immediate edit/delete could race ahead of the create and
// 404. Track in-flight creates by id; mutations on that id wait for it first.
const pendingCreates = new Map<string, Promise<unknown>>();
export function trackCreate(id: string, p: Promise<unknown>): void {
  const tracked = p.finally(() => { if (pendingCreates.get(id) === tracked) pendingCreates.delete(id); });
  pendingCreates.set(id, tracked);
}
const afterCreate = (id: string) => pendingCreates.get(id)?.catch(() => {}) ?? Promise.resolve();

// One node of a hand-authored plan tree. `localId` is a client-side id used to
// wire `parentLocalId` (nesting) and `dependsOn` (run-after) before the real job
// ids exist. Nodes must be sent pre-ordered (each parent before its children).
export interface PlanNode {
  localId: string;
  id?: string;
  parentLocalId?: string;
  parentJobId?: string;
  title: string;
  prompt?: string;
  assignee?: JobAssignee;
  dependsOn?: string[];
  priority?: number;
}

export const createChildren = (epicId: string, nodes: PlanNode[]) =>
  api<Job[]>(`/api/jobs/${epicId}/children`, { method: "POST", body: JSON.stringify({ nodes }) });

// Add a single task live to a plan and return the created job.
export const addTask = (epicId: string, node: PlanNode) =>
  createChildren(epicId, [node]).then((jobs) => jobs[0]);

// Tick a manual task off (or reopen it).
export const setTaskDone = (id: string, done: boolean) =>
  setJobStatus(id, done ? "completed" : "pending");

// Edit a task in place — reassign between Claude/you, rename, re-prompt, or
// restructure (re-parent for indent/outdent, reorder via priority).
export const patchJob = (
  id: string,
  fields: { title?: string; prompt?: string; assignee?: JobAssignee; parentJobId?: string; priority?: number },
) => afterCreate(id).then(() => api<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(fields) }));

export const setAssignee = (id: string, assignee: JobAssignee) => patchJob(id, { assignee });

// Indent/outdent: move a task under a new parent at a given sort position.
export const reparentTask = (id: string, parentJobId: string, priority: number) =>
  patchJob(id, { parentJobId, priority });

// Reorder a task within its sibling group.
export const reorderTask = (id: string, priority: number) => patchJob(id, { priority });

// Finalize a manual plan: push completed agent work (PR/merge) or mark a pure
// human checklist done. Plans never auto-finalize — this is explicit.
export const finishPlan = (id: string) =>
  api<Job>(`/api/jobs/${id}/finish`, { method: "POST" });

export const setJobStatus = (id: string, status: JobStatus, extra: Partial<Job> = {}) =>
  afterCreate(id).then(() => api<Job>(`/api/jobs/${id}/status`, { method: "POST", body: JSON.stringify({ status, ...extra }) }));

export const queueJob = (id: string) => api<Job>(`/api/jobs/${id}/queue`, { method: "POST" });
export const requeueJob = (id: string) => api<Job>(`/api/jobs/${id}/requeue`, { method: "POST" });

export const redoJob = (id: string, extraPrompt?: string, extraImages?: string[]) =>
  api<Job>(`/api/jobs/${id}/redo`, { method: "POST", body: JSON.stringify({ extraPrompt, extraImages }) });

export const appendPrompt = (id: string, text: string, images?: string[]) =>
  api<Job>(`/api/jobs/${id}/append`, { method: "POST", body: JSON.stringify({ text, images }) });

export const cancelJob = (id: string) => api<Job>(`/api/jobs/${id}/cancel`, { method: "POST" });
export const cancelEpic = (id: string) => api<Job>(`/api/jobs/${id}/cancel-epic`, { method: "POST" });
export const removeJob = (id: string) => afterCreate(id).then(() => api(`/api/jobs/${id}`, { method: "DELETE" }));
// Delete a task and its whole subtree (no DB cascade exists server-side).
export const removeJobCascade = (id: string) => afterCreate(id).then(() => api(`/api/jobs/${id}?cascade=1`, { method: "DELETE" }));

export const sendReply = (id: string, text: string, images: string[]) =>
  api(`/api/jobs/${id}/reply`, { method: "POST", body: JSON.stringify({ text, images }) });

export const approvePlan = (id: string) =>
  api<Job>(`/api/jobs/${id}/approve-plan`, { method: "POST" });

// ── Projects ─────────────────────────────────────────────────────────────────
export interface CreateProjectInput {
  name: string;
  repo?: string;
  localPath?: string;
  defaultBranch?: string;
  agentRules?: string;
  color?: string;
}

export const createProject = (input: CreateProjectInput) =>
  api<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) });

export const updateProject = (id: string, fields: Partial<Project>) =>
  api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(fields) });

export const removeProject = (id: string) => api(`/api/projects/${id}`, { method: "DELETE" });

// ── GitHub ─────────────────────────────────────────────────────────────────
export const connectGithub = (token: string) =>
  api<{ login: string }>("/api/github/connect", { method: "POST", body: JSON.stringify({ token }) });

export const fetchRepos = () => api<{ repos: Repo[] }>("/api/github/repos").then((r) => r.repos);

export interface CreatedRepo { repo: string; defaultBranch: string; htmlUrl: string; localPath: string }
export const createRepo = (name: string, description: string, isPrivate: boolean) =>
  api<CreatedRepo>("/api/projects/create-repo", {
    method: "POST",
    body: JSON.stringify({ name, description, private: isPrivate }),
  });

export const cloneRepo = (repo: string, targetPath?: string) =>
  api<{ localPath: string; alreadyExists?: boolean }>("/api/projects/clone", {
    method: "POST",
    body: JSON.stringify({ repo, targetPath }),
  });

export const seedClaudeMd = (localPath: string, projectName: string, codemapHint: string, agentRules: string) =>
  api("/api/projects/claudemd", {
    method: "POST",
    body: JSON.stringify({ localPath, projectName, codemapHint, agentRules }),
  });

// ── Env editor ────────────────────────────────────────────────────────────
export const getEnv = (localPath: string) =>
  api<{ content: string; exists: boolean; pathMissing?: boolean }>(
    `/api/projects/env?localPath=${encodeURIComponent(localPath)}`,
  );

export const saveEnv = (localPath: string, content: string) =>
  api("/api/projects/env", { method: "POST", body: JSON.stringify({ localPath, content }) });

// Terminal is now an interactive PTY over the /term WebSocket (see TerminalPanel).
