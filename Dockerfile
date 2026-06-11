# Factory engine — self-host on any container host (Fly.io, a VPS, on-prem).
# Bundles git + the Claude Code CLI; builds the UI + compiles the engine so the
# image runs plain Node (no tsx at runtime).
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install deps first (better layer caching)
COPY engine/package*.json engine/
RUN npm --prefix engine install
COPY ui/package*.json ui/
RUN npm --prefix ui install

# Build the UI (engine serves ui/dist) and compile the engine to dist/factory.mjs
COPY . .
RUN npm --prefix ui run build && npm --prefix engine run build

# Self-host defaults. Secrets (FACTORY_AUTH_TOKEN, TURSO_*) are injected at
# runtime, never baked in. FACTORY_AUTH_TOKEN is REQUIRED here: the engine binds
# to 0.0.0.0 and runs coding agents + a shell endpoint, so it refuses to start on
# a public interface without a token.
ENV PORT=8787 \
    FACTORY_HOST=0.0.0.0 \
    FACTORY_DATA_DIR=/data \
    FACTORY_WORKSPACE=/data/repos

EXPOSE 8787
VOLUME ["/data"]

# Container orchestrators (Fly, compose) get readiness from the existing
# /api/health endpoint. Stays on root: the engine's whole job is running agents
# with shell access, and /data volume mounts (Docker, Fly) arrive root-owned.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Claude auth: the container needs a signed-in Claude CLI. Mount your local
# credentials read-only, e.g.:
#   docker run -e FACTORY_AUTH_TOKEN=... -v ~/.claude:/root/.claude:ro -v factory:/data -p 8787:8787 factory
CMD ["node", "engine/dist/factory.mjs"]
