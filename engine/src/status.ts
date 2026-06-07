import { getJob, patchJob, type Job, type JobStatus } from "./db";
import { broadcast } from "./events";

const TERMINAL: JobStatus[] = ["completed", "failed", "cancelled", "waiting_for_input"];

/**
 * Patch a job's status (plus optional fields), stamping startedAt/completedAt the
 * way the reference's updateStatus mutation did, then broadcast the new job over
 * the live wire so every connected UI updates instantly.
 */
export async function updateStatus(
  jobId: string,
  status: JobStatus,
  fields: Partial<Job> = {},
): Promise<void> {
  const extra: Partial<Job> = { ...fields };
  if (status === "running") {
    const current = await getJob(jobId);
    if (current && !current.startedAt) extra.startedAt = Date.now();
  }
  if (TERMINAL.includes(status)) extra.completedAt = Date.now();
  await patchJob(jobId, { ...extra, status });
  const job = await getJob(jobId);
  if (job) broadcast({ type: "job.updated", job });
}

/** Re-broadcast a job's current row (after a patch made elsewhere). */
export async function broadcastJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job) broadcast({ type: "job.updated", job });
}
