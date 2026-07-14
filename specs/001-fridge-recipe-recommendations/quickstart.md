# Quickstart: 냉장고 재료 기반 레시피 추천

## Prerequisites

- 최신 브라우저
- Vercel 환경변수 `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Supabase SQL Editor에서 `supabase/schema.sql` 실행

OpenAI와 Supabase 키는 브라우저에 전달하지 않는다. 서버 함수와 인덱싱 스크립트에서만 환경변수로 읽는다.

## Run

먼저 레시피 코퍼스를 청킹·임베딩해 Supabase에 적재한다.

```bash
cd "/Users/parkseeun/Desktop/바이브코딩 프로젝트/my-app"
node scripts/ingest-recipes.mjs
npx vercel dev
```

브라우저에서 `http://localhost:3000/`을 열고 재료를 선택한다. 요청은 `/api/agent`로 전달되며 API 키 입력란은 없다.

## Validation Scenarios

1. 재료 선택 화면에서 하드코딩 태그 2개를 선택하고 선택 상태가 표시되는지 확인한다.
2. 기타 입력에 `두부, 대파, ,`를 입력하고 추가하면 빈 값 없이 세 재료가 선택 배열에 합쳐지는지 확인한다.
3. 재료가 없는 상태에서 추천을 요청하면 API 호출 없이 입력 안내가 표시되는지 확인한다.
4. 재료가 있는 상태에서 추천을 요청하면 로딩 상태 후 메뉴명, 설명, 조리시간, 난이도, 레시피가 결과 화면에 표시되는지 확인한다.
5. 메뉴를 선택하면 상세 화면에서 재료와 조리 단계를 확인할 수 있는지 확인한다.
6. “다른 메뉴”를 누르면 두 번째 요청의 제외 목록에 직전 메뉴명이 포함되고 다른 메뉴가 표시되는지 확인한다.
7. API가 실패하거나 잘못된 JSON을 반환하면 사용자용 오류와 재시도 방법이 표시되는지 확인한다.
8. “처음으로”를 누른 뒤 선택 재료와 결과가 초기화되는지 확인한다.
9. 새로고침 후 재료와 추천 결과가 남지 않는지 확인한다.
