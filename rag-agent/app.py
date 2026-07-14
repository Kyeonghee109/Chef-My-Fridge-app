from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from rag_service import RagService


load_dotenv()
app = FastAPI(title="Fridge Recipe RAG Agent", version="1.0.0")


class RecommendRequest(BaseModel):
    ingredients: list[str] = Field(min_length=1, max_length=50)
    top_k: int = Field(default=3, ge=1, le=10)

    @field_validator("ingredients")
    @classmethod
    def validate_ingredients(cls, values: list[str]) -> list[str]:
        """빈 문자열을 제거하고 실제 재료가 하나 이상 입력됐는지 확인합니다."""
        cleaned = [value.strip() for value in values if value.strip()]
        if not cleaned:
            raise ValueError("재료를 하나 이상 입력하세요.")
        return cleaned


@lru_cache(maxsize=1)
def get_service() -> RagService:
    """요청마다 모델을 다시 만들지 않도록 RAG 서비스를 한 번만 초기화합니다."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY가 설정되지 않았습니다.")
    return RagService()


@app.get("/health")
def health() -> dict[str, str | bool]:
    """API 키와 Chroma 저장소의 준비 상태를 반환합니다."""
    chroma_dir = os.getenv("CHROMA_DIR", "./chroma_db")
    return {
        "status": "ok",
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "chroma_ready": os.path.exists(chroma_dir),
    }


@app.post("/recommend")
def recommend(request: RecommendRequest) -> dict[str, object]:
    """냉장고 재료를 받아 RAG 기반 레시피 추천 목록을 반환합니다."""
    try:
        recommendations = get_service().recommend(request.ingredients, request.top_k)
        if not recommendations:
            return {
                "recommendations": [],
                "message": "입력한 재료와 실제로 겹치는 레시피를 찾지 못했습니다. 다른 재료를 추가해 보세요.",
            }
        return {"recommendations": [recommendation.model_dump() for recommendation in recommendations]}
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="레시피 추천을 생성하지 못했습니다.") from error
