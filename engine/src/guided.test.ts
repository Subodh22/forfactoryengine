import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readJsonArtifact } from "./guided";

// readJsonArtifact is the fallback chain that turns a model turn into JSON:
// .factory/<file> on disk → fenced block in the reply → embedded {...} → throw.
let worktree: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), "factory-guided-"));
});

function writeArtifact(file: string, content: string) {
  fs.mkdirSync(path.join(worktree, ".factory"), { recursive: true });
  fs.writeFileSync(path.join(worktree, ".factory", file), content);
}

describe("readJsonArtifact", () => {
  it("prefers the .factory artifact on disk", () => {
    writeArtifact("clarify.json", JSON.stringify({ questions: [] }));
    const out = readJsonArtifact(worktree, "clarify.json", "ignore this prose");
    expect(out).toEqual({ questions: [] });
  });

  it("falls back to a fenced JSON block in the reply", () => {
    const reply = 'Here you go:\n```json\n{ "a": 1 }\n```\nDone.';
    expect(readJsonArtifact(worktree, "missing.json", reply)).toEqual({ a: 1 });
  });

  it("falls back to an unfenced fence without a language tag", () => {
    const reply = '```\n{ "b": 2 }\n```';
    expect(readJsonArtifact(worktree, "missing.json", reply)).toEqual({ b: 2 });
  });

  it("extracts embedded JSON from surrounding prose", () => {
    const reply = 'Sure! The plan is { "c": [1, 2] } — let me know.';
    expect(readJsonArtifact(worktree, "missing.json", reply)).toEqual({ c: [1, 2] });
  });

  it("recovers when the disk artifact has prose around the JSON", () => {
    writeArtifact("plan.json", 'note from the model\n{ "d": true }\ntrailing');
    expect(readJsonArtifact(worktree, "plan.json", "")).toEqual({ d: true });
  });

  it("throws when there is no JSON anywhere", () => {
    expect(() => readJsonArtifact(worktree, "missing.json", "I could not produce a plan."))
      .toThrow();
  });

  it("throws on an empty reply", () => {
    expect(() => readJsonArtifact(worktree, "missing.json", "")).toThrow(/no JSON/);
  });
});
