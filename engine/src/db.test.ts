import { beforeAll, describe, expect, it } from "vitest";
import {
  MANUAL_PLAN_MARKER,
  appendPrompt,
  createChildren,
  createJob,
  createProject,
  descendantsOf,
  getJob,
  getProject,
  initSchema,
  isManualEpic,
  patchJob,
  redoJob,
  requeueJob,
  rootEpicOf,
  updateProject,
} from "./db";

// test-setup.ts points FACTORY_DATA_DIR at a fresh temp dir, so this exercises
// the real libSQL file driver — schema, JSON columns, and the job lifecycle.
beforeAll(async () => {
  await initSchema();
  await initSchema(); // running migrations twice must be a no-op, not an error
});

describe("projects", () => {
  it("creates, reads and patches a project", async () => {
    const p = await createProject({ name: "demo", localPath: "/tmp/demo" });
    expect((await getProject(p.id))?.name).toBe("demo");

    await updateProject(p.id, { defaultBranch: "trunk", githubToken: "tok" });
    const updated = await getProject(p.id);
    expect(updated?.defaultBranch).toBe("trunk");
    expect(updated?.githubToken).toBe("tok");
  });
});

describe("job lifecycle", () => {
  it("round-trips a job including JSON columns", async () => {
    const job = await createJob({
      projectId: "p1",
      title: "Build it",
      prompt: "do the thing",
      images: ["data:image/png;base64,aGk="],
      touchedPaths: ["src", "lib/util.ts"],
      blockedBy: ["other-id"],
      effort: "high",
      needsApproval: true,
    });
    const got = await getJob(job.id);
    expect(got).not.toBeNull();
    expect(got!.images).toEqual(["data:image/png;base64,aGk="]);
    expect(got!.touchedPaths).toEqual(["src", "lib/util.ts"]);
    expect(got!.blockedBy).toEqual(["other-id"]);
    expect(got!.effort).toBe("high");
    expect(got!.needsApproval).toBe(true);
    expect(got!.status).toBe("pending");
  });

  it("patchJob writes scalars, booleans and JSON columns", async () => {
    const job = await createJob({ projectId: "p1", title: "patch me", prompt: "x" });
    await patchJob(job.id, {
      status: "running",
      branch: "factory/abc",
      mergedToMain: true,
      touchedPaths: ["a", "b"],
    });
    const got = await getJob(job.id);
    expect(got!.status).toBe("running");
    expect(got!.branch).toBe("factory/abc");
    expect(got!.mergedToMain).toBe(true);
    expect(got!.touchedPaths).toEqual(["a", "b"]);
  });

  it("patchJob ignores unknown fields instead of corrupting SQL", async () => {
    const job = await createJob({ projectId: "p1", title: "safe", prompt: "x" });
    await patchJob(job.id, { nope: "ignored" } as unknown as Partial<import("./db").Job>);
    expect((await getJob(job.id))!.title).toBe("safe");
  });

  it("requeueJob resets per-run state", async () => {
    const job = await createJob({ projectId: "p1", title: "rerun", prompt: "x" });
    await patchJob(job.id, { status: "failed", error: "boom", prUrl: "u", prNumber: 7, mergedToMain: true });
    await requeueJob(job.id);
    const got = await getJob(job.id);
    expect(got!.status).toBe("queued");
    expect(got!.error).toBe("");
    expect(got!.prUrl).toBe("");
    expect(got!.prNumber).toBe(0);
    expect(got!.mergedToMain).toBe(false);
  });

  it("redoJob clones into a fresh queued job with a Redo: title", async () => {
    const src = await createJob({ projectId: "p1", title: "feature", prompt: "build X" });
    const redo = await redoJob(src.id, "also handle Y", ["data:image/png;base64,Zg=="]);
    expect(redo.id).not.toBe(src.id);
    expect(redo.title).toBe("Redo: feature");
    expect(redo.prompt).toBe("build X\n\nalso handle Y");
    expect(redo.images).toEqual(["data:image/png;base64,Zg=="]);
    expect(redo.status).toBe("queued");
    expect((await getJob(src.id))!.title).toBe("feature"); // original untouched
  });

  it("appendPrompt works before start and refuses after", async () => {
    const job = await createJob({ projectId: "p1", title: "append", prompt: "base" });
    await appendPrompt(job.id, "more detail");
    expect((await getJob(job.id))!.prompt).toBe("base\n\nmore detail");

    await patchJob(job.id, { status: "running" });
    await expect(appendPrompt(job.id, "too late")).rejects.toThrow(/before a job starts/);
  });
});

