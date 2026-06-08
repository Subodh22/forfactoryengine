# Factory Engine

Local-first AI coding automation monorepo: engine + two UI clients.

## Structure

- `engine/` — Node.js/TypeScript backend: libSQL database, agent orchestrator (Claude in git worktrees), WebSocket event bus, REST API
- `ui/` — Vite + React frontend (served by engine at same origin)
- `web/` — Next.js frontend (for Vercel, connects to engine over network)

Both UIs share identical components and lib code; they differ only in bundler and how they reach the engine.

## Dev

```bash
npm run setup     # install all deps
npm run dev       # engine on :8787, Vite UI on :5173
npm run dev:web   # Next.js UI (needs NEXT_PUBLIC_ENGINE_URL)
npm run typecheck # all three packages
```

DB is `engine/factory.db` (gitignored). Delete to reset.

## Key patterns

- Engine broadcasts all state changes over WebSocket (`engine/src/events.ts`); UIs load a snapshot then apply live events
- Terminal is non-interactive: commands run on engine via REST, output streams back over WebSocket
- Agent work happens in git worktrees (`engine/src/agent/worktree.ts`)
- Auth is optional: set `FACTORY_AUTH_TOKEN` env var to gate all API/WS access
