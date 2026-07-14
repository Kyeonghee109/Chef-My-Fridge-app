import json
from collections import Counter
from pathlib import Path


def test_recipe_cuisines_are_balanced_and_valid() -> None:
    """모든 고정 카테고리가 최소 40개 이상이고 cuisine 값이 유효한지 확인합니다."""
    recipes = json.loads((Path(__file__).parents[1] / "data" / "recipes.json").read_text(encoding="utf-8"))
    counts = Counter(cuisine for recipe in recipes for cuisine in recipe["cuisine"])

    assert len(recipes) >= 200
    assert set(counts) == {"한식", "중식", "양식", "일식", "분식"}
    assert min(counts.values()) >= 40


def test_recipe_quality_fields_are_present() -> None:
    """확장된 레시피가 상세 재료·조리시간·난이도를 모두 갖는지 확인합니다."""
    recipes = json.loads((Path(__file__).parents[1] / "data" / "recipes.json").read_text(encoding="utf-8"))

    assert all(recipe["ingredients"] for recipe in recipes)
    assert all(recipe["steps"] for recipe in recipes)
    assert all(recipe.get("difficulty") in {"쉬움", "보통", "어려움"} for recipe in recipes)
    assert all(isinstance(recipe["cook_time"], int) for recipe in recipes)

