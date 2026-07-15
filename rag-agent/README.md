# Fridge Recipe RAG Agent

냉장고 재료를 입력하면 Chroma 벡터 검색과 Anthropic Claude를 이용해 레시피를 추천하는 FastAPI 서비스입니다.

샘플 데이터는 한식, 양식, 중식, 일식, 분식 등 10,000개 이상의 레시피를 포함합니다. 임베딩에는 한국어 검색을 지원하는 Sentence Transformers 모델을 사용하고, 최종 추천 생성에는 `claude-sonnet-4-6`을 사용합니다.

## 실행

```bash
cd rag-agent
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env에 ANTHROPIC_API_KEY 입력

# 1. 레시피를 임베딩하고 Chroma DB에 저장합니다.
# 기본적으로 기존 Chroma DB를 삭제하고 새로 적재합니다.
python ingest.py

# 기존 DB에 추가만 하려면 다음을 사용합니다.
# python ingest.py --append

# 2. API 서버 실행
uvicorn app:app --reload
```

최초 `ingest.py` 실행 시 다국어 Sentence Transformers 임베딩 모델을 다운로드합니다.

## API

```bash
curl -X POST http://127.0.0.1:8000/recommend \
  -H 'content-type: application/json' \
  -d '{"ingredients":["계란","양파","감자"],"top_k":3,"cuisines":["한식","분식"]}'
```

```json
{
  "recommendations": [
    {
      "recipe_title": "감자채 볶음",
      "cuisine": ["한식"],
      "matched_ingredients": ["감자", "양파"],
      "missing_ingredients": ["당근", "소금", "식용유"],
      "match_count": 2,
      "match_ratio": 0.4,
      "coverage_ratio": 0.6667,
      "reason": "보유한 감자와 양파를 활용할 수 있고 조리 시간이 짧습니다."
    }
  ]
}
```

`GET /health`로 API, Anthropic 키 설정, Chroma DB 준비 상태를 확인할 수 있습니다.

벡터 유사도만 높고 보유 재료가 실제로 하나도 겹치지 않는 레시피는 추천에서 제외합니다. 일치하는 후보가 없으면 빈 목록과 안내 메시지를 반환합니다. Claude가 결과를 누락하거나 중복해도 검색 후보에서 결과를 보충해 가능한 경우 `top_k`개를 반환합니다.

최종 추천에는 `match_count`, `match_ratio`, `coverage_ratio`, `missing_ingredients`가 포함됩니다. 벡터 검색은 넓은 1차 후보군을 만들 때만 사용하고, 최종 순위는 다음 하이브리드 점수로 재정렬합니다.

```text
final_score = (match_count * 0.5) + (match_ratio * 0.3) + (coverage_ratio * 0.2)
```

재료 정규화 동의어는 [ingredient_aliases.json](ingredient_aliases.json)에서 관리합니다.

음식 종류를 선택하지 않은 경우에는 최종 후보 점수가 크게 낮아지지 않는 범위에서 서로 다른 cuisine을 우선하는 다양성 보정을 적용합니다. cuisine을 직접 선택한 경우에는 사용자의 선택을 우선해 점수 순으로 추천합니다.

## 만개의레시피 개별 URL 가져오기

만개의레시피의 공개 대량 데이터 다운로드 없이, 사용 권한이 있는 개별 레시피 URL만 가져옵니다. URL 목록을 한 줄에 하나씩 `urls.txt`에 저장한 뒤 실행합니다.

```bash
python scripts/import_10000recipe.py urls.txt
python ingest.py
```

가져온 레시피에는 `source: "10000recipe"`, `source_url`, `cuisine`이 기록됩니다. `죽`은 한식, `스프`·`수프`는 양식으로 분류합니다.

테스트:

```bash
pytest -q
```

## 함수 호출 추적

`trace_utils.py`의 `@trace` 데코레이터는 함수 입력·출력·실행 시간·토큰 사용량과 중첩 호출 트리를 로그로 출력합니다. LangChain 응답의 `usage_metadata`와 `response_metadata`를 자동 인식하며 API 키와 토큰 값은 마스킹합니다.

```python
from trace_utils import trace

@trace
def load_candidates(query: str) -> dict:
    return {"items": [query]}
```

로그 예시는 다음과 같습니다.

```text
@trace 호출 트리
└─ RagService.recommend {"ms": 842.1, "tokens": {"input": 900, "output": 180, "total": 1080}}
  └─ RagService.query_from_ingredients {"ms": 0.1, "tokens": {}}
```
