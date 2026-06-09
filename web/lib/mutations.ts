"use client";
import { api } from "./api";
import type { Job, Project, JobStatus, JobAssignee, Repo } from "./types";

// All mutations go through the engine REST API. State updates arrive back over
// the WebSocket (job.created / job.updated / project.* events), so callers don't
// need to touch local state — they just await and, where useful, use the return.

export interface CreateJobInput {
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

// One node of a hand-authored plan tree. `localId` is a client-side id used to
// wire `parentLocalId` (nesting) and `dependsOn` (run-after) before the real job
// ids exist. Nodes must be sent pre-ordered (each parent before its children).
export interface PlanNode {
  localId: string;
  parentLocalId?: string;
  title: string;
  prompt?: string;
  assignee?: JobAssignee;
  dependsOn?: string[];
}

export const createChildren = (epicId: string, nodes: PlanNode[]) =>
  api<Job[]>(`/api/jobs/${epicId}/children`, { method: "POST", body: JSON.stringify({ nodes }) });

// Tick a manual task off (or reopen it).
export const setTaskDone = (id: string, done: boolean) =>
  setJobStatus(id, done ? "completed" : "pending");

// Edit a task in place — reassign between Claude/you, rename, or re-prompt.
export const patchJob = (id: string, fields: { title?: string; prompt?: string; assignee?: JobAssignee }) =>
  api<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(fields) });

export const setAssignee = (id: string, assignee: JobAssignee) => patchJob(id, { assignee });

export const setJobStatus = (id: string, status: JobStatus, extra: Partial<Job> = {}) =>
  api<Job>(`/api/jobs/${id}/status`, { method: "POST", body: JSON.stringify({ status, ...extra }) });

export const queueJob = (id: string) => api<Job>(`/api/jobs/${id}/queue`, { method: "POST" });
export const requeueJob = (id: string) => api<Job>(`/api/jobs/${id}/requeue`, { method: "POST" });

export const redoJob = (id: string, extraPrompt?: string, extraImages?: string[]) =>
  api<Job>(`/api/jobs/${id}/redo`, { method: "POST", body: JSON.stringify({ extraPrompt, extraImages }) });

export const appendPrompt = (id: string, text: string, images?: string[]) =>
  api<Job>(`/api/jobs/${id}/append`, { method: "POST", body: JSON.stringify({ text, images }) });

export const cancelJob = (id: string) => api<Job>(`/api/jobs/${id}/cancel`, { method: "POST" });
export const cancelEpic = (id: string) => api<Job>(`/api/jobs/${id}/cancel-epic`, { method: "POST" });
export const removeJob = (id: string) => api(`/api/jobs/${id}`, { method: "DELETE" });

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