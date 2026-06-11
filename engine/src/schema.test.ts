import { describe, expect, it } from "vitest";
import {
  BuildPlanSchema,
  ClarifyOutputSchema,
  DiscoveryResultSchema,
  err,
  ok,
  parse,
} from "./schema";

describe("parse", () => {
  it("returns ok for a valid clarify payload and applies defaults", () => {
    const r = parse(ClarifyOutputSchema, {
      questions: [{ id: "q1", question: "What auth?" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.questions[0].suggestions).toEqual([]);
  });

  it("returns err (never throws) for malformed model output", () => {
    const r = parse(ClarifyOutputSchema, { questions: [{ question: "missing id" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("id");
  });

  it("returns err for non-object junk", () => {
    expect(parse(ClarifyOutputSchema, "not json at all").ok).toBe(false);
    expect(parse(ClarifyOutputSchema, null).ok).toBe(false);
    expect(parse(ClarifyOutputSchema, 42).ok).toBe(false);
  });

  it("caps clarify questions at 6", () => {
    const questions = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, question: "x" }));
    expect(parse(ClarifyOutputSchema, { questions }).ok).toBe(false);
  });
});

describe("BuildPlanSchema", () => {
  it("requires at least one subtask", () => {
    expect(parse(BuildPlanSchema, { summary: "", subtasks: [] }).ok).toBe(false);
  });

  it("defaults role to feature and arrays to empty", () => {
    const r = parse(BuildPlanSchema, {
      subtasks: [{ localId: "t1", title: "Build", prompt: "Do it" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = r.value.subtasks[0];
      expect(s.role).toBe("feature");
      expect(s.touchedPaths).toEqual([]);
      expect(s.dependsOn).toEqual([]);
      expect(r.value.summary).toBe("");
    }
  });

  it("rejects an unknown role", () => {
    const r = parse(BuildPlanSchema, {
      subtasks: [{ localId: "t1", title: "x", prompt: "x", role: "boss" }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("DiscoveryResultSchema", () => {
  const valid = {
    stack: {
      recommended: "Next.js + Postgres",
      rationale: "fits the brief",
      options: [{ name: "Next.js + Postgres", pros: ["fast"], cons: [] }],
    },
    plan: {
      summary: "a todo app",
      subtasks: [
        { localId: "t1", title: "Scaffold", prompt: "scaffold", role: "scaffold", touchedPaths: ["."], dependsOn: [] },
        { localId: "t2", title: "Feature", prompt: "feature", dependsOn: ["t1"] },
      ],
    },
  };

  it("accepts a full stack + plan blob", () => {
    const r = parse(DiscoveryResultSchema, valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.plan.subtasks).toHaveLength(2);
  });

  it("rejects when the stack is missing", () => {
    expect(parse(DiscoveryResultSchema, { plan: valid.plan }).ok).toBe(false);
  });

  it("rejects a stack with zero options", () => {
    const r = parse(DiscoveryResultSchema, {
      ...valid,
      stack: { ...valid.stack, options: [] },
    });
    expect(r.ok).toBe(false);
  });
});

describe("Result helpers", () => {
  it("ok and err produce the discriminated shapes", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });
});
