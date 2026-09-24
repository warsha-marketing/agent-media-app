FROM node:22-slim

# System deps for the subtitles primitive and Arabic Captions:
#   ffmpeg            — audio extraction + subtitle burn (Debian's build links
#                       libass, which shapes with HarfBuzz and orders with FriBidi)
#   fonts-liberation  — Liberation Sans Bold (English captions, lib/ass.ts)
#   fonts-noto-core   — Noto Sans Arabic Bold (Arabic Captions, lib/arabic-captions-ass.ts).
#                       SIL Open Font License 1.1; see FONTS.md.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg fonts-liberation fonts-noto-core \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm install -g pnpm@9

# Workspace config (build context is the repo root).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Bring in the workspace deps the worker actually needs.
COPY packages/schema/ packages/schema/
# Server-only Shot Prompt wording (#26), shared by api-v2 and the worker.
COPY packages/shot-prompts/ packages/shot-prompts/
COPY services/primitive-worker-vnext/ services/primitive-worker-vnext/

RUN pnpm install --frozen-lockfile --filter @agentmedia/schema --filter @agentmedia/shot-prompts --filter primitive-worker-vnext

RUN pnpm --filter @agentmedia/schema build
RUN pnpm --filter @agentmedia/shot-prompts build
RUN pnpm --filter primitive-worker-vnext build

WORKDIR /app/services/primitive-worker-vnext

CMD ["node", "dist/worker.js"]
