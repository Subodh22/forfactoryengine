# Factory Engine

Local-first AI coding automation. Engine + brutalist UI monorepo.

## Project Structure

```
engine/   — Node.js backend: libSQL DB, agent orchestrator, WebSocket live wire, REST API
ui/       — Vite SPA (served by engine, same-origin)
web/      — Next.js app (deploy to Vercel, points at engine via NEXT_PUBLIC_ENGINE_URL)
```

## Commands

```bash
npm run setup          # install all deps (root + engine + ui + web)
npm run dev            # engine :8787 + ui :5173 (Vite proxies to engine)
npm run dev:web        # Next.js dev server (needs NEXT_PUBLIC_ENGINE_URL)
npm run build:ui       # production build of Vite UI
npm run build:web      # production build of Next.js web
npm run start          # start engine in production mode
npm run typecheck      # typecheck engine + ui + web
```

## Architecture

- `engine/src/runner.ts` — job execution, live chat sessions, reply delivery
- `engine/src/delegator.ts` — epic planning (decomposes task into subtask DAG)
- `engine/src/delegator-scheduler.ts` — promotes/finalizes delegated children
- `engine/src/agent/claude-runner.ts` — ClaudeSession wrapper around Claude CLI
- `engine/src/events.ts` — WebSocket event bus (output, chat, term)
- Engine is the single source of truth — owns libSQL DB, runs Claude agents in git worktrees, broadcasts over WebSocket
- Both UIs are thin clients: REST for mutations, WebSocket for live updates
- Terminal is non-interactive (spawn, not PTY) — commands run on the engine's filesystem
- Agent auth: engine spawns `claude` CLI using the host's Claude subscription (no API key needed locally; use ANTHROPIC_API_KEY for headless/deployed)

## Conventions

- TypeScript throughout, uses semicolons
- Brutalist "concrete" UI style — uppercase labels, `font-data`, `border-ink`, `bg-concrete`
- Both UIs must stay in sync — changes to one should be mirrored to the other
- `mutations.ts` in ui/web has all client-side API calls
- Chat replies: `POST /api/jobs/:id/reply` for active jobs, `POST /api/jobs/:id/append` for pending jobs

## Agent Guidelines

- Read this file before exploring the codebase
- Focus only on files directly relevant to the task
- Do not read entire directories — read one file to understand a pattern, then apply it
- Ignore: node_modules/, dist/, .next/, build/, .git/, *.lock files
- The ui/ and web/ directories share nearly identical components — changes often need to be applied to both
