export type JobOutcome = "completed" | "failed" | "needs_push_help";

interface NotifyOpts {
  jobId: string;
  title?: string;
  status: JobOutcome;
  projectName?: string;
  error?: string;
  changedFiles?: string[];
}

/**
 * Email the user when a job reaches a terminal state, via the Resend REST API.
 * Opt-in: a no-op unless both RESEND_API_KEY and NOTIFY_EMAIL are set. Never
 * throws — a notification failure must not break the job flow.
 */
export async function sendJobNotification(opts: NotifyOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) return;

  const from = process.env.RESEND_FROM || "Factory <onboarding@resend.dev>";
  const appUrl = process.env.FACTORY_APP_URL || "http://localhost:5173";
  const label = opts.title || opts.jobId;
  const verb = opts.status === "completed" ? "completed"
    : opts.status === "needs_push_help" ? "needs your help pushing"
    : "failed";
  const subject = `[Factory] Job ${verb}: ${label}`;

  const lines: string[] = [`Job "${label}" ${verb}.`];
  if (opts.projectName) lines.push(`Project: ${opts.projectName}`);
  if (opts.status === "completed" && opts.changedFiles?.length) {
    lines.push(`Changed files: ${opts.changedFiles.join(", ")}`);
  }
  if (opts.status === "needs_push_help") {
    lines.push("The work is committed but could not be pushed after several attempts.");
    if (opts.error) lines.push(`Push error: ${opts.error}`);
    lines.push("Fix the cause, then hit RETRY PUSH on the job card.");
  }
  if (opts.status === "failed" && opts.error) lines.push(`Error: ${opts.error}`);
  lines.push(`Open Factory: ${appUrl}`);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text: lines.join("\n") }),
    });
    if (!res.ok) console.error(`[notify] Resend returned ${res.status}`);
  } catch (err) {
    console.error(`[notify] failed to send email: ${String(err)}`);
  }
}
