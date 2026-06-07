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
