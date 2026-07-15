from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from pydantic import BaseModel, Field

from recipe_loader import load_recipes
from retriever import filter_candidates_by_cuisines, rank_candidates, select_diverse_candidates
from trace_utils import trace


EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


class Recommendation(BaseModel):
    recipe_title: str
    cuisine: list[str] = Field(default_factory=list)
    matched_ingredients: list[str] = Field(default_factory=list)
    missing_ingredients: list[str] = Field(default_factory=list)
    match_count: int = 0
    match_ratio: float = 0.0
    coverage_ratio: float = 0.0
    reason: str


class RecommendationResponse(BaseModel):
    recommendations: list[Recommendation]


class RagService:
    def __init__(self) -> None:
        """임베딩 모델, Chroma 저장소, Anthropic Claude 클라이언트를 초기화합니다."""
        base_dir = Path(__file__).parent
        chroma_dir = Path(os.getenv("CHROMA_DIR", base_dir / "chroma_db"))
        if not chroma_dir.exists():
            raise RuntimeError("Chroma DB가 없습니다. 먼저 `python ingest.py --reset`을 실행하세요.")
        loaded_recipes = load_recipes(os.getenv("DATA_PATH", base_dir / "data/recipes.json"))
        self.recipes = {recipe["id"]: recipe for recipe in loaded_recipes}
        self.recipes_by_title = {recipe["title"]: recipe for recipe in loaded_recipes}
        embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
        self.store = Chroma(
            collection_name="recipes",
            embedding_function=embeddings,
            persist_directory=str(chroma_dir),
        )
        self.llm = ChatAnthropic(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            temperature=0,
            max_tokens=1200,
        )

    @staticmethod
    @trace
    def query_from_ingredients(ingredients: list[str], cuisines: list[str] | None = None) -> str:
        """사용자 재료 목록을 벡터 검색용 자연어 질의로 변환합니다."""
        cuisine_text = f"{' '.join(cuisines or [])} 음식" if cuisines else ""
        return f"{' '.join(ingredients)} {cuisine_text}로 만들 수 있는 요리 레시피"

    @trace
    def recommend(self, ingredients: list[str], top_k: int, cuisines: list[str] | None = None) -> list[Recommendation]:
        """후보 레시피를 검색하고 재료 매칭 결과를 Claude의 구조화된 추천으로 변환합니다."""
        # 호출 경로가 달라도 서비스는 항상 3개 후보를 준비한 뒤 반환합니다.
        top_k = 3
        cuisines = cuisines or []
        query = self.query_from_ingredients(ingredients, cuisines)
        # 상위 3개만 검색하면 재료가 실제로 겹치는 레시피가 뒤로 밀릴 수 있으므로 충분히 넓게 검색합니다.
        search_k = min(max(top_k * 100, 1000), max(len(self.recipes), top_k))
        retrieved = self.store.similarity_search_with_score(query, k=search_k)
        vector_candidates: list[dict[str, Any]] = []
        for document, distance in retrieved:
            recipe_id = document.metadata.get("recipe_id", "")
            recipe = self.recipes.get(recipe_id)
            if recipe is None:
                recipe = self.recipes_by_title.get(document.metadata.get("title", ""))
            if not recipe:
                continue
            vector_candidates.append({"recipe": recipe, "vector_score": 1 / (1 + max(distance, 0))})
        if cuisines:
            vector_candidates = filter_candidates_by_cuisines(vector_candidates, cuisines)
        ranked_candidates = rank_candidates(ingredients, vector_candidates, top_k=max(top_k * 5, 20))
        if not ranked_candidates:
            return []
        selected_candidates = select_diverse_candidates(ranked_candidates, top_k, cuisines_selected=bool(cuisines))
        if len(selected_candidates) < 3:
            return []

        context = json.dumps(
            [
                {
                    "title": item["recipe"]["title"],
                    "cuisine": item["recipe"]["cuisine"],
                    "ingredients": item["recipe"]["ingredients"],
                    "steps": item["recipe"]["steps"],
                    "tags": item["recipe"]["tags"],
                    "cook_time": item["recipe"]["cook_time"],
                    "matched_ingredients": item["matched_ingredients"],
                    "missing_ingredients": item["missing_ingredients"],
                    "match_count": item["match_count"],
                    "match_ratio": item["match_ratio"],
                    "coverage_ratio": item["coverage_ratio"],
                }
                for item in ranked_candidates
            ],
            ensure_ascii=False,
        )
        prompt = f"""사용자의 냉장고 재료에 맞는 레시피를 추천하세요.
보유 재료: {', '.join(ingredients)}
검색 후보(JSON): {context}

규칙:
- 검색 후보에 있는 레시피만 추천하세요.
- 보유 재료 활용도가 높고 부족한 재료가 적은 순서를 우선하세요.
- 조리 시간이 짧고 쉬운 레시피를 우선하되, 검색 적합도가 더 중요합니다.
- 각 후보의 matched_ingredients와 missing_ingredients를 그대로 반영하세요.
- recipe_title, matched_ingredients, missing_ingredients, reason 필드만 반환하세요.
"""
        structured = self.llm.with_structured_output(RecommendationResponse)
        response = structured.invoke(prompt)

        # Claude가 누락하거나 중복해서 반환한 항목을 제거하고 검색 결과 순서로 부족한 수를 보충합니다.
        reason_by_title = {recommendation.recipe_title: recommendation.reason for recommendation in response.recommendations}
        return [
            Recommendation(
                recipe_title=item["recipe"]["title"],
                cuisine=item["recipe"]["cuisine"],
                matched_ingredients=item["matched_ingredients"],
                missing_ingredients=item["missing_ingredients"],
                match_count=item["match_count"],
                match_ratio=item["match_ratio"],
                coverage_ratio=item["coverage_ratio"],
                reason=reason_by_title.get(item["recipe"]["title"], "재료 매칭 점수와 음식 종류 다양성을 고려해 추천합니다."),
            )
            for item in selected_candidates
        ]
