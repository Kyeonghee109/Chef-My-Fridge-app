from __future__ import annotations

import json
from pathlib import Path
from typing import Any


FIXED_CUISINES = {"한식", "중식", "양식", "일식"}
LEGACY_CUISINE_ALIASES = {"분식": "한식"}


def format_ingredient(value: Any) -> str:
    """문자열 또는 수량 객체 재료를 검색 문서용 문자열로 변환합니다."""
    if isinstance(value, dict):
        return " ".join(str(value.get(key, "")) for key in ("name", "amount", "unit") if value.get(key, "") != "")
    return str(value)


def load_recipes(path: str | Path) -> list[dict[str, Any]]:
    """JSON 파일을 읽고 레시피 필수 필드와 자료형을 검증합니다."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("레시피 데이터는 JSON 배열이어야 합니다.")

    required = {"id", "title", "ingredients", "steps", "tags", "cuisine", "cook_time"}
    for index, recipe in enumerate(data):
        if not isinstance(recipe, dict) or not required.issubset(recipe):
            raise ValueError(f"레시피 {index}에 필요한 필드가 없습니다: {sorted(required)}")
        if not isinstance(recipe["ingredients"], list) or not isinstance(recipe["steps"], list):
            raise ValueError(f"레시피 {index}의 ingredients와 steps는 배열이어야 합니다.")
        if any(not isinstance(item, (str, dict)) or (isinstance(item, dict) and not item.get("name")) for item in recipe["ingredients"]):
            raise ValueError(f"레시피 {index}의 ingredients 항목은 문자열 또는 name을 가진 객체여야 합니다.")
        if isinstance(recipe["cuisine"], list):
            recipe["cuisine"] = list(dict.fromkeys(LEGACY_CUISINE_ALIASES.get(value, value) for value in recipe["cuisine"]))
        if not isinstance(recipe["cuisine"], list) or not recipe["cuisine"] or not set(recipe["cuisine"]).issubset(FIXED_CUISINES):
            raise ValueError(f"레시피 {index}의 cuisine은 고정 카테고리 배열이어야 합니다.")
    return data


def recipe_to_document(recipe: dict[str, Any]) -> str:
    """검색 품질을 높이도록 제목·재료·태그·조리법을 하나의 문서로 합칩니다."""
    return "\n".join(
        [
            f"제목: {recipe['title']}",
            f"설명: {recipe.get('description', '')}",
            f"재료: {', '.join(format_ingredient(item) for item in recipe['ingredients'])}",
            f"태그: {', '.join(recipe['tags'])}",
            f"음식 종류: {', '.join(recipe['cuisine'])}",
            f"조리 시간: {recipe['cook_time']}분",
            f"조리법: {' '.join(recipe['steps'])}",
        ]
    )
