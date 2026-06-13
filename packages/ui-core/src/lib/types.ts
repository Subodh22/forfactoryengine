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
  setupScript: string;   // runs once when a job's worktree is created
  runScript: string;     // launchable dev/run command (Run terminal preset)
  createdAt: number;
}

// Who carries out a task: "" / "agent" → Claude runs it; "human" → you do it by
// hand and tick it off. Only meaningful inside a manual plan.
export type JobAssignee = "" | "agent" | "human";

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
  assignee: JobAssignee;
  worktreePath: string;
  branch: string;
  prUrl: string;
  prNumber: number;
  error: string;
  pushState: "" | "pushing" | "pushed" | "needs_help";
  pushAttempts: number;
  pushError: string;
  pushedSha: string;
  pushedTo: string;
  sessionId: string;
  commitSha: string;
  delegatorPlan: string;
  needsApproval: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max" | "";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  mergedToMain: boolean;
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

/** GET /api/jobs/:id/diff — what a job changed, across its whole lifecycle. */
export interface JobDiff {
  source: "worktree" | "commit" | "branch" | "none";
  stat: string;
  patch: string;
  truncated: boolean;
}
