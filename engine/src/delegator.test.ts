import { describe, expect, it } from "vitest";
import { validateDag } from "./delegator";
import type { PlanSubtask } from "./schema";

function st(localId: string, dependsOn: string[] = []): PlanSubtask {
  return { localId, title: localId, prompt: localId, role: "feature", touchedPaths: [], dependsOn } as PlanSubtask;
}

describe("validateDag", () => {
  it("accepts a valid foundation-first DAG", () => {
    expect(() =>
      validateDag([st("scaffold"), st("a", ["scaffold"]), st("b", ["scaffold"])]),
    ).not.toThrow();
  });

  it("accepts a diamond dependency", () => {
    expect(() =>
      validateDag([st("root"), st("a", ["root"]), st("b", ["root"]), st("join", ["a", "b"])]),
    ).not.toThrow();
  });

  it("rejects duplicate subtask ids", () => {
    expect(() => validateDag([st("t1"), st("t1")])).toThrow(/duplicate/);
  });

  it("rejects a dependency on an unknown id", () => {
    expect(() => validateDag([st("t1", ["ghost"])])).toThrow(/unknown id/);
  });

  it("rejects a two-node cycle", () => {
    expect(() => validateDag([st("a", ["b"]), st("b", ["a"])])).toThrow(/cycle/);
  });

  it("rejects a self-dependency", () => {
    expect(() => validateDag([st("a", ["a"])])).toThrow(/cycle/);
  });

  it("rejects a deep cycle behind valid nodes", () => {
    expect(() =>
      validateDag([st("ok"), st("a", ["c"]), st("b", ["a"]), st("c", ["b"])]),
    ).toThrow(/cycle/);
  });
});
