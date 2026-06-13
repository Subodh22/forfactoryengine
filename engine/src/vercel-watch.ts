import { getSetting, getJob, patchJob, type Job } from "./db";
import { emitChat, broadcast } from "./events";
import {
  findDeploymentForSha, getDeployment, getDeploymentBuildError, isTerminalState,
} from "./agent/vercel";

// Follows the Vercel deployment a job's pushed commit triggers, streams its
// status into the job chat, and — when a build fails — pulls the real build-error
// log and hands it back to the job's agent to fix and re-push. The loop is capped
// so a persistently-broken build can't ping-pong forever.
//
// Best-effort throughout: every path swallows errors so a Vercel hiccup can never
// break the run loop. State is mirrored onto the job (deploy* columns) and
// broadcast so both UIs can show a deploy chip live.

const MAX_DEPLOY_FIX_ATTEMPTS = 2;

// Poll cadence. Vercel's GitHub integration usually registers a deployment within
// a few seconds of the push; a build then takes anywhere from ~30s to a few min.
const FIND_TRIES = 24;        // × 5s  → ~2min to find the deployment for the SHA
const FIND_INTERVAL = 5_000;
const POLL_TRIES = 120;       // × 10s → ~20min for the build to finish
const POLL_INTERVAL = 10_000;

const watching = new Set<string>(); // jobIds with a live watcher (dedupe guard)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function vercelConfig(): Promise<{ token: string; teamId?: string } | null> {
  const token = await getSetting("vercelToken");
  if (!token) return null;
  const teamId = (await getSetting("vercelTeamId")) || undefined;
  return { token, teamId };
}

/** Whether a Vercel token is configured — lets callers skip work cheaply. */
export async function vercelConnected(): Promise<boolean> {
  return Boolean(await getSetting("vercelToken"));
}

async function setDeploy(jobId: string, fields: Partial<Job>): Promise<void> {
  await patchJob(jobId, fields);
  const job = await getJob(jobId).catch(() => null);
  if (job) broadcast({ type: "job.updated", job });
}

/** Follow the deploy for `sha`. Fire-and-forget; never throws. */
export async function watchVercelDeploy(jobId: string, sha: string): Promise<void> {
  if (!sha || watching.has(jobId)) return;
  const cfg = await vercelConfig();
  if (!cfg) return; // Vercel not connected — nothing to watch

  watching.add(jobId);
  try {
    // 1) Wait for Vercel to register a deployment for this commit.
    let dep = null as Awaited<ReturnType<typeof findDeploymentForSha>>;
    for (let i = 0; i < FIND_TRIES && !dep; i++) {
      dep = await findDeploymentForSha(cfg.token, sha, { teamId: cfg.teamId }).catch(() => null);
      if (!dep) await sleep(FIND_INTERVAL);
    }
    if (!dep) return; // repo isn't wired to a Vercel project — stop quietly

    const target = dep.target === "production" ? "production" : "preview";
    const inspectorUrl = dep.inspectorUrl || (dep.url ? `https://${dep.url}` : "");
    emitChat(jobId, "assistant", `🔼 Vercel **${target}** deploy started for \`${sha.slice(0, 7)}\`…`);
    await setDeploy(jobId, {
      deployState: "building", deployId: dep.uid, deployTarget: target,
      deployUrl: inspectorUrl, deployError: "",
    });

    // 2) Poll until terminal.
    let state = dep.state;
    for (let i = 0; i < POLL_TRIES && !isTerminalState(state); i++) {
      await sleep(POLL_INTERVAL);
      const cur = await getDeployment(cfg.token, dep.uid, { teamId: cfg.teamId }).catch(() => null);
      if (cur) state = cur.state;
    }

    // 3a) Success.
    if (state === "READY") {
      const liveUrl = dep.url ? `https://${dep.url}` : inspectorUrl;
      await setDeploy(jobId, { deployState: "ready", deployUrl: liveUrl, deployError: "", deployFixAttempts: 0 });
      emitChat(jobId, "assistant", `✅ Vercel **${target}** deploy succeeded${liveUrl ? ` → ${liveUrl}` : ""}.`);
      return;
    }

    // 3b) Canceled / timed out — record but don't try to fix.
    if (state !== "ERROR") {
      await setDeploy(jobId, { deployState: state === "CANCELED" ? "canceled" : "building" });
      emitChat(jobId, "assistant", `⚠️ Vercel **${target}** deploy ended in state \`${state}\`.`);
      return;
    }

    // 3c) Failure — pull the build log and surface it.
    const buildLog = await getDeploymentBuildError(cfg.token, dep.uid, { teamId: cfg.teamId });
    await setDeploy(jobId, { deployState: "error", deployError: buildLog });
    const inspect = dep.inspectorUrl ? ` ([inspect](${dep.inspectorUrl}))` : "";
    emitChat(
      jobId, "assistant",
      `❌ Vercel **${target}** deploy **failed**${inspect}.\n\n\`\`\`\n${buildLog ? buildLog.slice(-2000) : "(no build log available)"}\n\`\`\``,
    );
  } catch {
    /* watcher is best-effort */
  } finally {
    watching.delete(jobId);
  }

  // 4) Auto-fix, capped. Done after the watcher is unregistered so the fix's own
  //    re-push can start a fresh watcher.
  try {
    const job = await getJob(jobId).catch(() => null);
    if (!job || job.deployState !== "error") return;
    if (job.deployFixAttempts < MAX_DEPLOY_FIX_ATTEMPTS) {
      await triggerDeployFix(jobId, { manual: false });
    } else {
      emitChat(
        jobId, "assistant",
        `🛑 Auto-fix gave up after ${MAX_DEPLOY_FIX_ATTEMPTS} attempts — over to you. Use **Fix deploy error** to try again.`,
      );
    }
  } catch {
    /* ignore */
  }
}

/** Feed the captured build error back to the job's agent so it fixes + re-pushes.
 *  Returns false if there's no failed deploy to act on, or the job can't reopen.
 *  `manual` skips the attempt cap (an explicit user click always tries). */
export async function triggerDeployFix(jobId: string, opts: { manual: boolean }): Promise<boolean> {
  const job = await getJob(jobId).catch(() => null);
  if (!job || job.deployState !== "error") return false;
  if (!opts.manual && job.deployFixAttempts >= MAX_DEPLOY_FIX_ATTEMPTS) return false;

  const attempt = job.deployFixAttempts + 1;
  await patchJob(jobId, { deployFixAttempts: attempt });

  const target = job.deployTarget || "preview";
  const prompt = [
    `The previous change was pushed, but the Vercel ${target} deployment **failed to build**.`,
    "Here is the build error log from Vercel:",
    "",
    "```",
    (job.deployError || "(no log captured)").slice(-5000),
    "```",
    "",
    "Diagnose the root cause, fix it in the code, and make sure the project builds cleanly. "
      + "When you're done your changes will be pushed and the deploy will re-run automatically.",
  ].join("\n");

  emitChat(
    jobId, "assistant",
    `🔧 ${opts.manual ? "" : "Auto-"}fixing the deploy error (attempt ${attempt}/${MAX_DEPLOY_FIX_ATTEMPTS})…`,
  );

  // Dynamic import breaks the runner ↔ vercel-watch cycle (runner imports us
  // statically; we only need deliverReply at call time).
  const { deliverReply } = await import("./runner");
  const accepted = await deliverReply(jobId, prompt, []);
  if (!accepted) {
    emitChat(jobId, "assistant", "⚠️ Couldn't reopen this job to auto-fix its workspace. Redo the job with the error above.");
    return false;
  }
  return true;
}
