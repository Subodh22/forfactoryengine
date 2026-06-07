# Factory Engine

Local-first AI coding automation, rebuilt the right way. The **engine** runs on your
machine: it owns an embedded **libSQL** database, runs the agents, and pushes live
updates over **WebSocket** — no metered cloud database, no Convex.

The full **Factory** experience (the "Grid-Cast" concrete-brutalist UI from
[Factory8090](https://github.com/Subodh22/Factory8090)) runs on top of this engine:
a 7-column Kanban board, a live Agents grid of streaming mini-terminals, a Master
feed, per-job detail with a live terminal + chat replies, model/effort selection,
epic **delegation** (a planner splits a task into a parallel subtask DAG merged into
one PR), an in-app **.env editor** and **web terminal**, and real Claude usage
meters. The same UI ships twice — `ui/` (Vite, served by the engine, same-origin)
and `web/` (Next.js for Vercel, pointed at the engine over the network) — both
fully live because both speak the engine's WebSocket.

## Architecture (the one principle)

> The local node is the source of truth and the live wire. The cloud is a thin,
> optional relay/sync — never the database, never the compute.

```
ENGINE (one process on your machine)
  ├─ embedded libSQL  ← all reads/writes, local & unmetered (heavy work is free)
  ├─ agent orchestrator (Claude in git worktrees)   [plane 2]
  ├─ WebSocket event bus  ← the live wire (replaces Convex reactive queries)
  └─ serves the UI + REST API
        │
        └─ (later) syncs to a Turso cloud copy so your phone reads it from anywhere
```

## Build plan (planes)

- **Plane 1 (this scaffold):** engine owns libSQL + serves a UI whose job list updates
  **live over WebSocket**, zero cloud DB. Creating a job broadcasts to every client; a
  simulated runner moves it `pending → running → done` to prove live reactivity.
- **Plane 2:** swap the simulated runner for the real agent (port `claude-runner` /
  `worktree` / `delegator` / `queue` from the old Factory8090 repo).
- **Plane 3:** Turso embedded-replica sync → a hosted phone UI reads the cloud copy.
- **Plane 4:** package as a single binary (Bun `--compile`) + license/auth.

## Run it

```bash
npm run setup     # install root + engine + ui deps
npm run dev       # engine on :8787, UI on :5173 (Vite proxies /api + /ws to the engine)
# open http://localhost:5173 — create a job, watch it go live across tabs
```

The DB is a local file `engine/factory.db` (gitignored). Delete it to reset.

## Connect GitHub

Two ways to connect your repos:

- **Login with GitHub (OAuth):** create a GitHub OAuth App (see `engine/.env.example`),
  put the client id/secret in `engine/.env`, restart — the header shows a **Login with
  GitHub** button. After login, your repos are listed under **+ project**.
- **Token (no setup):** if OAuth isn't configured, the header shows **Connect GitHub** —
  paste a Personal Access Token (scope `repo`).

Either way: pick a repo to add it as a project, run jobs, and the engine commits the
work and opens a **pull request** (a `PR ↗` link appears on the job).

Claude auth: the engine spawns the `claude` CLI, so it uses **your Claude
subscription** — just be signed in (`claude`). No API key needed locally.
