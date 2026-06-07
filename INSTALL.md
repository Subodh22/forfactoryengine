# Installing Factory

Factory is **free** and **self-hosted**: it runs on your own machine and uses
**your own Claude subscription** (via the Claude Code CLI). Nothing runs on our
servers and there's no account to create.

## Prerequisites (all platforms)
- **Node.js ≥ 20** — https://nodejs.org
- **git** — https://git-scm.com
- **Claude Code CLI**, signed in:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude            # run once and sign in with your Claude account
  ```

Check everything at once after installing Factory:
```bash
factory doctor
```

## Option A — Desktop app (recommended)
Download the installer for your OS from the
[Releases](https://github.com/Subodh22/forfactoryengine/releases) page:
- **macOS:** `Factory-<version>.dmg` → drag to Applications
- **Windows:** `Factory-Setup-<version>.exe`
- **Linux:** `Factory-<version>.AppImage`

Launch it. On first run, if you're not signed into Claude, it'll tell you. That's
it — projects and history are stored per-user on your machine.

## Option B — Command line
```bash
npx @factory/cli up      # zero-install trial
# or install it:
npm install -g @factory/cli
factory up               # preflight, start the engine, open the app
```
`factory up` serves the full UI at http://localhost:8787.

## Option C — From source
```bash
git clone https://github.com/Subodh22/forfactoryengine
cd forfactoryengine
npm run setup            # install engine + ui + web
npm run build            # build UI + compile engine
npm run factory          # = node cli/index.mjs up
```

## Option D — Docker / server self-host
For a shared team instance on a server. The container needs a signed-in Claude
CLI and **must** have an auth token (it binds publicly):
```bash
docker build -t factory .
docker run -d --name factory \
  -e FACTORY_AUTH_TOKEN=$(openssl rand -hex 24) \
  -v ~/.claude:/root/.claude:ro \
  -v factory-data:/data \
  -p 8787:8787 factory
```
Then open `http://<server>:8787` and enter the token. Put it behind TLS / a
private network — see [SECURITY.md](SECURITY.md).

## Control it from your phone (optional)
Deploy the `web/` app (Next.js) to Vercel with `NEXT_PUBLIC_ENGINE_URL` pointing
at your exposed engine. See [CONTROL.md](CONTROL.md).
