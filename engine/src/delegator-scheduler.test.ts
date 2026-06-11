import { describe, expect, it } from "vitest";
import { pathsOverlap } from "./delegator-scheduler";

// pathsOverlap decides whether two parallel subtasks may collide on files —
// the single gate that keeps concurrent agents off each other's worktree paths.
describe("pathsOverlap", () => {
  it("matches identical paths", () => {
    expect(pathsOverlap(["src/app.ts"], ["src/app.ts"])).toBe(true);
  });

  it("matches a directory against a file inside it, both directions", () => {
    expect(pathsOverlap(["src"], ["src/app.ts"])).toBe(true);
    expect(pathsOverlap(["src/app.ts"], ["src"])).toBe(true);
  });

  it("does not confuse sibling prefixes (src vs src-extra)", () => {
    expect(pathsOverlap(["src"], ["src-extra/app.ts"])).toBe(false);
    expect(pathsOverlap(["src/a"], ["src/ab"])).toBe(false);
  });

  it("reports no overlap for disjoint trees", () => {
    expect(pathsOverlap(["api/routes"], ["web/components"])).toBe(false);
  });

  it("treats empty path lists as non-overlapping", () => {
    expect(pathsOverlap([], ["src"])).toBe(false);
    expect(pathsOverlap([], [])).toBe(false);
  });
});
