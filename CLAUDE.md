# CLAUDE.md

## What is this

Factory Engine — local-first AI coding automation. A monorepo with three packages:

- `engine/` — Node/TypeScript backend (tsx). Embedded libSQL DB, spawns `claude` CLI in git worktrees, WebSocket live wire, REST API. Runs on port 8787.
- `ui/` — Vite + React frontend (same-origin, served by engine proxy). Port 5173.
- `web/` — Next.js frontend (deployable to Vercel, points at engine URL).

Both UIs are thin clients of the engine's WebSocket + REST.

## Commands

```bash
npm run setup       # install all deps (root + engine + ui + web)
npm run dev         # engine :8787 + ui :5173 concurrently
npm run typecheck   # typecheck all three packages
npm run start       # production engine only
```

## Architecture

- Engine is the single source of truth. No cloud DB required (local `engine/factory.db`).
- Jobs run in isolated git worktrees. Claude CLI is spawned per turn with `--print` + `--resume`.
- WebSocket broadcasts all state changes (job status, terminal output, chat).
- Epic delegation: planner splits tasks into parallel subtask DAG, merged into one integration branch.

## Code conventions

- TypeScript throughout, ESM (`"type": "module"`).
- Engine uses raw Node APIs (no Express) — `node:http` server in `engine/src/server.ts`.
- UI state via custom React hooks in `lib/data.tsx` (WebSocket-driven, not polling).
- Terminal output uses `\x00` markers for stderr/exit/tool coloring.
- `engine/src/agent/claude-runner.ts` — spawns `claude` CLI per turn, streams JSON output.
- `engine/src/terminal.ts` — non-interactive web terminal (not a PTY), stdin set to `ignore`.
