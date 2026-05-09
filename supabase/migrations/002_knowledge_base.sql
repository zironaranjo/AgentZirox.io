-- Base de conocimiento con búsqueda vectorial (pgvector).
-- Ejecutar en Supabase → SQL Editor → New query.
-- Requiere la extensión pgvector (disponible en todos los proyectos Supabase).

create extension if not exists vector;

create table if not exists public.knowledge (
  id bigint generated always as identity primary key,
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice HNSW para búsqueda semántica (más rápido para tablas pequeñas-medianas)
create index if not exists knowledge_embedding_hnsw
  on public.knowledge using hnsw (embedding vector_cosine_ops);

-- Índice FTS para búsqueda por palabras clave
create index if not exists knowledge_fts
  on public.knowledge using gin(to_tsvector('spanish', title || ' ' || content));

-- Función de búsqueda semántica: recibe el embedding como float8[] y lo castea a vector
create or replace function public.search_knowledge_semantic(
  p_embedding float8[],
  p_limit int default 5
)
returns table (
  id bigint,
  title text,
  content text,
  tags text[],
  similarity float8,
  created_at timestamptz
)
language sql
as $$
  select
    k.id,
    k.title,
    k.content,
    k.tags,
    1 - (k.embedding <=> p_embedding::vector) as similarity,
    k.created_at
  from public.knowledge k
  where k.embedding is not null
  order by k.embedding <=> p_embedding::vector
  limit p_limit;
$$;

alter table public.knowledge enable row level security;

revoke all on function public.search_knowledge_semantic(float8[], int) from public;
grant execute on function public.search_knowledge_semantic(float8[], int) to service_role;
grant execute on function public.search_knowledge_semantic(float8[], int) to postgres;
