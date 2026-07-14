-- 중단된 ingest를 재실행할 수 있도록 레시피 청크의 안정적인 upsert 키를 추가합니다.
alter table public.recipe_chunks add column if not exists chunk_key text;

create unique index if not exists recipe_chunks_chunk_key_idx
  on public.recipe_chunks (chunk_key);
