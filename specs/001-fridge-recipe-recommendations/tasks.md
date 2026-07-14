# Tasks: 냉장고 재료 기반 레시피 추천

**Input**: Design documents from `specs/001-fridge-recipe-recommendations/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/openai-api.md`, `quickstart.md`

**Implementation constraint**: 모든 실행 코드는 루트의 `index.html` 하나에 둔다. 별도 프레임워크, 빌드 도구, 로그인, 저장소를 추가하지 않는다.

## Phase 1: Setup

**Purpose**: 단일 정적 웹앱 파일을 준비한다.

- [X] T001 Create root `index.html` with semantic document shell, embedded `<style>`, and embedded `<script>` sections
- [X] T002 Add three screen containers for ingredient selection, recommendation results, and recipe detail in `index.html`

## Phase 2: Foundational

**Purpose**: 모든 사용자 스토리가 공유하는 데이터와 화면 전환 기반을 만든다.

- [X] T003 Define the 20–30 item hardcoded `INGREDIENTS` array and menu/API constants in `index.html`
- [X] T004 Define session-only state for `screen`, `selectedIngredients`, `menus`, `currentMenu`, `previousMenuNames`, `loading`, and `error` in `index.html`
- [X] T005 Implement `showScreen`, shared loading state, error message, and safe text rendering helpers in `index.html`

**Checkpoint**: 공통 상태와 3개 화면 전환 기반이 준비되면 사용자 스토리 구현을 시작한다.

## Phase 3: User Story 1 - 보유 재료로 메뉴 추천받기 (Priority: P1) 🎯 MVP

**Goal**: 사용자가 재료를 선택하고 OpenAI API 추천 결과 3개와 레시피 상세를 확인한다.

**Independent Test**: 재료 2개를 선택하고 추천을 요청해 메뉴 카드 3개를 확인한 뒤, 카드 하나를 눌러 조리시간·난이도·레시피를 확인한다.

### Implementation for User Story 1

- [X] T006 [US1] Render the hardcoded ingredient tag grid and selected-tag summary in `index.html`
- [X] T007 [US1] Add the “기타 재료” text field and comma-split submit handling that trims values, drops blanks, deduplicates names, and merges them into `selectedIngredients` in `index.html`
- [X] T008 [US1] Implement ingredient tag toggle, selected-state rendering, and recommendation button validation in `index.html`
- [X] T009 [US1] Build the OpenAI prompt with selected ingredients, required JSON object schema, and `previousMenuNames` exclusions in `index.html`
- [X] T010 [US1] Implement `/api/agent` RAG request in `index.html` and server-side embedding, Supabase top-k retrieval, OpenAI generation, and menu validation in `api/agent.js`
- [X] T011 [US1] Render up to three recommendation cards with menu name, description, cook time, difficulty, available ingredients, and missing ingredients in `index.html`
- [X] T012 [US1] Connect recommendation card selection to the recipe detail screen and render recipe steps, ingredients, cook time, difficulty, servings, and reference disclaimer in `index.html`
- [X] T013 [US1] Add empty, loading, no-result, malformed-response, and API-failure states with retry guidance in `index.html`

**Checkpoint**: User Story 1 is independently usable as the MVP.

## Phase 4: User Story 2 - 재료 목록 관리하기 (Priority: P2)

**Goal**: 사용자가 현재 세션의 재료 목록을 쉽게 수정하고 초기 상태로 돌아간다.

**Independent Test**: 태그를 선택하고 기타 재료를 추가한 뒤 하나를 제거하고 중복 입력을 시도해 목록이 정확히 유지되는지 확인한다.

### Implementation for User Story 2

- [X] T014 [US2] Implement remove controls for selected ingredient chips and synchronize tag selected styles in `index.html`
- [X] T015 [US2] Normalize ingredient names for case-insensitive and whitespace-insensitive duplicate detection in `index.html`
- [X] T016 [US2] Add “처음으로” and “재료 다시 고르기” actions that clear menus, errors, exclusions, and return to the ingredient screen in `index.html`
- [X] T017 [US2] Keep all ingredient and recommendation state in JavaScript memory only and verify no `localStorage`, `sessionStorage`, login, or persistence code is added to `index.html`

