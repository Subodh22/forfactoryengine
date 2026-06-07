# Control Factory from anywhere

The **engine** is the single source of truth and the live wire: it owns the
database, runs Claude in git worktrees, and broadcasts every change over
WebSocket. Both UIs are thin clients of that one engine:

```
  ui/  (Vite, served BY the engine)          engine on your Mac
  · full brutalist UI, same-origin   ◄──►   libSQL/Turso · runs Claude · WS live wire · REST
  web/ (Next.js, deploy to Vercel)
  · same UI, points at NEXT_PUBLIC_ENGINE_URL
```

There is no separate cloud database to poll and no Convex — the rich, live
features (streaming terminals, Agents grid, chat replies, web terminal) work in
**both** UIs because both talk to the engine's WebSocket directly.

## Local (default)

```bash
npm run setup     # install root + engine + ui + web
npm run dev       # engine :8787, ui :5173 (Vite proxies /api + /ws to the engine)
# open http://localhost:5173
```

`engine/.env` is optional. With no `TURSO_*` set, the engine uses a local
`engine/factory.db` file. With `TURSO_*` set it connects directly to your Turso
cloud DB (so the same data is reachable from a hosted engine too).

## From anywhere (hosted web app)

1. **Expose the engine** on your Mac with auth on:
   ```
   # engine/.env
   FACTORY_HOST=0.0.0.0
   FACTORY_AUTH_TOKEN=<a long random secret>
   FACTORY_APP_URL=https://your-app.vercel.app   # where OAuth returns to
   ```
   Then `npm start` and put it behind a tunnel (cloudflared / ngrok / Tailscale)
   to get a public `https://…` URL. The engine runs Claude with shell access, so
   **always set `FACTORY_AUTH_TOKEN` before exposing it.**

2. **Deploy `web/` to Vercel** (Root Directory = `web`) with:
   ```
   NEXT_PUBLIC_ENGINE_URL = https://your-engine-url
   ```

3. Open the Vercel app, enter your `FACTORY_AUTH_TOKEN` on the access screen, and
   you have the full live UI from your phone — every job, terminal, and agent
   streams straight from your Mac.

## GitHub

Connect once on the engine — either **Login with GitHub** (OAuth App, set
`GITHUB_CLIENT_ID/SECRET` + `FACTORY_OAUTH_CALLBACK` in `engine/.env`) or the
**Connect GitHub** token button. The connected token is stored on the engine and
used for clones + PRs; the web client never needs its own GitHub credentials.

## Claude auth

The engine spawns the `claude` CLI, so it uses **your Claude subscription** — be
signed in (`claude`) on the machine running the engine. No API key needed.
