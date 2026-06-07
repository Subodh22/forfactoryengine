# CLAUDE.md

## Project overview
Factory Engine — local-first AI coding automation monorepo. The **engine** (`engine/`) runs Claude agents in git worktrees, backed by embedded libSQL and a WebSocket live wire. Two identical UIs: `ui/` (Vite, same-origin) and `web/` (Next.js for Vercel).

## Commands
- `npm run dev` — start engine + Vite UI concurrently
- `npm run dev:engine` — engine only
- `npm run dev:ui` — Vite UI only
- `npm run dev:web` — Next.js UI only
- `npm run typecheck` — typecheck all packages
- `npm run setup` — install all deps

## Architecture
- `engine/src/runner.ts` — job execution, live chat sessions, reply delivery
- `engine/src/delegator.ts` — epic planning (decomposes task into subtask DAG)
- `engine/src/delegator-scheduler.ts` — promotes/finalizes delegated children
- `engine/src/agent/claude-runner.ts` — ClaudeSession wrapper around Claude CLI
- `engine/src/events.ts` — WebSocket event bus (output, chat, term)
- `ui/` and `web/` share identical component/lib structure, keep them in sync

## Conventions
- TypeScript throughout, no semicolons optional (currently uses semicolons)
- Brutalist "concrete" UI style — uppercase labels, `font-data`, `border-ink`, `bg-concrete`
- Both UIs must stay in sync — changes to one should be mirrored to the other
# Factory Engine

Local-first AI coding automation engine. One process on your machine: embedded libSQL DB, agent orchestrator (Claude in git worktrees), WebSocket event bus, REST API.

## Structure

- `engine/` — Backend (TypeScript/Bun): DB, agent runner, delegator, WebSocket events, REST API
- `ui/` — Vite SPA served by the engine (same-origin)
- `web/` — Next.js app (Vercel deploy, connects to engine over network)
- Both UIs share the same component/lib structure and talk to the engine via REST + WebSocket

## Dev

```bash
# Engine
cd engine && bun install && bun run dev

# Vite UI
cd ui && npm install && npm run dev

# Next.js UI
cd web && npm install && npm run dev
```

## Key patterns

- All state lives in libSQL; UI gets live updates via WebSocket events
- Jobs run in isolated git worktrees; Claude Code CLI is the agent
- Epics use a delegator that plans subtasks, runs them in parallel, merges into one PR
- Chat replies go through `POST /api/jobs/:id/reply` (sendReply) for active/finished jobs
- Pending jobs use `POST /api/jobs/:id/append` (appendPrompt) to add to prompt before run
- `mutations.ts` in ui/web has all client-side API calls
