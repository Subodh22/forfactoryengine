# Running Factory online

The engine runs as one container — it serves the UI, owns the database, and runs
the agents. Deploy it to any container host; below is Fly.io (simple, cheap,
HTTPS + a persistent volume out of the box).

## What you provide
- A **Fly.io** account (`brew install flyctl && fly auth login`).
- An **Anthropic API key** (the agents run with `ANTHROPIC_API_KEY`, not an
  interactive login, since the server is headless).
- An **access token** you make up — this gates the public engine (required; the
  engine runs code, so it must not be open).
- For each project: a **GitHub repo** + a token (the engine clones it on first run).

## Deploy
```bash
cd ~/Downloads/factory-engine
fly launch --no-deploy            # creates the app + the /data volume from fly.toml

# secrets (never baked into the image)
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set FACTORY_AUTH_TOKEN=$(openssl rand -hex 24)   # save this — it's your login

# optional: Turso sync (only if you also want a separate phone read-replica)
# fly secrets set TURSO_DATABASE_URL=libsql://...  TURSO_AUTH_TOKEN=...

fly deploy
fly open                          # your https URL — open it on your phone, enter the token
```

## Using it
1. Open the URL on any device → enter your access token.
2. **+ project** → give it a name + a GitHub repo (`owner/name`) and a token, leave
   the local path blank. The engine clones it under `/data/repos` on the first job.
3. Type a job → it runs Claude in a worktree on the server and streams live.

## Notes
- **Cost** = the Fly machine (suspends when idle via `auto_stop_machines`) + your
  Anthropic usage. No metered database.
- **Security:** `FACTORY_AUTH_TOKEN` is mandatory for a public deploy. Without it
  the API is open and `/api/jobs` can run arbitrary code.
- **Data** (jobs, projects, cloned repos) lives on the `/data` volume and survives
  redeploys.
- Local dev is unchanged: `npm run dev`, no token needed (auth is off when
  `FACTORY_AUTH_TOKEN` is unset).