**Checkpoint**: User Story 1 and User Story 2 both work after a single page session reset.

## Phase 5: User Story 3 - 취향과 상황에 맞게 추천 좁히기 (Priority: P3)

**Goal**: 사용자가 조리 조건과 식이 제한을 입력하고 추천 프롬프트에 반영한다.

**Independent Test**: 조리시간·난이도 조건을 선택하고 추천 결과가 해당 조건을 반영하는지 확인한다.

### Implementation for User Story 3

- [X] T018 [US3] Add compact controls for cook-time, difficulty, meal type, allergy, and diet preferences in the ingredient screen of `index.html`
- [X] T019 [US3] Include selected recommendation constraints in the OpenAI prompt and request exclusion of incompatible menus in `index.html`
- [X] T020 [US3] Render active recommendation constraints and explain unmet constraints when the API returns no fully matching menu in `index.html`
- [X] T021 [US3] Add a final allergy and diet warning beside the recipe before the user cooks in `index.html`

**Checkpoint**: All specified user stories are independently demonstrable in the single page.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 접근성, 반응형 화면, 실행 검증을 마무리한다.

- [X] T022 [P] Add responsive layout, focus styles, button labels, live status text, and keyboard-accessible tag controls in `index.html`
- [X] T023 [P] Ensure model-generated values are rendered with text-safe DOM operations and never assigned as executable HTML in `index.html`
- [X] T024 Run every validation scenario in `specs/001-fridge-recipe-recommendations/quickstart.md` against a local static server and fix failures in `index.html`
- [X] T025 Verify OpenAI and Supabase keys stay server-side and document ingestion/Vercel setup in `api/agent.js`, `supabase/schema.sql`, and `specs/001-fridge-recipe-recommendations/quickstart.md`

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup and blocks all user stories
- **User Story 1 (Phase 3)**: depends on Foundational; is the MVP
- **User Story 2 (Phase 4)**: depends on Foundational and the selection state from US1
- **User Story 3 (Phase 5)**: depends on Foundational and the prompt/request flow from US1
- **Polish (Phase 6)**: depends on the desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: no story dependency after Foundational
- **US2 (P2)**: uses US1’s ingredient state and screen helpers; can be validated independently after US1
- **US3 (P3)**: extends US1’s prompt and result flow; can be implemented after US1

### Parallel Opportunities

- T022 and T023 can run in parallel after the core flow is complete.
- T014 and T015 can be prepared in parallel, then wired together in T016.
- T018 and T021 can be prepared in parallel before T019 integrates constraints into the prompt.
- Because all runtime code is intentionally in one file, implementation tasks that edit `index.html` should be applied sequentially to avoid conflicts.

## Parallel Example: User Story 1

```text
After T005:
- T006 ingredient tag grid
- T007 기타 입력 parsing

After T008:
- T011 recommendation cards
- T012 recipe detail rendering

T009 and T010 remain sequential because the request depends on the prompt contract.
```

## Implementation Strategy

### MVP First

1. Complete T001–T005.
2. Complete T006–T013.
3. Validate the core flow using the quickstart scenarios.
4. Stop for a demo before adding P2/P3 enhancements.

### Incremental Delivery

1. Add US1: ingredient selection → OpenAI recommendation → cards → detail.
2. Add US2: duplicate-safe editing and session reset.
3. Add US3: time, difficulty, meal, allergy, and diet constraints.
4. Finish accessibility, security caveat, and quickstart verification.

## Notes

- `[P]` tasks are parallelizable only when they do not edit the same logic at the same time.
- Tests were not added as separate tasks because the user requested task decomposition but did not request TDD or a test framework.
- Every task uses the required checkbox, sequential ID, story label where applicable, and exact file path.
