-- 대량 적재·갱신으로 누적된 죽은 인덱스 항목을 제거해 HNSW 탐색 성능을 회복합니다.
set statement_timeout = 0;
reindex index public.recipe_chunks_embedding_idx;
