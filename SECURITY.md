# Security

Factory runs autonomous coding agents on your machine. Please read this before
deploying it anywhere other than your own laptop.

## What Factory does on your machine
- Spawns the **Claude Code CLI** with `--dangerously-skip-permissions`, so the
  agent can read/write files and run shell commands inside a git **worktree** of
  the repos you add.
- Exposes a **web terminal** (`/api/terminal/exec`) that runs shell commands in a
  project's directory.
- Uses **your** Claude login (`~/.claude/.credentials.json`) and **your** GitHub
  token (entered in-app) to clone repos and open PRs.

In short: anyone who can reach the engine's API can run code as you. Treat the
engine's address + auth token like a shell credential.

## Safe by default
- The engine binds to **`127.0.0.1`** (localhost only) unless you change
  `FACTORY_HOST`.
- If you set `FACTORY_HOST` to a public interface (e.g. `0.0.0.0`) **without**
  `FACTORY_AUTH_TOKEN`, the engine **refuses to start**.
- The desktop app is always local-only.

## Exposing it on a network
If you must reach the engine remotely:
1. Set `FACTORY_AUTH_TOKEN` to a long random secret (`openssl rand -hex 24`).
   Every API call and WebSocket connection must then present it.
2. Put it behind TLS (a reverse proxy or a tunnel like Cloudflare Tunnel /
   Tailscale). Prefer a private network over the public internet.
3. Give the GitHub token the **minimum** scope you need (`repo`).

## Data & privacy
- Projects, jobs, and settings live in a local libSQL file (`FACTORY_DATA_DIR`),
  or in your own Turso database if you configure `TURSO_*`.
- **No telemetry.** Factory does not phone home. The only outbound traffic is to
  GitHub (clones/PRs) and Anthropic (via your Claude CLI) — both with your own
  credentials.

## Reporting a vulnerability
Open a private [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories)
on this repository with details and reproduction steps. Please do not open
public issues for security reports.
