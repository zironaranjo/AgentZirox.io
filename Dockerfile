FROM node:20-bullseye-slim

WORKDIR /app

# herramientas de compilación para better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# dependencias (cacheado mientras package.json no cambie)
COPY package.json package-lock.json ./
RUN npm ci

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
    src/core/embeddings.ts \
    src/core/storage.ts \
    src/core/image-cache.ts \
    --format esm --out-dir dist-server --no-dts

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist-server/server.js"]
