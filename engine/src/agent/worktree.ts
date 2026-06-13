import { execSync, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

function git(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function resolveRepo(repoPath: string): string {
  const trimmed = repoPath.trim();
  // Windows absolute path (e.g. C:\...) should never be passed through path.resolve
  // on a non-Windows host — it would prepend the CWD and produce a garbage path.
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed.replace(/\//g, path.sep);
  return path.resolve(trimmed);
}

function sleepSync(ms: number): void {
  // Synchronous sleep without busy-spinning the CPU.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Checks whether the repo directory exists, tolerant of transient Windows
 * filesystem errors.
 *
 * `fs.existsSync` returns false on ANY stat error, not just ENOENT. On Windows,
 * a stat right after `git worktree remove`/`prune` (or while antivirus/the
 * indexer is touching freshly written files) can briefly fail with EBUSY /
 * EPERM / a sharing violation — which would make us wrongly conclude the repo
 * vanished and FATAL the job. So we only treat ENOENT as "missing" and retry
 * transient errors a few times before giving the path the benefit of the doubt.
 */
function repoExists(dir: string): boolean {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.statSync(dir);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false; // genuinely missing
      sleepSync(150 * (attempt + 1)); // transient lock — back off and retry
    }
  }
  // Persistent non-ENOENT error: assume the path is there but momentarily
  // locked rather than failing the whole job.
  return true;
}

/** Where repos get cloned when a project has no explicit local path. Mirrors the
 *  default used by /api/projects/clone, but resolved on the WORKER's machine. */
export function defaultWorkspace(): string {
  return process.env.FACTORY_WORKSPACE ?? path.join(os.homedir(), "factory-workspace");
}

/**
 * Ensure the project's repo is present on this machine and return its path.
 *
 * The web UI may be hosted remotely (e.g. Vercel), where it cannot clone onto
 * the worker's disk — so a project can reach the worker with no usable
 * `localPath`. In that case we clone `<repo>` into the workspace here, on the
 * machine that actually runs jobs. If `localPath` already exists, it's used
 * as-is (no network call).
 */
export function ensureRepoCloned(opts: {
  repo: string;
  localPath?: string;
  githubToken?: string;
}): string {
  const { repo, localPath, githubToken } = opts;

  if (localPath?.trim() && repoExists(resolveRepo(localPath))) {
    return resolveRepo(localPath);
  }

  if (!repo || !repo.includes("/")) {
    // Nothing to clone from — honour whatever path we were given, or give up.
    if (localPath?.trim()) return resolveRepo(localPath);
    throw new Error("Project has no local path and no clonable repo");
  }

  const repoName = repo.split("/")[1];
  const dest = localPath?.trim()
    ? resolveRepo(localPath)
    : path.join(defaultWorkspace(), repoName);

  if (repoExists(dest)) return dest;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = githubToken
    ? `https://${githubToken}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;
  const result = git(["clone", url, dest], path.dirname(dest));
  if (result.status !== 0) {
    // Strip the token from any echoed URL before surfacing the error.
    const safeErr = (result.stderr || result.stdout).split(githubToken ?? "\0").join("***");
    throw new Error(`git clone failed: ${safeErr}`);
  }
  return dest;
}

export function createWorktree(repoPath: string, jobId: string, baseBranch: string): { worktreePath: string; branch: string } {
  const normalizedRepo = resolveRepo(repoPath);
  if (!repoExists(normalizedRepo)) {
    throw new Error(`Repo path does not exist: ${normalizedRepo}`);
  }

  const branch = `job/${jobId}`;
  const worktreePath = path.join(normalizedRepo, ".worktrees", jobId);
  const worktreesDir = path.join(normalizedRepo, ".worktrees");

  // A previous engine that crashed mid-job leaves this worktree behind — its
  // cleanup `finally` never ran. `git worktree add` then fails with "already
  // exists". Clear any stale copy first so a recovered job starts clean.
  git(["worktree", "remove", "--force", worktreePath], normalizedRepo);
  git(["worktree", "prune"], normalizedRepo);
  if (repoExists(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true });

  try {
    fs.mkdirSync(worktreesDir, { recursive: true });
  } catch {
    // Fallback for Windows when fs.mkdirSync recursive fails
    spawnSync("powershell", ["-Command", `New-Item -ItemType Directory -Force -Path "${worktreesDir}"`], { stdio: "pipe" });
    if (!fs.existsSync(worktreesDir)) {
      throw new Error(`Failed to create worktrees directory: ${worktreesDir}`);
    }
  }

  let result = git(["worktree", "add", "-b", branch, worktreePath, baseBranch], normalizedRepo);

  if (result.status !== 0) {
    // Branch already exists — attach the worktree to the existing branch
    if (result.stderr.includes("already exists")) {
      result = git(["worktree", "add", worktreePath, branch], normalizedRepo);
    }
    if (result.status !== 0) {
      throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
    }
  }

  return { worktreePath, branch };
}

export function removeWorktree(repoPath: string, worktreePath: string) {
  try {
    git(["worktree", "remove", "--force", worktreePath], repoPath);
    git(["worktree", "prune"], repoPath);
  } catch {
    // ignore cleanup errors
  }
}

export function getChangedFiles(worktreePath: string): string[] {
  try {
    // `git status --porcelain` lists modified AND untracked (new) files — unlike
    // `git diff --name-only HEAD`, which silently omits brand-new files. Each line
    // is "XY path", so we slice off the 3-char status prefix.
    const result = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf8" });
    return result.split("\n").filter(Boolean).map((l) => l.slice(3).trim());
  } catch {
    return [];
  }
}

// ── File explorer ("All files" tab) ──────────────────────────────────────────
const FILE_IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".worktrees",
  ".turbo", "out", ".cache", "__pycache__", ".venv", "venv", ".idea", ".vscode",
]);

/** Recursively list relative file paths under a root, skipping heavy/ignored
 *  dirs and capping the total so a huge repo can't blow the response. */
export function listFilesIn(rootPath: string, max = 4000): { files: string[]; truncated: boolean } {
  const root = resolveRepo(rootPath);
  const out: string[] = [];
  let truncated = false;
  const walk = (dir: string) => {
    if (out.length >= max) { truncated = true; return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) { truncated = true; return; }
      if (e.name === ".git") continue;
      if (e.isDirectory()) {
        if (FILE_IGNORE.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        out.push(path.relative(root, path.join(dir, e.name)));
      }
    }
  };
  walk(root);
  return { files: out, truncated };
}

// ── Checkpoints ──────────────────────────────────────────────────────────────
/**
 * Snapshot the worktree's full state (tracked + untracked) as a dangling commit
 * WITHOUT moving HEAD or the branch — so checkpoints never interfere with the
 * branch/commit/push flow. Returns the snapshot commit sha, or null if nothing
 * to snapshot.
 */
export function createCheckpoint(worktreePath: string, message: string): string | null {
  if (!repoExists(worktreePath)) return null;
  if (git(["add", "-A"], worktreePath).status !== 0) return null;
  const tree = git(["write-tree"], worktreePath);
  if (tree.status !== 0) return null;
  const treeSha = tree.stdout.trim();
  const head = git(["rev-parse", "HEAD"], worktreePath);
  const parent = head.status === 0 ? ["-p", head.stdout.trim()] : [];
  const commit = git(["commit-tree", treeSha, ...parent, "-m", message], worktreePath);
  if (commit.status !== 0) return null;
  return commit.stdout.trim();
}

/** Restore the worktree to a checkpoint snapshot (tracked files reset to it). */
export function restoreCheckpoint(worktreePath: string, sha: string): boolean {
  if (!repoExists(worktreePath)) return false;
  return git(["read-tree", "-u", "--reset", sha], worktreePath).status === 0;
}

const MAX_FILE_BYTES = 200_000;

/** Read a single file under `rootPath`, guarding against path traversal and
 *  returning a binary flag instead of garbage for non-text files. */
export function readFileIn(rootPath: string, relPath: string): { content: string; truncated: boolean; binary: boolean } | null {
  const root = resolveRepo(rootPath);
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) return null; // traversal guard
  let buf: Buffer;
  try {
    if (!fs.statSync(target).isFile()) return null;
    buf = fs.readFileSync(target);
  } catch {
    return null;
  }
  if (buf.subarray(0, 8192).includes(0)) return { content: "", truncated: false, binary: true };
  const truncated = buf.length > MAX_FILE_BYTES;
  return { content: buf.subarray(0, MAX_FILE_BYTES).toString("utf8"), truncated, binary: false };
}

/**
 * Commit all changes on the current worktree branch, then push them directly
 * to the repo's default branch — no PR needed.
 * Fetches latest remote first so the push fast-forwards cleanly.
 * Returns the pushed commit sha (post-rebase).
 */
export function commitAndPushDirect(worktreePath: string, message: string, defaultBranch: string): string {
  git(["add", "-A"], worktreePath);
  const commit = git(["commit", "-m", message], worktreePath);
  if (commit.status !== 0 && !commit.stdout.includes("nothing to commit")) {
    throw new Error(`git commit failed: ${commit.stderr}`);
  }

  // Bring in any new commits on the default branch before pushing
  git(["fetch", "origin", defaultBranch], worktreePath);
  const rebase = git(["rebase", `origin/${defaultBranch}`], worktreePath);
  if (rebase.status !== 0) {
    // Abort the rebase so the worktree stays clean
    git(["rebase", "--abort"], worktreePath);
    throw new Error(`rebase onto ${defaultBranch} failed (merge conflict): ${rebase.stderr}`);
  }

  const push = git(["push", "origin", `HEAD:${defaultBranch}`], worktreePath);
  if (push.status !== 0) {
    throw new Error(`push to ${defaultBranch} failed: ${push.stderr}`);
  }
  return headSha(worktreePath);
}

// ── Delegator: epic integration branch ─────────────────────────────────────

/**
 * Ensure the epic's integration branch `epic/<epicId>` exists (branched off the
 * latest default branch) and has a dedicated worktree at
 * `<repo>/.worktrees/epic-<epicId>` checked out on it. Child tasks branch off
 * this branch and their results are merged back into it; nothing is pushed until
 * the epic finalizes. Idempotent — safe to call again after a worker restart.
 */
export function ensureEpicWorktree(
  repoPath: string,
  epicId: string,
  defaultBranch: string
): { worktreePath: string; branch: string } {
  const normalizedRepo = resolveRepo(repoPath);
  if (!repoExists(normalizedRepo)) {
    throw new Error(`Repo path does not exist: ${normalizedRepo}`);
  }
  const branch = `epic/${epicId}`;
  const worktreePath = path.join(normalizedRepo, ".worktrees", `epic-${epicId}`);

  const branchExists = git(["rev-parse", "--verify", branch], normalizedRepo).status === 0;
  if (!branchExists) {
    // Start from the freshest default tip. Prefer origin/<default> (after a
    // fetch) so the epic doesn't build on a stale local default; fall back to
    // the local branch when there's no usable remote.
    git(["fetch", "origin", defaultBranch], normalizedRepo);
    const hasRemote = git(["rev-parse", "--verify", `origin/${defaultBranch}`], normalizedRepo).status === 0;
    const startPoint = hasRemote ? `origin/${defaultBranch}` : defaultBranch;
    const r = git(["branch", branch, startPoint], normalizedRepo);
    if (r.status !== 0) throw new Error(`create epic branch failed: ${r.stderr || r.stdout}`);
  }

  if (!repoExists(worktreePath)) {
    try {
      fs.mkdirSync(path.join(normalizedRepo, ".worktrees"), { recursive: true });
    } catch { /* dir already exists */ }
    const r = git(["worktree", "add", worktreePath, branch], normalizedRepo);
    if (r.status !== 0 && !/already/.test(r.stderr)) {
      throw new Error(`epic worktree add failed: ${r.stderr || r.stdout}`);
    }
  }
  return { worktreePath, branch };
}

/** The current commit id of a worktree — recorded on jobs at completion so the
 *  diff endpoint can show their work after the worktree/branch is gone. */
export function headSha(worktreePath: string): string {
  const r = git(["rev-parse", "HEAD"], worktreePath);
  return r.status === 0 ? r.stdout.trim() : "";
}

/** Commit all changes on the current worktree branch. No push, no rebase.
 *  Returns the commit sha, or null when there was nothing to commit. */
export function commitOnly(worktreePath: string, message: string): string | null {
  git(["add", "-A"], worktreePath);
  const commit = git(["commit", "-m", message], worktreePath);
  if (commit.status !== 0) {
    if (commit.stdout.includes("nothing to commit")) return null;
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  return headSha(worktreePath);
}

/** Merge a child branch into the epic branch checked out at `epicWorktreePath`.
 *  Aborts and throws on conflict so the epic branch stays clean. Callers
 *  serialize this per-epic (see withEpicLock) so concurrent children don't race. */
export function mergeIntoBranch(epicWorktreePath: string, childBranch: string, message: string) {
  const r = git(["merge", "--no-ff", "-m", message, childBranch], epicWorktreePath);
  if (r.status !== 0) {
    git(["merge", "--abort"], epicWorktreePath);
    throw new Error(`merge of ${childBranch} failed (conflict): ${r.stderr || r.stdout}`);
  }
}

/** Push a local branch to origin under the same name. */
export function pushBranch(worktreePath: string, branch: string) {
  const r = git(["push", "origin", `${branch}:${branch}`], worktreePath);
  if (r.status !== 0) {
    throw new Error(`push of ${branch} failed: ${r.stderr || r.stdout}`);
  }
}

/** Push the epic branch's contents directly onto the default branch — the
 *  tokenless fallback when no PR can be opened. */
export function pushBranchToDefault(epicWorktreePath: string, defaultBranch: string) {
  const r = git(["push", "origin", `HEAD:${defaultBranch}`], epicWorktreePath);
  if (r.status !== 0) {
    throw new Error(`push to ${defaultBranch} failed: ${r.stderr || r.stdout}`);
  }
}

/** Delete a local branch (used to tidy up an epic branch after finalize). */
export function deleteBranch(repoPath: string, branch: string) {
  try {
    git(["branch", "-D", branch], resolveRepo(repoPath));
  } catch {
    // best-effort cleanup
  }
}

// ── Job diff (the "Changes" tab) ─────────────────────────────────────────────

export interface JobDiff {
  /** Where the diff came from: a live worktree (in-progress, uncommitted),
   *  the commit recorded at completion, a still-existing branch vs the default
   *  base, or nothing recoverable. */
  source: "worktree" | "commit" | "branch" | "none";
  stat: string;
  patch: string;
  truncated: boolean;
}

const MAX_PATCH_BYTES = 500_000;

/** Best-effort reconstruction of "what did this job change", across the job's
 *  whole lifecycle. Read-only — never mutates the repo or any worktree. */
export function getJobDiff(
  repoPath: string,
  job: { worktreePath?: string; branch?: string; commitSha?: string },
  defaultBranch: string,
): JobDiff {
  const repo = resolveRepo(repoPath);
  const cap = (patch: string): { patch: string; truncated: boolean } =>
    patch.length > MAX_PATCH_BYTES
      ? { patch: `${patch.slice(0, MAX_PATCH_BYTES)}\n… diff truncated …\n`, truncated: true }
      : { patch, truncated: false };

  // 1. Live worktree: uncommitted work in progress, plus brand-new files
  //    (git diff HEAD alone omits untracked paths).
  if (job.worktreePath && repoExists(job.worktreePath)) {
    const stat = git(["diff", "HEAD", "--stat"], job.worktreePath).stdout;
    let patch = git(["diff", "HEAD"], job.worktreePath).stdout;
    const untracked = git(["ls-files", "--others", "--exclude-standard"], job.worktreePath)
      .stdout.split("\n").filter(Boolean).slice(0, 50);
    for (const f of untracked) {
      // --no-index exits 1 when the files differ — that's the success case here.
      patch += git(["diff", "--no-index", "--", "/dev/null", f], job.worktreePath).stdout;
    }
    if (patch.trim()) return { source: "worktree", stat, ...cap(patch) };
    // No pending changes (e.g. already committed) — fall through.
  }

  // 2. Completed work: the exact commit recorded at completion survives
  //    worktree cleanup and branch deletion.
  if (job.commitSha) {
    const show = git(["show", "--format=", "--patch", job.commitSha], repo);
    if (show.status === 0 && show.stdout.trim()) {
      const stat = git(["show", "--format=", "--stat", job.commitSha], repo).stdout;
      return { source: "commit", stat, ...cap(show.stdout) };
    }
  }

  // 3. A branch that still exists (e.g. a PR or epic branch): everything it
  //    adds on top of the merge-base with the default branch.
  if (job.branch && git(["rev-parse", "--verify", job.branch], repo).status === 0) {
    const range = `${defaultBranch}...${job.branch}`;
    const patch = git(["diff", range], repo).stdout;
    if (patch.trim()) {
      const stat = git(["diff", range, "--stat"], repo).stdout;
      return { source: "branch", stat, ...cap(patch) };
    }
  }

  return { source: "none", stat: "", patch: "", truncated: false };
}
