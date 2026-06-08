"use client";
import { api } from "./api";
import type { Job, Project, JobStatus, Repo } from "./types";

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
  parentJobId?: string;
}

export const createJob = (input: CreateJobInput) =>
  api<Job>("/api/jobs", { method: "POST", body: JSON.stringify(input) });

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

// ── Terminal ─────────────────────────────────────────────────────────────
export const terminalExec = (sessionId: string, cwd: string, command: string) =>
  api("/api/terminal/exec", { method: "POST", body: JSON.stringify({ sessionId, cwd, command }) });

export const terminalKill = (sessionId: string) =>
  api("/api/terminal/kill", { method: "POST", body: JSON.stringify({ sessionId }) });