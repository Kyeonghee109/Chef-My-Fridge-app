from fastapi.testclient import TestClient

from app import app, get_service
from rag_service import Recommendation


class FakeRagService:
    """외부 임베딩과 Claude 호출 없이 API 응답 형식만 검증하는 가짜 서비스입니다."""

    def recommend(self, ingredients: list[str], top_k: int, cuisines: list[str] | None = None) -> list[Recommendation]:
        """match_count와 match_ratio가 API JSON으로 전달되는 샘플 응답을 반환합니다."""
        return [
            Recommendation(
                recipe_title="테스트 볶음",
                cuisine=["한식"],
                matched_ingredients=["계란", "양파"],
                missing_ingredients=["소금"],
                match_count=2,
                match_ratio=0.6667,
                coverage_ratio=1.0,
                reason="두 재료가 일치합니다.",
            )
        ]


class EmptyRagService:
    """음식 종류 조건에 맞는 후보가 없을 때를 재현하는 가짜 서비스입니다."""

    def recommend(self, ingredients: list[str], top_k: int, cuisines: list[str] | None = None) -> list[Recommendation]:
        """빈 추천 결과를 반환합니다."""
        return []


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
    assert recommendation["cuisine"] == ["한식"]


def test_recommend_accepts_multiple_cuisines(monkeypatch) -> None:
    """복수 cuisine 배열을 포함한 요청을 API가 허용하는지 확인합니다."""
    monkeypatch.setattr("app.get_service", lambda: FakeRagService())
    client = TestClient(app)

    response = client.post(
        "/recommend",
        json={"ingredients": ["계란"], "top_k": 3, "cuisines": ["한식", "중식"]},
    )

    assert response.status_code == 200
    assert response.json()["recommendations"][0]["cuisine"] == ["한식"]


def test_recommend_rejects_unknown_cuisine() -> None:
    """고정된 다섯 카테고리 밖의 cuisine은 422로 거절합니다."""
    client = TestClient(app)

    response = client.post("/recommend", json={"ingredients": ["계란"], "cuisines": ["태국식"]})

    assert response.status_code == 422


def test_recommend_returns_cuisine_message_when_no_candidate(monkeypatch) -> None:
    """조건에 맞는 후보가 없으면 안내 메시지를 반환합니다."""
    monkeypatch.setattr("app.get_service", lambda: EmptyRagService())
    client = TestClient(app)

    response = client.post(
        "/recommend",
        json={"ingredients": ["초콜릿"], "cuisines": ["한식"]},
    )

    assert response.status_code == 200
    assert response.json()["recommendations"] == []
    assert "선택하신 음식 종류" in response.json()["message"]
