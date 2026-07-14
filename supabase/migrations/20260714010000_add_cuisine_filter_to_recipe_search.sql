-- 선택한 음식 종류를 벡터 검색 단계에서 먼저 적용해 관련 카테고리 후보를 보장합니다.
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
