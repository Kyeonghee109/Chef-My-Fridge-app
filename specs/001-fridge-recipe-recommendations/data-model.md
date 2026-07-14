# Data Model: 냉장고 재료 기반 레시피 추천

## Ingredient

하드코딩된 선택지와 사용자가 입력한 기타 재료를 동일한 문자열 배열로 관리한다.

| Field | Type | Rules |
|---|---|---|
| `name` | string | 공백 제거 후 1자 이상, 중복은 대소문자·공백을 정규화해 제거 |
| `source` | `preset \| custom` | 화면 표시용 선택지 구분 |

실행 상태에서는 `selectedIngredients: string[]`만 필수로 유지한다. 기타 입력은 쉼표로 분리하고 빈 항목을 제거한 뒤 배열에 합친다.

## Menu

```text
menu {
  name: string
  description: string
  recipe: string[]
  cookTime: string
  difficulty: "쉬움" | "보통" | "어려움" | string
  ingredients?: string[]
  missingIngredients?: string[]
  servings?: string
}
```

- `name`, `description`, `recipe`, `cookTime`, `difficulty`는 API 응답 필수 필드다.
- `recipe`는 순서가 있는 조리 단계 배열이다.
- `ingredients`와 `missingIngredients`가 있으면 결과 카드와 상세 화면에서 보유·추가 재료를 구분한다.
- 알 수 없는 추가 필드는 무시한다.

## Session State

```text
state {
  screen: "ingredients" | "results" | "detail"
  selectedIngredients: string[]
  menus: Menu[]
  currentMenu: Menu | null
  previousMenuNames: string[]
  loading: boolean
  error: string | null
}
```

상태는 페이지를 새로고침하면 초기화된다. 로그인, `localStorage`, `sessionStorage`, 사용자별 서버 저장은 사용하지 않는다.

## Validation and Transitions

- 추천 요청은 `selectedIngredients.length > 0`일 때만 실행한다.
- `loading` 중에는 추천·다른 메뉴 버튼을 비활성화한다.
- 추천 성공: `menus`에 최대 3개 메뉴 설정 → `screen = results`.
- 메뉴 선택: `screen = detail`.
- 다른 메뉴: 현재 메뉴명을 제외 목록에 추가 → API 재호출 → `menus`를 새 결과로 교체.
- 처음으로: 상태를 비우고 `screen = ingredients`로 이동한다.
- API 오류·JSON 오류: `loading = false`, `error` 설정, 재료 선택 화면 또는 결과 화면에 재시도 UI 표시.
