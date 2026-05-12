# Feature: Memoria semántica, contexto de usuario y tipos de memoria
**ID:** semantic-memory
**Estado:** in_progress (pendiente migración SQL en Supabase)
**Iniciado:** 2026-05-12

## Plan
1. pgvector en tabla messages (embeddings fire-and-forget)
2. search_memory con búsqueda semántica
3. user_context (project-graph) en metadata + inyección en system prompt
4. Tool update_user_context para gestionar proyectos/objetivos/decisiones

## Implementación
- [x] `supabase/migrations/004_semantic_memory.sql` — columnas embedding + memory_type, índice IVFFlat, RPC search_messages_semantic
- [x] `src/core/memory-supabase.ts` — supabaseSaveMessage devuelve ID, supabaseUpdateMessageEmbedding, supabaseSearchMessagesSemantic
- [x] `src/core/memory.ts` — MemoryType, saveMessage fire-and-forget, searchMessagesSemantic, getUserContext/saveUserContext/getUserContextBlock
- [x] `src/tools/search-memory.ts` — reescrito con búsqueda semántica + fallback keyword
- [x] `src/tools/update-user-context.ts` — tool nueva con 8 operaciones
- [x] `src/tools/index.ts` — import añadido
- [x] `src/core/llm.ts` — getUserContextBlock inyectado en buildSystemPrompt (paralelo con getUserProfileBlock)
- [ ] Migración 004 ejecutada en Supabase SQL Editor (manual, pendiente usuario)
- [ ] Deploy en Dokploy

## Archivos modificados/creados
- `supabase/migrations/004_semantic_memory.sql` — nuevo
- `src/core/memory-supabase.ts` — 3 funciones nuevas, 1 actualizada
- `src/core/memory.ts` — saveMessage actualizado, 6 funciones/tipos nuevos
- `src/tools/search-memory.ts` — reescrito
- `src/tools/update-user-context.ts` — nuevo
- `src/tools/index.ts` — import añadido
- `src/core/llm.ts` — getUserContextBlock inyectado

## Paso manual pendiente (usuario)
Ejecutar en **Supabase → SQL Editor**:
```sql
-- (contenido de supabase/migrations/004_semantic_memory.sql)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'episodic';
CREATE INDEX IF NOT EXISTS messages_embedding_idx
    ON messages USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
CREATE OR REPLACE FUNCTION search_messages_semantic(
    p_embedding  vector(1536),
    p_chat_id    TEXT,
    p_limit      INT DEFAULT 10
)
RETURNS TABLE(role TEXT, content TEXT, memory_type TEXT, similarity FLOAT)
LANGUAGE sql STABLE AS $$
    SELECT role::TEXT, content, memory_type,
           (1 - (embedding <=> p_embedding))::FLOAT AS similarity
    FROM messages
    WHERE chat_id = p_chat_id AND embedding IS NOT NULL
    ORDER BY embedding <=> p_embedding
    LIMIT p_limit;
$$;
```

## Checkpoints
| Checkpoint | Estado | Notas |
|---|---|---|
| C1 — Coherencia de estado | ✅ | feature_list.json actualizado |
| C2 — TypeScript compila | ✅ | npx tsc --noEmit sin errores |
| C3 — Tool registrada | ✅ | update_user_context + search_memory en index.ts |
| C4 — Env vars documentadas | ✅ | OPENAI_API_KEY ya existía en .env.example |
| C5 — Build pasa | ⏳ | Pendiente deploy post-migración |

## Notas técnicas
- Los embeddings se generan de forma asíncrona (fire-and-forget) tras guardar cada mensaje — no bloquea la respuesta del agente
- Si OPENAI_API_KEY no está configurada, search_memory cae automáticamente a keyword search
- El user_context se inyecta en el system prompt en PARALELO con getUserProfileBlock (Promise.all) — sin latencia extra
- La tabla messages ya tenía la columna id (BIGINT) — compatible con el cambio de void → number en supabaseSaveMessage
