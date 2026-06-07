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

# Claude auth: the container needs a signed-in Claude CLI. Mount your local
# credentials read-only, e.g.:
#   docker run -e FACTORY_AUTH_TOKEN=... -v ~/.claude:/root/.claude:ro -v factory:/data -p 8787:8787 factory
CMD ["node", "engine/dist/factory.mjs"]
