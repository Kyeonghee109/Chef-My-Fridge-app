# Research: 냉장고 재료 기반 레시피 추천

## Decision: 단일 정적 HTML과 브라우저 기본 API 사용

- **Decision**: `index.html`에 마크업, CSS, 재료 배열, 상태 관리, API 호출, 렌더링을 모두 둔다.
- **Rationale**: 사용자가 프레임워크와 빌드 단계를 명시적으로 제외했고, 3개 화면과 한 세션 상태에는 기본 DOM API로 충분하다.
- **Alternatives considered**: 프론트엔드 프레임워크, 별도 JS/CSS 파일, 서버 API. 모두 현재 범위에 불필요한 파일·설정·배포 단계를 추가한다.

## Decision: OpenAI API 응답은 제한된 JSON 계약으로 수신

- **Decision**: Chat Completions 요청에 JSON object 응답 형식을 요구하고, `choices[0].message.content`를 파싱한 뒤 필수 필드를 검증한다.
- **Rationale**: 메뉴 카드와 상세 레시피를 안정적으로 렌더링하려면 자유 형식 텍스트보다 고정된 `menu` 객체가 단순하다.
- **Alternatives considered**: 모델 응답을 그대로 Markdown으로 렌더링. 필드 누락·서식 변형에 취약하고 HTML 삽입 위험이 커 제외한다.

## Decision: 추천 재요청 시 직전 메뉴 이름을 제외

- **Decision**: `previousMenuNames` 배열에 현재 메뉴명을 추가하고 다음 프롬프트에 제외 목록으로 전달한다.
- **Rationale**: 서버 저장 없이도 같은 세션에서 “다른 메뉴” 요구를 만족한다.
- **Alternatives considered**: 모든 과거 결과 저장 또는 메뉴 중복을 화면에서 필터링. 전자는 범위를 키우고 후자는 모델이 이미 만든 결과의 중복을 완전히 막지 못한다.

## Decision: 직접 브라우저 호출은 프로토타입 범위로 제한

- **Decision**: Fetch 호출 위치는 브라우저로 두되 방문자가 입력한 OpenAI API 키를 JS 메모리에만 둔다. 키 저장 금지와 배포 전 서버 중계 필요성을 `quickstart.md`에 명시한다.
- **Rationale**: 사용자가 직접 `fetch`를 요구했지만 브라우저 소스의 키는 보호할 수 없다.
- **Alternatives considered**: 서버 프록시. 보안상 더 적절하지만 “단일 index.html” 범위를 벗어나므로 후속 배포 단계로 남긴다.
