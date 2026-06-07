# Control Factory from anywhere (Vercel + Turso)

Drive Factory from a hosted website (phone, any browser) while the engine runs on
your Mac. They never talk directly — both talk to a shared **Turso** DB.

```
  Vercel site (web/)  ──►  Turso cloud DB  ◄──  engine on your Mac
   queue jobs, see status     (shared state)      syncs · runs Claude · opens PRs
```

## 1. Create a free Turso DB
- Sign up at **turso.tech**, create a database, create an **auth token**.
- Note the **database URL** (`libsql://…`) and the **token**.

## 2. Point the engine at it
`engine/.env`:
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=...
```
Run the engine once (`npm run dev`). It creates the schema, syncs it up to Turso,
and from now on **picks up any job that appears in Turso** (e.g. from the website).

## 3. Deploy the control site to Vercel
- Import this repo into Vercel with **Root Directory = `web`**.
- Set env vars **`TURSO_DATABASE_URL`** + **`TURSO_AUTH_TOKEN`** (same values).
- Deploy → open the URL on your phone.

## How it works
- On the **website** (anywhere): add a repo (`owner/name`), queue a job → it's
  written to Turso as `pending`.
- Your **Mac's engine** syncs Turso every few seconds, sees the pending job, clones
  the repo, runs Claude, opens a PR, and writes status + PR link back to Turso.
- The website polls Turso and shows `pending → running → done` + the **PR** link.

## Notes
- **Your Mac must be online** for jobs to actually run — they sit `pending` until
  the engine syncs them down.
- Repo projects created on the website use the **GitHub token you connected in the
  engine** (it syncs through Turso), so they can clone private repos + open PRs.
- **Live terminal output** isn't streamed to the website (that needs a direct
  connection); status, results, and PR links do sync through.
