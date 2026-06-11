import { z } from "zod";

/**
 * REST request-body schemas — the HTTP twin of schema.ts (which guards model
 * output). Every POST/PATCH body is parsed through one of these before any
 * handler logic runs; unknown shapes become a 400 with a readable error
 * instead of silently coercing to "" and corrupting state downstream.
 */

export const JobStatusSchema = z.enum([
  "pending", "queued", "running", "completed", "failed", "cancelled",
  "waiting_for_input", "clarifying", "plan_review", "delegating",
]);

const JobKindSchema = z.enum(["epic", "task"]).or(z.literal(""));
const JobEffortSchema = z.enum(["low", "medium", "high", "max"]).or(z.literal(""));
const JobAssigneeSchema = z.enum(["agent", "human"]).or(z.literal(""));
// Attachments are bounded per request — base64 blobs live in the DB, so an
// unbounded array is a one-request memory/storage DoS.
const ImagesSchema = z.array(z.string()).max(20);

export const CreateJobBodySchema = z.object({
  id: z.string().optional(), // client-provided id for optimistic UI rows
  projectId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  title: z.string().trim().default(""),
  kind: JobKindSchema.default(""),
  images: ImagesSchema.default([]),
  assignee: JobAssigneeSchema.default(""),
  manual: z.boolean().default(false),
  autoRun: z.boolean().default(false),
  status: z.string().default(""), // only "queued" is meaningful (legacy autoRun spelling)
  model: z.string().default(""),
  effort: JobEffortSchema.default(""),
  needsApproval: z.boolean().default(false),
});
export type CreateJobBody = z.infer<typeof CreateJobBodySchema>;

export const PatchJobBodySchema = z.object({
  title: z.string().optional(),
  prompt: z.string().optional(),
  assignee: JobAssigneeSchema.optional(),
  priority: z.number().finite().optional(),
  parentJobId: z.string().optional(),
});
export type PatchJobBody = z.infer<typeof PatchJobBodySchema>;

// setJobStatus() spreads extra Partial<Job> fields into the body, so this stays
// loose; patchJob's column allow-list bounds what the extras can touch.
export const SetStatusBodySchema = z.looseObject({ status: JobStatusSchema });

export const ReplyBodySchema = z.object({
  text: z.string().default(""),
  images: ImagesSchema.default([]),
}).refine((b) => b.text.trim() || b.images.length, { message: "text or images required" });

export const AppendBodySchema = z.object({
  text: z.string().default(""),
  images: ImagesSchema.optional(),
});

export const RedoBodySchema = z.object({
  extraPrompt: z.string().optional(),
  extraImages: ImagesSchema.optional(),
});

const PlanNodeSchema = z.object({
  localId: z.string().min(1),
  parentLocalId: z.string().optional(),
  title: z.string().min(1),
  prompt: z.string().optional(),
  assignee: JobAssigneeSchema.optional(),
  touchedPaths: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: z.number().optional(),
  parentJobId: z.string().optional(),
  id: z.string().optional(),
});
export const CreateChildrenBodySchema = z.object({
  nodes: z.array(PlanNodeSchema).min(1).max(200),
});

export const CreateProjectBodySchema = z.object({
  name: z.string().trim().min(1),
  localPath: z.string().trim().default(""),
  repo: z.string().trim().default(""),
  defaultBranch: z.string().trim().min(1).default("main"),
  githubToken: z.string().default(""),
  agentRules: z.string().default(""),
  color: z.string().default(""),
}).refine((b) => b.localPath || b.repo, { message: "localPath or repo required" });
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const UpdateProjectBodySchema = z.object({
  name: z.string().optional(),
  localPath: z.string().optional(),
  repo: z.string().optional(),
  defaultBranch: z.string().optional(),
  githubToken: z.string().optional(),
  agentRules: z.string().optional(),
  color: z.string().optional(),
  sessionPrefix: z.string().optional(),
});

export const GithubConnectBodySchema = z.object({ token: z.string().trim().min(1) });

export const CloneBodySchema = z.object({
  repo: z.string().trim().min(1),
  targetPath: z.string().default(""),
});

export const CreateRepoBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(""),
  private: z.boolean().default(true),
});

export const ClaudeMdBodySchema = z.object({
  localPath: z.string().min(1),
  projectName: z.string().default("Project"),
  codemapHint: z.string().default(""),
  agentRules: z.string().default(""),
});

export const EnvWriteBodySchema = z.object({
  localPath: z.string().min(1),
  content: z.string(),
});
