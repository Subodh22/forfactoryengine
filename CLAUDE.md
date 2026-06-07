# Factory Engine

Local-first AI coding automation engine with embedded libSQL, WebSocket live wire, and Claude agent orchestration.

## Project Structure

- `engine/` — Node/TypeScript backend: HTTP server, WebSocket event bus, agent runner, libSQL database
- `ui/` — Vite SPA client (same-origin, served by engine)
- `web/` — Next.js client (remote, pointed at engine over network)
- Both UIs share the same component/lib structure and connect via the engine's WebSocket

## Dev Commands

```bash
npm run setup     # install root + engine + ui deps
npm run dev       # engine on :8787, UI on :5173
```

## Architecture

- Engine owns all state in local libSQL (`engine/factory.db`, gitignored)
- REST API for mutations, WebSocket for live state updates
- UI loads a snapshot via REST on mount, then applies WebSocket events for reactivity
- Agent runs Claude CLI in git worktrees, streams output over WebSocket

## Key Patterns

- Events defined in `engine/src/events.ts`, broadcast via `broadcast()` to all WS clients
- Client state managed in `{ui,web}/lib/data.tsx` via `FactoryProvider` context
- Mutations in `{ui,web}/lib/mutations.ts` — REST calls only, state updates arrive via WS
- Both `ui/` and `web/` have identical component/lib code (kept in sync manually)
