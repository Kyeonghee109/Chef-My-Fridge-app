from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable


DEFAULT_ALIASES_PATH = Path(__file__).with_name("ingredient_aliases.json")
FIXED_CUISINES = {"한식", "중식", "양식", "일식", "분식"}
CORE_INGREDIENTS = {"연어", "어묵", "떡", "새우", "닭가슴살", "닭고기", "브로콜리", "당근", "파스타면", "버섯", "우유"}
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
    return {
        "match_count": match_count,
        "match_ratio": round(match_ratio, 4),
        "coverage_ratio": round(coverage_ratio, 4),
        "final_score": round(final_score, 4),
        "matched_ingredients": matched,
        "missing_ingredients": missing,
        "core_match_count": len(matched_keys & CORE_INGREDIENTS),
    }


def filter_candidates_by_cuisines(candidates: Iterable[dict[str, Any]], cuisines: Iterable[str]) -> list[dict[str, Any]]:
    """선택한 음식 종류 중 하나라도 레시피 cuisine과 겹치는 후보만 남깁니다(OR 조건)."""
    selected = set(cuisines) & FIXED_CUISINES
    if not selected:
        return list(candidates)
    return [candidate for candidate in candidates if selected.intersection(candidate["recipe"].get("cuisine", []))]


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
        ranked.append({**candidate, **score})
    ranked.sort(key=lambda item: (
        -item["core_match_count"],
        -item["final_score"],
        -item["match_count"],
        -item.get("vector_score", 0),
    ))
    strong = [item for item in ranked if item["match_count"] > 1]
    weak = [item for item in ranked if item["match_count"] <= 1]
    # 일치 재료가 2개 이상인 후보를 먼저 쓰고, 3개가 부족할 때만 약한 후보로 보충합니다.
    return (strong + weak)[:top_k]


def select_diverse_candidates(
    ranked_candidates: list[dict[str, Any]],
    top_k: int = 3,
    cuisines_selected: bool = False,
    score_gap_threshold: float = 0.35,
) -> list[dict[str, Any]]:
    """음식 종류를 직접 고르지 않았을 때 점수 손실이 작은 범위에서 cuisine 다양성을 보정합니다."""
    if cuisines_selected or top_k <= 1:
        return ranked_candidates[:top_k]
    selected: list[dict[str, Any]] = []
    used_cuisines: set[str] = set()
    remaining = list(ranked_candidates)
    while remaining and len(selected) < top_k:
        best = remaining[0]
        diverse = next(
            (
                candidate
                for candidate in remaining
                if not used_cuisines.intersection(candidate["recipe"].get("cuisine", []))
                and best["final_score"] - candidate["final_score"] <= score_gap_threshold
            ),
            None,
        )
        chosen = diverse or best
        selected.append(chosen)
        used_cuisines.update(chosen["recipe"].get("cuisine", []))
        remaining.remove(chosen)
    return selected
