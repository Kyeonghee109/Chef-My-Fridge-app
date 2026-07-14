from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable


DEFAULT_ALIASES_PATH = Path(__file__).with_name("ingredient_aliases.json")
QUANTITY_PATTERN = re.compile(
    r"(?:\d+(?:[./]\d+)?|반|한|두|세|네|다섯)\s*"
    r"(?:kg|g|mg|ml|l|개|장|줄|쪽|알|컵|큰술|작은술|스푼|봉|팩|모|근|마리|인분|줌|대)?",
    re.IGNORECASE,
)
PREPARATION_WORDS = re.compile(r"(?:다진|잘게 썬|채 썬|썬|슬라이스한|슬라이스|깐|손질한)")


def load_aliases(path: str | Path = DEFAULT_ALIASES_PATH) -> dict[str, str]:
    """동의어 JSON을 읽어 정규화용 매핑 테이블로 반환합니다."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def normalize_ingredient(value: str, aliases: dict[str, str] | None = None) -> str:
    """수량·손질 표현·공백을 제거하고 동의어를 canonical 재료명으로 변환합니다."""
    aliases = aliases or load_aliases()
    normalized = str(value or "").strip().casefold()
    normalized = QUANTITY_PATTERN.sub(" ", normalized)
    normalized = PREPARATION_WORDS.sub(" ", normalized)
    normalized = re.sub(r"\([^)]*\)|\[[^]]*\]", " ", normalized)
    normalized = re.sub(r"[^0-9a-z가-힣]+", "", normalized)
    for source, target in aliases.items():
        if normalized == re.sub(r"\s+", "", source.casefold()):
            normalized = re.sub(r"\s+", "", target.casefold())
            break
    return normalized


def calculate_match_score(
    user_ingredients: Iterable[str], recipe_ingredients: Iterable[str], aliases: dict[str, str] | None = None
) -> dict[str, Any]:
    """두 재료 목록의 교집합·커버리지·최종 하이브리드 점수를 계산합니다."""
    aliases = aliases or load_aliases()
    user_values = list(user_ingredients)
    recipe_values = list(recipe_ingredients)
    user_keys = {normalize_ingredient(item, aliases) for item in user_values} - {""}
    recipe_key_to_value: dict[str, str] = {}
    for item in recipe_values:
        key = normalize_ingredient(item, aliases)
        if key:
            recipe_key_to_value.setdefault(key, item)
    matched_keys = user_keys & recipe_key_to_value.keys()
    matched = [recipe_key_to_value[key] for key in recipe_key_to_value if key in matched_keys]
    missing = [value for key, value in recipe_key_to_value.items() if key not in matched_keys]
    match_count = len(matched)
    match_ratio = match_count / max(len(recipe_key_to_value), 1)
    coverage_ratio = match_count / max(len(user_keys), 1)
    final_score = (match_count * 0.5) + (match_ratio * 0.3) + (coverage_ratio * 0.2)
    if match_count <= 1:
        final_score *= 0.25
    return {
        "match_count": match_count,
        "match_ratio": round(match_ratio, 4),
        "coverage_ratio": round(coverage_ratio, 4),
        "final_score": round(final_score, 4),
        "matched_ingredients": matched,
        "missing_ingredients": missing,
    }


def rank_candidates(
    user_ingredients: Iterable[str],
    candidates: Iterable[dict[str, Any]],
    top_k: int = 3,
    aliases: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """벡터 후보를 재료 매칭 점수로 재정렬하고 무교집합 후보를 제외합니다."""
    aliases = aliases or load_aliases()
    ranked: list[dict[str, Any]] = []
    for candidate in candidates:
        recipe = candidate["recipe"]
        score = calculate_match_score(user_ingredients, recipe["ingredients"], aliases)
        if score["match_count"] == 0:
            continue
        ranked.append({**candidate, **score})
    ranked.sort(key=lambda item: (-item["final_score"], -item["match_count"], -item.get("vector_score", 0)))
    return ranked[:top_k]
