-- HNSW 인덱스가 먼저 작은 후보군을 반환하도록 검색 순서를 분리합니다.
-- 기존 쿼리는 similarity 조건과 정렬을 한 단계에서 수행해 5만여 청크를
-- 광범위하게 평가할 수 있었고, RPC가 10초 이상 지연됐습니다.
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
  with nearest as materialized (
    select
      recipe_chunks.id,
      recipe_chunks.recipe_name,
      recipe_chunks.content,
      recipe_chunks.metadata,
      recipe_chunks.embedding <=> query_embedding as distance
    from public.recipe_chunks
    order by recipe_chunks.embedding <=> query_embedding
    -- 음식 종류 필터로 일부 후보가 빠져도 결과를 채울 수 있도록 여유 후보를 받습니다.
    limit least(greatest(match_count * 4, 40), 100)
  )
  select
    nearest.id,
    nearest.recipe_name,
    nearest.content,
    nearest.metadata,
    (1 - nearest.distance)::float as similarity
  from nearest
  where (1 - nearest.distance) > match_threshold
    and (
      cardinality(selected_cuisines) = 0
      or (nearest.metadata->'cuisine') ?| selected_cuisines
    )
  order by nearest.distance
  limit match_count;
$$;
