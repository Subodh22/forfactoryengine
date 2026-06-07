# Control Factory from anywhere (Vercel + Turso)

Use everything from a hosted website — including **Login with GitHub** — while the
engine runs **headless** on your Mac. They never talk directly; both use **Turso**.

```
  Vercel site (web/)            Turso cloud DB              engine on your Mac (headless)
  · Login with GitHub   ──►   projects · jobs · token  ◄──  syncs · runs Claude · opens PRs
  · pick repo, queue jobs        (shared state)
  · watch status + PRs
```

## 1. Free Turso DB
Sign up at **turso.tech** → create a database + an **auth token**. Note the
`libsql://…` URL and the token.

## 2. Push this repo to GitHub
Already a git repo — just point it at yours and push:
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 3. Deploy the site to Vercel
- Import the repo, set **Root Directory = `web`**.
- **Environment Variables:**
  - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (from step 1)
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (from the OAuth App below)
- Deploy. Note your URL, e.g. `https://your-app.vercel.app`.

### GitHub OAuth App (so "Login with GitHub" works on the site)
github.com → Settings → Developer settings → **OAuth Apps → New**:
- **Homepage URL:** `https://your-app.vercel.app`
- **Authorization callback URL:** `https://your-app.vercel.app/api/github/callback`
- Copy Client ID + a generated Client Secret into Vercel's env (above), redeploy.

## 4. Run the headless engine on your Mac
`engine/.env` only needs the **same Turso** values (no GitHub creds — login happens
on the site):
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=...
```
Then keep it running (no UI needed):
```bash
npm start          # headless engine: syncs Turso, runs queued jobs
```

## How it works
1. On the **Vercel site** (your phone): **Login with GitHub** → pick a repo → queue a
   job. The GitHub token + job are written to **Turso**.
2. Your **Mac's engine** syncs Turso, reads the token, clones the repo, runs Claude,
   opens a **PR**, and writes status + PR link back to Turso.
3. The site polls Turso → you watch `pending → running → done` + the PR.

## Notes
- **Your Mac must be running `npm start`** for jobs to execute (they sit `pending`
  until it syncs).
- **Live terminal output** isn't streamed to the site (status/results/PRs are).
- The GitHub token authorized on the site flows to the engine via Turso, so it can
  clone private repos + open PRs without GitHub creds living on your Mac.
