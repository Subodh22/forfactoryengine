import { z } from "zod";

/**
 * Single source of truth for the Create-Project "factory" pipeline.
 *
 * Philosophy (Pocock spine + Anthropic orchestrator-workers):
 *  - Make illegal states unrepresentable — model phases as a discriminated union.
 *  - Parse, don't validate — the model is an untrusted input source; every step's
 *    output is a zod-validated structured object, never regexed prose.
 *  - Inference over annotation — TS types are derived from the schemas via z.infer.
 *  - Expected failures are typed Results, not thrown exceptions.
 */

// ── Branded ids ───────────────────────────────────────────────────────────────
// Branded so a ProjectId can never be passed where a JobId is expected.
export const JobIdSchema = z.string().min(1).brand<"JobId">();
export type JobId = z.infer<typeof JobIdSchema>;
export const ProjectIdSchema = z.string().min(1).brand<"ProjectId">();
export type ProjectId = z.infer<typeof ProjectIdSchema>;

// ── Build mode: "skippable" expressed as a union, not a boolean flag ───────────
export const BuildModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("guided") }),  // clarify → stack → plan → approve → build
  z.object({ kind: z.literal("express") }), // one coherent build straight from the brief
]);
export type BuildMode = z.infer<typeof BuildModeSchema>;

// ── Clarify step (model asks; user answers) ───────────────────────────────────
export const ClarifyQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  // Optional quick-pick answers the UI can render as chips.
  suggestions: z.array(z.string()).default([]),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

/** What the model returns for the clarify turn — schema-constrained, not prose. */
export const ClarifyOutputSchema = z.object({
  questions: z.array(ClarifyQuestionSchema).max(6),
});
export type ClarifyOutput = z.infer<typeof ClarifyOutputSchema>;

export const ClarifyAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
});
export type ClarifyAnswer = z.infer<typeof ClarifyAnswerSchema>;

// ── Stack proposal: best pick + comparison/tradeoffs ──────────────────────────
export const StackOptionSchema = z.object({
  name: z.string().min(1), // e.g. "Next.js + Postgres + Prisma"
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});
export type StackOption = z.infer<typeof StackOptionSchema>;

export const StackChoiceSchema = z.object({
  recommended: z.string().min(1), // must match one option's `name`
  rationale: z.string().min(1),   // why this one wins for this brief
  options: z.array(StackOptionSchema).min(1), // chosen + alternatives, for the table
});
export type StackChoice = z.infer<typeof StackChoiceSchema>;

// ── Build plan (the epic decomposition, surfaced for human approval) ──────────
// `role` encodes the foundation-first strategy: exactly one "scaffold" subtask
// establishes stack/structure/conventions; "feature" subtasks depend on it so no
// parallel agent ever starts from a blank, conflicting slate.
export const PlanSubtaskSchema = z.object({
  localId: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  role: z.enum(["scaffold", "feature"]).default("feature"),
  touchedPaths: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});
export type PlanSubtask = z.infer<typeof PlanSubtaskSchema>;

export const BuildPlanSchema = z.object({
  summary: z.string().default(""),
  subtasks: z.array(PlanSubtaskSchema).min(1),
});
export type BuildPlan = z.infer<typeof BuildPlanSchema>;

/** What the model returns for the stack+plan turn — one schema-constrained blob. */
export const DiscoveryResultSchema = z.object({
  stack: StackChoiceSchema,
  plan: BuildPlanSchema,
});
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

// ── Pipeline phase: the discriminated union that makes illegal states impossible
// (e.g. you cannot be in `plan_review` without a stack + plan).
export const BuildPhaseSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("clarifying"), questions: z.array(ClarifyQuestionSchema) }),
  z.object({ phase: z.literal("planning") }),
  z.object({ phase: z.literal("plan_review"), stack: StackChoiceSchema, plan: BuildPlanSchema }),
  z.object({ phase: z.literal("building"), stack: StackChoiceSchema, plan: BuildPlanSchema }),
  z.object({ phase: z.literal("done"), prUrl: z.string().optional() }),
  z.object({ phase: z.literal("failed"), error: z.string() }),
]);
export type BuildPhase = z.infer<typeof BuildPhaseSchema>;

// ── API boundary schemas (HTTP bodies) ────────────────────────────────────────
export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  isPrivate: z.boolean().default(true),
  color: z.string().default(""),
  mode: BuildModeSchema.default({ kind: "guided" }),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const ApprovePlanRequestSchema = z.object({
  // Optional edited plan; when omitted we build the plan as proposed.
  plan: BuildPlanSchema.optional(),
});
export type ApprovePlanRequest = z.infer<typeof ApprovePlanRequestSchema>;

// ── Typed Result for expected (non-exceptional) failures ──────────────────────
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Parse unknown (e.g. a model's JSON output) into T as a Result, never throwing. */
export function parse<T>(schema: z.ZodType<T>, data: unknown): Result<T> {
  const r = schema.safeParse(data);
  return r.success ? ok(r.data) : err(z.prettifyError(r.error));
}

// ── Exhaustiveness helper ─────────────────────────────────────────────────────
export function assertNever(x: never): never {
  throw new Error(`Unreachable case: ${JSON.stringify(x)}`);
}
