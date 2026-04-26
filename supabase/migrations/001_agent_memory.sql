-- AgenteZirox: memoria persistente en Postgres (Supabase).
-- Ejecutar en Supabase → SQL → New query (o supabase db push).
-- Usa solo la SERVICE ROLE KEY en el servidor; nunca en el cliente.

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  chat_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_chat_created on public.messages (chat_id, created_at desc);

create table if not exists public.metadata (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scheduled_tasks (
  id bigint generated always as identity primary key,
  chat_id text not null,
  instruction text not null,
  run_at_ms bigint not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists idx_sched_due on public.scheduled_tasks (status, run_at_ms);

create table if not exists public.linkedin_pending_posts (
  id bigint generated always as identity primary key,
  chat_id text not null,
  body text not null,
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'CONNECTIONS')),
  status text not null default 'pending' check (status in ('pending', 'rejected', 'published', 'failed')),
  linkedin_response text,
  error text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_li_pending_chat on public.linkedin_pending_posts (chat_id, status);

-- Una sola instancia "claim" por fila; varias réplicas del bot pueden escalar con SKIP LOCKED.
create or replace function public.claim_next_due_scheduled_task(p_now_ms bigint)
returns setof public.scheduled_tasks
language sql
as $$
  with cte as (
    select id from public.scheduled_tasks
    where status = 'pending' and run_at_ms <= p_now_ms
    order by run_at_ms asc
    limit 1
    for update skip locked
  )
  update public.scheduled_tasks s
  set status = 'running'
  from cte
  where s.id = cte.id and s.status = 'pending'
  returning s.*;
$$;

alter table public.messages enable row level security;
alter table public.metadata enable row level security;
alter table public.scheduled_tasks enable row level security;
alter table public.linkedin_pending_posts enable row level security;

-- Sin políticas: solo service_role (backend) accede; anon/authenticated quedan bloqueados.

revoke all on function public.claim_next_due_scheduled_task(bigint) from public;
grant execute on function public.claim_next_due_scheduled_task(bigint) to service_role;
grant execute on function public.claim_next_due_scheduled_task(bigint) to postgres;
