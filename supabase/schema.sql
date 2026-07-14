create extension if not exists vector;

create table if not exists public.recipe_chunks (
  id bigint generated always as identity primary key,
  chunk_key text,
  recipe_name text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536) not null
);

create index if not exists recipe_chunks_embedding_idx
  on public.recipe_chunks using hnsw (embedding vector_cosine_ops);

alter table public.recipe_chunks add column if not exists chunk_key text;
create unique index if not exists recipe_chunks_chunk_key_idx
  on public.recipe_chunks (chunk_key);

drop function if exists public.match_recipe_chunks(vector, float, integer);

create or replace function public.match_recipe_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  selected_cuisines text[] default '{}'
)
returns table (
  id bigint,
  recipe_name text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    recipe_chunks.id,
    recipe_chunks.recipe_name,
    recipe_chunks.content,
    recipe_chunks.metadata,
    1 - (recipe_chunks.embedding <=> query_embedding) as similarity
  from public.recipe_chunks
  where 1 - (recipe_chunks.embedding <=> query_embedding) > match_threshold
    and (
      cardinality(selected_cuisines) = 0
      or (recipe_chunks.metadata->'cuisine') ?| selected_cuisines
    )
  order by recipe_chunks.embedding <=> query_embedding
  limit match_count;
$$;
