# Factory engine — runs online (Fly.io / any container host).
# Bundles git + the Claude Code CLI; builds the UI so the engine serves it.
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

# Build the UI (the engine serves ui/dist) and copy the rest
COPY . .
RUN npm --prefix ui run build

# Hosted defaults. Secrets (ANTHROPIC_API_KEY, FACTORY_AUTH_TOKEN, TURSO_*) are
# injected at runtime via `fly secrets set`, never baked into the image.
ENV PORT=8787 \
    FACTORY_HOST=0.0.0.0 \
    FACTORY_DATA_DIR=/data \
    FACTORY_WORKSPACE=/data/repos

EXPOSE 8787
VOLUME ["/data"]
CMD ["npm", "--prefix", "engine", "run", "start"]
