import { describe, expect, it } from "vitest";
import { parse } from "./schema";
import {
  CreateChildrenBodySchema,
  CreateJobBodySchema,
  CreateProjectBodySchema,
  ReplyBodySchema,
  SetStatusBodySchema,
} from "./api-schemas";

describe("CreateJobBodySchema", () => {
  it("accepts the UI's minimal payload and applies defaults", () => {
    const r = parse(CreateJobBodySchema, { projectId: "p1", prompt: "build it", title: "Build" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.images).toEqual([]);
      expect(r.value.kind).toBe("");
      expect(r.value.autoRun).toBe(false);
    }
  });

  it("rejects a missing prompt instead of coercing to empty", () => {
    expect(parse(CreateJobBodySchema, { projectId: "p1" }).ok).toBe(false);
    expect(parse(CreateJobBodySchema, { projectId: "p1", prompt: "   " }).ok).toBe(false);
  });

  it("rejects an unknown kind and a non-array images", () => {
    expect(parse(CreateJobBodySchema, { projectId: "p", prompt: "x", kind: "saga" }).ok).toBe(false);
    expect(parse(CreateJobBodySchema, { projectId: "p", prompt: "x", images: "nope" }).ok).toBe(false);
  });

  it("caps images per request", () => {
    const images = Array.from({ length: 21 }, () => "data:image/png;base64,aGk=");
    expect(parse(CreateJobBodySchema, { projectId: "p", prompt: "x", images }).ok).toBe(false);
  });
});

describe("SetStatusBodySchema", () => {
  it("requires a valid status but lets extra job fields pass through", () => {
    const r = parse(SetStatusBodySchema, { status: "completed", error: "" });
    expect(r.ok).toBe(true);
    expect(parse(SetStatusBodySchema, { status: "done" }).ok).toBe(false);
    expect(parse(SetStatusBodySchema, {}).ok).toBe(false);
  });
});

describe("ReplyBodySchema", () => {
  it("requires text or images", () => {
    expect(parse(ReplyBodySchema, { text: "hi" }).ok).toBe(true);
    expect(parse(ReplyBodySchema, { images: ["data:image/png;base64,aGk="] }).ok).toBe(true);
    expect(parse(ReplyBodySchema, { text: "   " }).ok).toBe(false);
    expect(parse(ReplyBodySchema, {}).ok).toBe(false);
  });
});

describe("CreateProjectBodySchema", () => {
  it("requires a name plus either localPath or repo", () => {
    expect(parse(CreateProjectBodySchema, { name: "demo", localPath: "/tmp/x" }).ok).toBe(true);
    expect(parse(CreateProjectBodySchema, { name: "demo", repo: "me/demo" }).ok).toBe(true);
    expect(parse(CreateProjectBodySchema, { name: "demo" }).ok).toBe(false);
    expect(parse(CreateProjectBodySchema, { localPath: "/tmp/x" }).ok).toBe(false);
  });
});

describe("CreateChildrenBodySchema", () => {
  it("bounds the node count and requires titles", () => {
    expect(parse(CreateChildrenBodySchema, { nodes: [] }).ok).toBe(false);
    expect(parse(CreateChildrenBodySchema, { nodes: [{ localId: "a", title: "Task" }] }).ok).toBe(true);
    const nodes = Array.from({ length: 201 }, (_, i) => ({ localId: `t${i}`, title: "x" }));
    expect(parse(CreateChildrenBodySchema, { nodes }).ok).toBe(false);
  });
});
