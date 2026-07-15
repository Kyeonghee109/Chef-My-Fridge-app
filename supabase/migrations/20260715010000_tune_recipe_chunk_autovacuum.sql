-- 대량 재적재 후 죽은 행이 누적돼 HNSW 검색이 느려지는 것을 방지합니다.
alter table public.recipe_chunks set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2
);
