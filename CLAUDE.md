# Factory Engine

## Project structure
- `engine/` — Backend (Hono server, Claude agent runner, Turso DB)
- `ui/` — Vite + React frontend (original)
- `web/` — Next.js frontend (same components, "use client" directives)
- Both `ui/` and `web/` share near-identical component code — changes typically go in both

## Dev commands
- `cd engine && npm run dev` — start engine server
- `cd ui && npm run dev` — start Vite UI
- `cd web && npm run dev` — start Next.js UI

## Style
- Brutalist UI: border-ink, bg-concrete/paper, font-data, font-display, font-mono
- Tailwind CSS, shadcn/ui base components
- TypeScript throughout, strict mode
