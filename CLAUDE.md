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