describe("epic trees", () => {
  it("createChildren wires blockedBy from planner local ids", async () => {
    const epic = await createJob({ projectId: "p1", title: "epic", prompt: "x", kind: "epic" });
    const ids = await createChildren(epic.id, [
      { localId: "t1", title: "Scaffold", prompt: "s", touchedPaths: ["."], dependsOn: [] },
      { localId: "t2", title: "Feature A", prompt: "a", touchedPaths: ["src/a"], dependsOn: ["t1"] },
      { localId: "t3", title: "Feature B", prompt: "b", touchedPaths: ["src/b"], dependsOn: ["t1", "t2"] },
    ]);
    expect(ids).toHaveLength(3);
    const [t1, t2, t3] = await Promise.all(ids.map((id) => getJob(id)));
    expect(t1!.blockedBy).toEqual([]);
    expect(t2!.blockedBy).toEqual([t1!.id]);
    expect(t3!.blockedBy).toEqual([t1!.id, t2!.id]);
    expect(t2!.parentJobId).toBe(epic.id);
  });

  it("descendantsOf walks nesting and survives a corrupt parent cycle", async () => {
    const epic = await createJob({ projectId: "p1", title: "root", prompt: "x", kind: "epic" });
    const mid = await createJob({ projectId: "p1", title: "mid", prompt: "x", kind: "task", parentJobId: epic.id });
    const leaf = await createJob({ projectId: "p1", title: "leaf", prompt: "x", kind: "task", parentJobId: mid.id });

    const all = await descendantsOf(epic.id);
    expect(all.map((j) => j.id).sort()).toEqual([mid.id, leaf.id].sort());

    // Corrupt re-parent: epic becomes a child of its own leaf — must terminate.
    await patchJob(epic.id, { parentJobId: leaf.id });
    const cyclic = await descendantsOf(epic.id);
    expect(cyclic.length).toBeGreaterThanOrEqual(2);
  });

  it("rootEpicOf resolves the owning epic through nesting", async () => {
    const epic = await createJob({ projectId: "p1", title: "epic", prompt: "x", kind: "epic" });
    const mid = await createJob({ projectId: "p1", title: "mid", prompt: "x", kind: "task", parentJobId: epic.id });
    const leaf = await createJob({ projectId: "p1", title: "leaf", prompt: "x", kind: "task", parentJobId: mid.id });

    expect((await rootEpicOf(leaf))?.id).toBe(epic.id);
    expect((await rootEpicOf(epic))?.id).toBe(epic.id);

    const standalone = await createJob({ projectId: "p1", title: "solo", prompt: "x" });
    expect(await rootEpicOf(standalone)).toBeNull();
  });

  it("isManualEpic detects only the manual marker on epics", async () => {
    const manual = await createJob({
      projectId: "p1", title: "plan", prompt: "x", kind: "epic", delegatorPlan: MANUAL_PLAN_MARKER,
    });
    const ai = await createJob({
      projectId: "p1", title: "ai", prompt: "x", kind: "epic", delegatorPlan: JSON.stringify({ subtasks: [] }),
    });
    const task = await createJob({
      projectId: "p1", title: "t", prompt: "x", kind: "task", delegatorPlan: MANUAL_PLAN_MARKER,
    });
    expect(isManualEpic(manual)).toBe(true);
    expect(isManualEpic(ai)).toBe(false);
    expect(isManualEpic(task)).toBe(false);
  });
});
