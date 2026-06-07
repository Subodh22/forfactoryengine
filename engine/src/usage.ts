import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Returns the real Claude subscription usage (session %, reset times, weekly
// limits) — the same data Claude Code's `/usage` command shows. Reads the OAuth
// token Claude Code stores in ~/.claude/.credentials.json and proxies
// Anthropic's usage endpoint. The CLI refreshes that token, so as long as the
// engine runs `claude`, it stays valid.

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";

interface UsageWindow { utilization: number; resets_at: string }

function readToken(): { token: string; subscriptionType?: string; expiresAt?: number } | null {
  const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
  if (!fs.existsSync(credPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
    const o = raw.claudeAiOauth ?? raw;
    if (!o?.accessToken) return null;
    return { token: o.accessToken, subscriptionType: o.subscriptionType, expiresAt: o.expiresAt };
  } catch {
    return null;
  }
}

export interface UsageResult {
  status: number;
  body: Record<string, unknown>;
}

export async function getClaudeUsage(): Promise<UsageResult> {
  const cred = readToken();
  if (!cred) {
    return { status: 404, body: { error: "No Claude credentials found. Sign in with the Claude CLI first." } };
  }
  if (cred.expiresAt && cred.expiresAt < Date.now()) {
    return { status: 401, body: { error: "Claude token expired. Run any `claude` command to refresh it." } };
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${cred.token}`, "anthropic-beta": OAUTH_BETA },
    });
    if (!res.ok) {
      const body = await res.text();
      return { status: res.status, body: { error: `Usage endpoint returned ${res.status}`, detail: body.slice(0, 300) } };
    }
    const data = (await res.json()) as Record<string, UsageWindow | null>;
    return {
      status: 200,
      body: {
        subscriptionType: cred.subscriptionType ?? null,
        session: data.five_hour ?? null,
        weekly: data.seven_day ?? null,
        weeklyOpus: data.seven_day_opus ?? null,
        weeklySonnet: data.seven_day_sonnet ?? null,
        fetchedAt: Date.now(),
      },
    };
  } catch (err) {
    return { status: 502, body: { error: "Failed to reach Anthropic usage endpoint", detail: String(err) } };
  }
}
