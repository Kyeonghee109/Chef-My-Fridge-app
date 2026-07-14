from fastapi.testclient import TestClient

from app import app, get_service
from rag_service import Recommendation


class FakeRagService:
    """외부 임베딩과 Claude 호출 없이 API 응답 형식만 검증하는 가짜 서비스입니다."""

    def recommend(self, ingredients: list[str], top_k: int) -> list[Recommendation]:
        """match_count와 match_ratio가 API JSON으로 전달되는 샘플 응답을 반환합니다."""
        return [
            Recommendation(
                recipe_title="테스트 볶음",
                matched_ingredients=["계란", "양파"],
                missing_ingredients=["소금"],
                match_count=2,
                match_ratio=0.6667,
                coverage_ratio=1.0,
                reason="두 재료가 일치합니다.",
            )
        ]


def test_recommend_returns_match_scores_and_missing_ingredients(monkeypatch) -> None:
    """POST /recommend가 매칭 점수와 부족 재료를 함께 반환하는지 확인합니다."""
    monkeypatch.setattr("app.get_service", lambda: FakeRagService())
    client = TestClient(app)

    response = client.post("/recommend", json={"ingredients": ["계란", "양파"], "top_k": 3})

    assert response.status_code == 200
    recommendation = response.json()["recommendations"][0]
    assert recommendation["match_count"] == 2
    assert recommendation["match_ratio"] == 0.6667
    assert recommendation["missing_ingredients"] == ["소금"]

