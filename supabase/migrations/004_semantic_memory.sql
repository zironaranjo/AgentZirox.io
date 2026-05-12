-- 004_semantic_memory.sql
-- Búsqueda semántica en mensajes (pgvector) + tipos de memoria + contexto de usuario

-- Habilitar extensión pgvector (puede que ya esté activa por la knowledge table)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Tabla messages: columnas de embedding y tipo ──────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'episodic';

-- Índice IVFFlat para búsqueda aproximada por similitud coseno
-- Nota: este índice mejora con el tiempo a medida que se acumulan mensajes
CREATE INDEX IF NOT EXISTS messages_embedding_idx
    ON messages USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ── Función de búsqueda semántica en mensajes ─────────────────────────────────
CREATE OR REPLACE FUNCTION search_messages_semantic(
    p_embedding  vector(1536),
    p_chat_id    TEXT,
    p_limit      INT DEFAULT 10
)
RETURNS TABLE(
    role        TEXT,
    content     TEXT,
    memory_type TEXT,
    similarity  FLOAT
)
LANGUAGE sql STABLE AS $$
    SELECT
        role::TEXT,
        content,
        memory_type,
        (1 - (embedding <=> p_embedding))::FLOAT AS similarity
    FROM messages
    WHERE chat_id = p_chat_id
      AND embedding IS NOT NULL
    ORDER BY embedding <=> p_embedding
    LIMIT p_limit;
$$;
