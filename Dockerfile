FROM node:20-bookworm-slim

WORKDIR /app

# herramientas de compilación para better-sqlite3 + Python 3.11 para notebooklm-py
# ffmpeg + fuentes DejaVu para montaje de vídeos cortos (create_short_video)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    make \
    g++ \
    ffmpeg \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# NotebookLM: pip install + playwright browser (auth vía volumen /app/.notebooklm)
COPY scripts/requirements-notebooklm.txt ./scripts/
RUN pip3 install --break-system-packages --upgrade pip \
    && pip3 install --break-system-packages --no-cache-dir -r scripts/requirements-notebooklm.txt \
    && python3 -m playwright install-deps chromium \
    && python3 -m playwright install chromium

# dependencias (cacheado mientras package.json no cambie)
COPY package.json package-lock.json ./
RUN npm ci

# Playwright + Chromium para render AntV Infographic → PNG en el agente
RUN npx playwright install-deps chromium \
    && npx playwright install chromium

# CACHEBUST aquí — invalida COPY src/ y todo lo posterior cuando cambia
# En Dokploy: Build Args → CACHEBUST = <timestamp o número creciente>
ARG CACHEBUST=1
RUN echo "Cache bust: $CACHEBUST"

COPY src/ ./src/
COPY . .

# Paso 1: compilar Next.js (genera .next/)
RUN npm run build

# Paso 2: compilar server.ts + todo src/ con tsup en formato ESM
RUN npx tsup \
    --external dotenv \
    --external remotion \
    --external @remotion/renderer \
    --external @remotion/bundler \
    --external @remotion/cli \
    --external @remotion/compositor-linux-x64-musl \
    --external @remotion/compositor-linux-x64-gnu \
    --external @remotion/compositor-linux-arm64-musl \
    --external @remotion/compositor-linux-arm64-gnu \
    server.ts \
    src/core/logger.ts \
    src/core/memory.ts \
    src/core/memory-sqlite.ts \
    src/core/memory-supabase.ts \
    src/core/agent.ts \
    src/core/llm.ts \
    src/core/dispatcher.ts \
    src/integrations/telegram/bot.ts \
    src/tools/index.ts \
    src/tools/call-api.ts \
    src/tools/clear-memory.ts \
    src/tools/list-tools.ts \
    src/tools/read-inbox.ts \
    src/tools/search-memory.ts \
    src/tools/send-email.ts \
    src/tools/set-provider.ts \
    src/tools/save-image.ts \
    src/tools/update-user-context.ts \
    src/tools/generate-video.ts \
    src/tools/obsidian.ts \
    src/tools/desktop/index.ts \
    src/tools/desktop/desktop-utils.ts \
    src/tools/desktop/play-youtube.ts \
    src/tools/desktop/open-application.ts \
    src/tools/desktop/open-folder.ts \
    src/tools/desktop/system-control.ts \
    src/integrations/kie/pending-videos.ts \
    src/integrations/tiktok/pending-posts.ts \
    src/core/embeddings.ts \
    src/core/storage.ts \
    src/core/image-cache.ts \
    src/core/audio-cache.ts \
    src/lib/antv-infographic-dsl.ts \
    src/lib/infographic-render.ts \
    src/lib/infographic-neurona.ts \
    src/lib/notebooklm-infographic.ts \
    src/lib/notebooklm-audio.ts \
    src/tools/create-infographic.ts \
    src/tools/create-infographic-notebooklm.ts \
    src/tools/create-notebooklm-audio.ts \
    src/tools/save-audio.ts \
    src/lib/remotion-render.ts \
    src/tools/create-linkedin-video.ts \
    src/tools/create-tiktok-text-video.ts \
    --format esm --out-dir dist-server --no-dts

ENV NODE_ENV=production
ENV PORT=3000
ENV NOTEBOOKLM_HOME=/app/.notebooklm
RUN mkdir -p /app/.notebooklm/profiles/default

EXPOSE 3000

CMD ["node", "dist-server/server.js"]
