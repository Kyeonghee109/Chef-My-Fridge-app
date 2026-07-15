"""생성 레시피의 조리 단계와 전체 재료 수량 구조를 일괄 정리합니다."""
from __future__ import annotations

import json
import re
from pathlib import Path

try:
    from rewrite_descriptions import make_steps
except ImportError:  # 패키지로 실행하는 환경도 지원한다.
    from scripts.rewrite_descriptions import make_steps


DATA_PATH = Path(__file__).parents[1] / "rag-agent" / "data" / "recipes.json"
QUANTITY_RE = re.compile(r"^(.+?)\s+(\d+(?:[./]\d+)?|반|한|두|세|네|약간)\s*(kg|g|mg|ml|l|개|알|장|봉|팩|캔|컵|큰술|작은술|스푼|쪽|대|줄|마리|근|인분|줌)?$", re.I)


def split_quantity(value: str) -> tuple[str, str | int, str]:
    """기존 문자열 재료에서 이름과 분량을 분리하고, 없으면 현실적인 기본량을 부여합니다."""
    text = str(value).strip()
    match = QUANTITY_RE.match(text)
    if match:
        name, amount, unit = match.groups()
        return name.strip(), amount, unit or "개"

    lower = text.casefold()
    if any(word in lower for word in ("소금", "후추", "고춧가루", "참깨", "설탕")):
        return text, 1, "작은술"
    if any(word in lower for word in ("간장", "식초", "참기름", "올리브유", "식용유", "된장", "고추장", "굴소스", "버터")):
        return text, 1, "큰술"
    if any(word in lower for word in ("계란", "달걀")):
        return text, 2, "개"
    if any(word in lower for word in ("면", "파스타", "우동", "국수", "밥", "쌀")):
        return text, 1, "인분"
    if any(word in lower for word in ("닭", "소고기", "돼지고기", "연어", "새우", "어묵", "두부")):
        return text, 150, "g"
    return text, 100, "g"


def ingredient_object(value: object) -> dict[str, object]:
    """문자열 또는 기존 객체를 {name, amount, unit}으로 표준화합니다."""
    if isinstance(value, dict):
        name = str(value.get("name", "")).strip()
        amount = value.get("amount", 1)
        unit = str(value.get("unit", "개")).strip() or "개"
        return {"name": name, "amount": amount, "unit": unit}
    name, amount, unit = split_quantity(str(value))
    return {"name": name, "amount": amount, "unit": unit}


def ingredient_name(value: object) -> str:
    """재료 표시용 이름을 반환합니다."""
    return str(value.get("name", "재료")) if isinstance(value, dict) else str(value)


def particle(word: str, with_batchim: str, without_batchim: str) -> str:
    """한글 받침에 맞는 조사를 선택합니다."""
    last = word[-1:] if word else ""
    has_batchim = bool(last and "가" <= last <= "힣" and (ord(last) - ord("가")) % 28)
    return with_batchim if has_batchim else without_batchim


def detailed_steps(recipe: dict) -> list[str]:
    """생성 레시피에 재료 손질·예열·투입 순서·시간이 드러나는 5단계를 만듭니다."""
    names = [ingredient_name(item) for item in recipe.get("ingredients", [])]
    main = names[0] if names else "주재료"
    vegetable = names[1] if len(names) > 1 else "채소"
    title = recipe.get("title", "")
    method = next((tag for tag in recipe.get("tags", []) if tag in {"볶기", "구이", "조림", "찜", "튀김", "끓이기", "팬에 볶기"}), "조리")
    minutes = recipe.get("cook_time", 30)
    return [
        f"{main}{particle(main, '은', '는')} 먹기 좋은 크기로 썰고 {vegetable}{particle(vegetable, '은', '는')} 깨끗이 씻어 한입 크기로 준비합니다.",
        "팬이나 냄비를 중불로 1분 예열한 뒤 식용유를 두르고 양파와 마늘을 1~2분 볶아 향을 냅니다.",
        f"{main}{particle(main, '을', '를')} 먼저 넣고 속까지 익도록 중불에서 3~5분 조리합니다.",
        f"{vegetable}{particle(vegetable, '과', '와')} 남은 양념을 넣고 {method} 방식으로 4~6분 더 조리하며 재료가 고르게 익도록 섞습니다.",
        f"불을 끄고 간을 확인한 뒤 1분간 뜸을 들여 그릇에 담아 완성합니다. 전체 조리 시간은 약 {minutes}분입니다.",
    ]


def main() -> None:
    recipes = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    generated_count = 0
    step_updates = 0
    ingredient_count = 0
    for recipe in recipes:
        recipe["ingredients"] = [ingredient_object(item) for item in recipe.get("ingredients", [])]
        ingredient_count += len(recipe["ingredients"])
        if str(recipe.get("id", "")).startswith("generated-"):
            generated_count += 1
            # 설명 재작성기와 같은 조리법별 단계를 사용해 범용 볶기 단계로 회귀하지 않는다.
            recipe["steps"] = make_steps(recipe)
            step_updates += 1
    DATA_PATH.write_text(json.dumps(recipes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"재료 수량 구조 변환: {ingredient_count}개 항목")
    print(f"생성 레시피: {generated_count}개, 조리 단계 개선: {step_updates}개")


if __name__ == "__main__":
    main()
