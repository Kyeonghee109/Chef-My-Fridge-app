# OpenAI API Contract

## Request

브라우저는 `/api/agent`에 재료와 조건만 전달한다. 서버 함수가 OpenAI 임베딩과 Chat Completions를 호출한다.

```json
{
  "model": "gpt-4o-mini",
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "You return only valid JSON." },
    { "role": "user", "content": "보유 재료와 조건을 포함한 추천 프롬프트" }
  ]
}
```

프롬프트는 `menus` 배열 안에 서로 다른 메뉴 3개를 반환하도록 요구하고, `previousMenuNames`의 메뉴는 제외한다.

## Response Payload

응답의 `choices[0].message.content`는 다음 JSON 객체다.

```json
{
  "menus": [
    {
      "name": "계란 양파 볶음밥",
      "description": "간단하게 만들 수 있는 한 끼 메뉴",
      "recipe": ["양파를 썬다", "팬에 재료를 볶는다", "계란과 밥을 넣고 익힌다"],
      "cookTime": "15분",
      "difficulty": "쉬움",
      "ingredients": ["계란 2개", "양파 1/2개", "밥 1공기"],
      "missingIngredients": []
    }
  ]
}
```

## Client Validation

- HTTP 실패는 사용자에게 재시도 메시지를 표시한다.
- `menus`가 없거나 1~3개가 아니면 유효하지 않은 응답으로 처리한다.
- 각 메뉴에 `name`, `description`, `recipe`, `cookTime`, `difficulty`가 없으면 유효하지 않은 응답으로 처리한다.
- 표시할 문자열은 텍스트 DOM API로 삽입해 모델 출력이 HTML로 실행되지 않게 한다.
- API 키는 서버 환경변수에서만 읽고 브라우저 응답이나 로그에 포함하지 않는다.
