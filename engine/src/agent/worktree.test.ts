import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { commitOnly, createWorktree, getJobDiff, removeWorktree } from "./worktree";

// Exercises the diff endpoint's git logic against a real throwaway repo,
// across the job lifecycle the UI's Changes tab walks through.
let repo: string;

function sh(cmd: string, cwd: string) {
  execSync(cmd, { cwd, stdio: "pipe" });
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "factory-wt-"));
  sh("git init -b main", repo);
  sh('git config user.email "test@factory.local" && git config user.name "factory-test"', repo);
  fs.writeFileSync(path.join(repo, "app.txt"), "hello\n");
  sh("git add -A && git commit -m init", repo);
});

describe("getJobDiff", () => {
  it("shows live uncommitted work, then the recorded commit after cleanup", () => {
    const { worktreePath, branch } = createWorktree(repo, "job-1", "main");

    // Live worktree: a modified file AND an untracked file must both appear.
    fs.writeFileSync(path.join(worktreePath, "app.txt"), "hello\nworld\n");
    fs.writeFileSync(path.join(worktreePath, "new.txt"), "fresh\n");
    const live = getJobDiff(repo, { worktreePath, branch }, "main");
    expect(live.source).toBe("worktree");
    expect(live.patch).toContain("+world");
    expect(live.patch).toContain("new.txt");
    expect(live.truncated).toBe(false);

    // Completed: the commit recorded at completion survives worktree removal.
    const sha = commitOnly(worktreePath, "feat: change");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    removeWorktree(repo, worktreePath);
    const done = getJobDiff(repo, { commitSha: sha! }, "main");
    expect(done.source).toBe("commit");
    expect(done.patch).toContain("+world");
    expect(done.stat).toContain("app.txt");
  });

  it("falls back to a surviving branch, then to none", () => {
    const { worktreePath, branch } = createWorktree(repo, "job-2", "main");
    fs.writeFileSync(path.join(worktreePath, "branch.txt"), "branch work\n");
    commitOnly(worktreePath, "feat: branch work");
    removeWorktree(repo, worktreePath);

    const viaBranch = getJobDiff(repo, { branch }, "main");
    expect(viaBranch.source).toBe("branch");
    expect(viaBranch.patch).toContain("+branch work");

    expect(getJobDiff(repo, {}, "main").source).toBe("none");
    expect(getJobDiff(repo, { commitSha: "deadbeef" }, "main").source).toBe("none");
  });

  it("commitOnly returns null when there is nothing to commit", () => {
    const { worktreePath } = createWorktree(repo, "job-3", "main");
    expect(commitOnly(worktreePath, "noop")).toBeNull();
    removeWorktree(repo, worktreePath);
  });
});
