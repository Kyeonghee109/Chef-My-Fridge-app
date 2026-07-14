# Implementation Plan: 냉장고 재료 기반 레시피 추천

**Branch**: `001-fridge-recipe-recommendations` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification plus user constraints: `index.html` frontend, server-only OpenAI API access, Supabase pgvector RAG, hardcoded ingredient array, and session-only state.

## Summary

사용자가 냉장고 재료를 선택하거나 기타 재료를 입력하면, 단일 정적 웹페이지가 OpenAI API에 재료 목록을 전달해 메뉴와 레시피를 JSON으로 받고 3개 화면 흐름으로 렌더링한다. 로그인과 영구 저장은 제외하며 상태는 페이지 세션 동안 JS 메모리에만 유지한다.

## Technical Context

**Language/Version**: HTML5, CSS3, modern browser JavaScript (ES modules 없이 단일 스크립트)

**Primary Dependencies**: Vercel Functions, OpenAI Embeddings/Chat Completions, Supabase pgvector REST API. 프론트엔드 프레임워크 없음

**Storage**: 레시피 청크와 임베딩은 Supabase `recipe_chunks`에 저장; 사용자 선택과 결과는 JS 메모리만 사용

**Testing**: 브라우저 수동 검증 및 작은 JavaScript 자가 점검 함수. 별도 테스트 프레임워크 없음

**Target Platform**: Vercel Functions와 Supabase, 최신 데스크톱·모바일 브라우저

**Project Type**: Vercel Functions를 포함한 웹앱

**Performance Goals**: 재료 선택과 화면 전환은 즉시 반응하고, API 응답 후 1초 이내에 결과를 렌더링

**Constraints**: 프론트엔드에 API 키 노출 금지; `OPENAI_API_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`는 서버 환경변수만 사용; 레시피 검색 결과만 생성 모델 컨텍스트로 사용; API 실패와 잘못된 JSON을 사용자에게 안내

**Scale/Scope**: 20~30개 하드코딩 재료 태그, 3개 화면, 한 세션의 현재 추천 1개와 직전 메뉴 제외 목록 관리

## Constitution Check

프로젝트 헌법은 아직 템플릿 placeholder 상태이며 적용 가능한 별도 원칙이 없다. 단일 파일·무의존성 요구를 그대로 적용하므로 위반 없음. **Gate: PASS**.

## Project Structure

```text
index.html       # 화면 마크업, 내장 CSS, 재료 데이터, 상태, RAG API 호출, 렌더링
api/agent.js     # 임베딩 → Supabase top-k 검색 → OpenAI 생성
data/recipes.json # 레시피 원문 코퍼스
scripts/ingest-recipes.mjs # 레시피 청킹·임베딩·Supabase 적재
supabase/schema.sql # pgvector 테이블과 검색 RPC
specs/001-fridge-recipe-recommendations/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/openai-api.md
```

**Structure Decision**: 화면은 `index.html`에 두고, 비밀키가 필요한 RAG 흐름은 `api/agent.js`로 분리한다. Supabase는 레시피 청크·임베딩 저장과 top-k 검색만 담당한다.

## Complexity Tracking

헌법 위반 없음. 별도 복잡도 정당화가 필요하지 않다.

## Phase 1 Re-check

- 단일 `index.html` 요구 준수
- 레시피 코퍼스 최초 적재는 `scripts/ingest-recipes.mjs`로 한 번 실행
- API 응답 검증, 실패 안내, 알레르기 경고를 설계에 포함
- OpenAI/Supabase 키는 서버 환경변수에서만 읽고 클라이언트에 반환하지 않음
