export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_for_input"
  | "clarifying"
  | "plan_review"
  | "delegating";

export interface Project {
  id: string;
  name: string;
  localPath: string;
  repo: string;
  defaultBranch: string;
  githubToken: string;
  agentRules: string;
  color: string;
  sessionPrefix: string;
  createdAt: number;
}

export interface Job {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  images: string[];
  status: JobStatus;
  kind: "epic" | "task" | "";
  parentJobId: string;
  priority: number;
  touchedPaths: string[];
  blockedBy: string[];
  worktreePath: string;
  branch: string;
  prUrl: string;
  prNumber: number;
  error: string;
  sessionId: string;
  delegatorPlan: string;
  needsApproval: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max" | "";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  startedAt: number;
  completedAt: number;
  createdAt: number;
}

export interface Repo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
}

export interface ChatMsg {
  id: string;
  role: "assistant" | "user";
  text: string;
  images?: string[];
}
