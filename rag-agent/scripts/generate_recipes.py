from __future__ import annotations

import json
from itertools import product
from pathlib import Path


MAIN_INGREDIENTS = [
    ("닭고기", "250g"), ("소고기", "250g"), ("돼지고기", "250g"), ("새우", "180g"),
    ("오징어", "1마리"), ("연어", "200g"), ("참치", "1캔"), ("두부", "1모"),
    ("계란", "3개"), ("감자", "2개"), ("버섯", "150g"), ("가지", "1개"),
    ("양배추", "200g"), ("브로콜리", "150g"), ("토마토", "2개"), ("파스타면", "160g"),
    ("쌀", "1컵"), ("우동면", "1봉"), ("떡", "300g"), ("식빵", "2장"),
]

VEGETABLES = [
    ("양파", "1/2개"), ("대파", "1/2대"), ("당근", "1/2개"), ("애호박", "1/2개"),
    ("시금치", "100g"), ("오이", "1개"), ("파프리카", "1개"), ("감자", "1개"),
    ("고구마", "1개"), ("브로콜리", "100g"), ("양배추", "150g"), ("버섯", "100g"),
    ("토마토", "1개"), ("깻잎", "10장"), ("부추", "80g"), ("콩나물", "150g"),
    ("숙주", "150g"), ("단호박", "150g"), ("옥수수", "80g"), ("청경채", "2포기"),
]

STYLES = [
    ("한식", "볶음", "볶음", ["간장 1큰술", "참기름 1작은술"], 25),
    ("한식", "조림", "조림", ["간장 2큰술", "올리고당 1큰술"], 35),
    ("한식", "찌개", "찌개", ["된장 1큰술", "고춧가루 1작은술"], 30),
    ("한식", "전", "전", ["부침가루 4큰술", "식용유 2큰술"], 25),
    ("한식", "덮밥", "덮밥", ["간장 1큰술", "계란 1개"], 25),
    ("한식", "국수", "면 요리", ["고추장 1큰술", "식초 1큰술"], 20),
    ("한식", "구이", "구이", ["간장 1큰술", "다진마늘 1작은술"], 30),
    ("한식", "찜", "찜", ["간장 2큰술", "생강 1쪽"], 45),
    ("한식", "무침", "무침", ["고춧가루 1큰술", "식초 1큰술"], 15),
    ("한식", "김밥", "김밥", ["김 2장", "참기름 1작은술"], 35),
    ("양식", "파스타", "파스타", ["올리브유 1큰술", "파마산 치즈 20g"], 25),
    ("양식", "리소토", "쌀 요리", ["치킨스톡 300ml", "버터 1큰술"], 40),
    ("양식", "스튜", "스튜", ["토마토소스 150g", "월계수잎 1장"], 50),
    ("양식", "그라탱", "오븐 요리", ["생크림 100ml", "모차렐라 치즈 80g"], 40),
    ("양식", "오믈렛", "아침", ["계란 2개", "우유 50ml"], 15),
    ("양식", "샐러드", "샐러드", ["올리브유 1큰술", "레몬즙 1큰술"], 10),
    ("양식", "샌드위치", "샌드위치", ["식빵 2장", "치즈 1장"], 15),
    ("중식", "볶음밥", "볶음밥", ["밥 1공기", "굴소스 1큰술"], 20),
    ("중식", "마파", "두부 요리", ["두반장 1큰술", "굴소스 1작은술"], 25),
    ("중식", "탕수", "튀김", ["전분 4큰술", "식초 2큰술"], 45),
    ("중식", "볶음면", "면 요리", ["중화면 1봉", "굴소스 1큰술"], 25),
    ("중식", "딤섬", "딤섬", ["만두피 10장", "참기름 1작은술"], 40),
    ("일식", "덮밥", "덮밥", ["쯔유 2큰술", "밥 1공기"], 25),
    ("일식", "카레", "카레", ["카레가루 2큰술", "밥 1공기"], 35),
    ("일식", "우동", "면 요리", ["우동면 1봉", "쯔유 2큰술"], 20),
    ("한식", "떡볶이", "떡 요리", ["고추장 2큰술", "물엿 1큰술"], 25),
]

# 음식명 자체가 조리법 이상의 뜻을 가지는 경우, 제목을 쓰기 전에 실제 재료를
# 확인한다. 각 튜플은 모두 충족해야 하는 재료 그룹이며, 그룹 안의 단어는 하나만
# 포함되어도 된다. 예: 김밥은 "김"과 "쌀/밥" 그룹을 모두 충족해야 한다.
METHOD_REQUIREMENTS: dict[str, tuple[tuple[str, ...], ...]] = {
    "마파": (("두부",),),
    "리소토": (("쌀", "밥"),),
    "김밥": (("김",), ("쌀", "밥")),
    "샌드위치": (("식빵", "빵", "바게트", "베이글", "또르띠야", "토르티야", "번"),),
    "딤섬": (("만두피", "반죽", "밀가루", "피"),),
    "파스타": (("파스타면", "스파게티", "펜네", "링귀니", "페투치네", "마카로니"),),
    "국수": (("국수", "소면", "면", "우동면"),),
    "떡볶이": (("떡",),),
    "덮밥": (("쌀", "밥"),),
}

# 필수 재료가 없는 특수 음식명은 재료 조합에 무리 없이 쓸 수 있는 일반 조리법으로
# 바꾼다. 딤섬만은 만두피 없이도 찐 요리로 안전하게 표현할 수 있어 찜으로 대체한다.
SPECIAL_METHOD_FALLBACKS: dict[str, tuple[str, str, str]] = {
    "마파": ("볶음", "볶음", "두반장"),
    "리소토": ("볶음", "볶음", "버터"),
    "김밥": ("볶음", "볶음", "참기름"),
    "샌드위치": ("볶음", "볶음", "치즈"),
    "딤섬": ("찜", "찜", "참기름"),
    "파스타": ("볶음", "볶음", "올리브유"),
    "국수": ("무침", "무침", "고추장"),
    "떡볶이": ("볶음", "볶음", "고추장"),
    "덮밥": ("볶음", "볶음", "간장"),
}

# 조건을 충족한 특수 음식명도 제목에서는 완결된 음식명으로 표기한다.
METHOD_DISPLAY_SUFFIXES = {"마파": "마파두부"}

# 카테고리 균형을 위해 추가하는 레시피는 숫자가 아니라 제목과 재료에 모두 드러나는
# 실제 풍미 차이를 사용한다. 프로필 수를 넘는 변형이 필요하면 생성기를 중단시켜
# 같은 제목에 임의 번호를 붙이는 일이 다시 생기지 않게 한다.
VARIANT_PROFILES: tuple[tuple[str, tuple[str, ...], int], ...] = (
    ("고소한 참깨", ("참깨 1작은술",), 0),
    ("매콤한 고추", ("고춧가루 1작은술",), 5),
    ("버터 풍미", ("버터 1큰술",), 5),
    ("간장 풍미", ("간장 1큰술",), 0),
    ("허브 향", ("말린 허브 1작은술",), 0),
    ("채소 듬뿍", ("파프리카 1/2개",), 5),
)

FIXED_CUISINES = {"한식", "중식", "양식", "일식"}
EXISTING_CUISINES = {
    "계란 볶음밥": ["한식"], "김치찌개": ["한식"], "두부 구이": ["한식"],
    "닭가슴살 채소볶음": ["한식"], "토마토 파스타": ["양식"], "감자채 볶음": ["한식"],
    "소불고기": ["한식"], "잡채": ["한식"], "김치전": ["한식"],
    "된장찌개": ["한식"], "까르보나라": ["양식"], "치즈 오믈렛": ["양식"],
    "치킨 카레": ["일식"], "토마토 피자 토스트": ["양식"], "마파두부": ["중식"],
    "새우 볶음밥": ["중식"], "탕수육": ["중식"], "짜장면": ["중식"],
    "태국식 바질 치킨": ["양식"], "그릭 샐러드": ["양식"], "해산물 리소토": ["양식"],
    "비빔국수": ["한식"], "해물파전": ["한식"],
}


def ingredient_name(value: str) -> str:
    """'재료 수량' 문자열에서 재료명만 돌려준다."""
    parts = value.rsplit(" ", 1)
    return parts[0] if len(parts) == 2 else value


def meets_method_requirements(suffix: str, ingredient_names: set[str]) -> bool:
    """특수 음식명에 필요한 핵심 재료가 모두 있는지 확인한다."""
    groups = METHOD_REQUIREMENTS.get(suffix)
    if not groups:
        return True
    return all(any(required in name for name in ingredient_names for required in group) for group in groups)


def resolve_style(style: tuple, ingredient_names: set[str]) -> tuple:
    """재료와 맞지 않는 특수 음식명은 안전한 일반 조리법으로 바꾼다."""
    category, suffix, tag, sauce, cook_time = style
    if meets_method_requirements(suffix, ingredient_names):
        return style
    fallback_suffix, fallback_tag, _ = SPECIAL_METHOD_FALLBACKS[suffix]
    return category, fallback_suffix, fallback_tag, sauce, cook_time


def style_requirements_met(style: tuple, main: tuple[str, str], vegetable: tuple[str, str]) -> bool:
    """변형 배치 전에 해당 조리법이 이 재료 조합에서 성립하는지 판단한다."""
    main_name, main_amount = main
    vegetable_name, vegetable_amount = vegetable
    raw_ingredients = [f"{main_name} {main_amount}", f"{vegetable_name} {vegetable_amount}", "양파 1/2개", "마늘 1쪽", *style[3]]
    ingredient_names = {ingredient_name(value) for value in raw_ingredients}
    return meets_method_requirements(style[1], ingredient_names)


def get_variant_profile(variant: int) -> tuple[str, tuple[str, ...], int] | None:
    """0은 기본 레시피, 1부터는 재료가 다른 의미 있는 변형을 반환한다."""
    if not variant:
        return None
    if variant > len(VARIANT_PROFILES):
        raise ValueError(f"변형 프로필이 부족합니다: {variant}번째 변형")
    return VARIANT_PROFILES[variant - 1]


def make_recipe(recipe_id: int, style: tuple, main: tuple[str, str], vegetable: tuple[str, str], variant: int = 0) -> dict:
    """주재료·채소·조리법 조합 하나를 표준 레시피 문서로 만듭니다."""
    main_name, main_amount = main
    vegetable_name, vegetable_amount = vegetable
    variant_profile = get_variant_profile(variant)
    variant_ingredients = list(variant_profile[1]) if variant_profile else []
    raw_ingredients = [f"{main_name} {main_amount}", f"{vegetable_name} {vegetable_amount}", "양파 1/2개", "마늘 1쪽", *style[3], *variant_ingredients]
    ingredient_names = {ingredient_name(value) for value in raw_ingredients}
    category, suffix, tag, sauce, cook_time = resolve_style(style, ingredient_names)
    unique_ingredients = []
    seen_ingredients = set()
    for value in raw_ingredients:
        parts = value.rsplit(" ", 1)
        name, amount = parts if len(parts) == 2 else (value, "1")
        unit = "개"
        if amount[-1:].isalpha():
            amount, unit = amount[:-1], amount[-1:]
        item = {"name": name, "amount": amount, "unit": unit}
        if name not in seen_ingredients:
            unique_ingredients.append(item)
            seen_ingredients.add(name)
    fallback_modifier = ""
    if suffix != style[1]:
        fallback_modifier = f" {SPECIAL_METHOD_FALLBACKS[style[1]][2]}"
    variant_label = f" {variant_profile[0]}" if variant_profile else ""
    display_suffix = METHOD_DISPLAY_SUFFIXES.get(suffix, suffix)
    title = f"{main_name} {vegetable_name}{fallback_modifier}{variant_label} {display_suffix}"
    variant_offset = variant_profile[2] if variant_profile else 0
    effective_cook_time = max(10, min(60, cook_time + variant_offset))
    difficulty = "쉬움" if effective_cook_time <= 20 else "보통" if effective_cook_time <= 35 else "어려움"
    return {
        "id": f"generated-{recipe_id:05d}",
        "title": title,
        "description": f"{main_name}과 {vegetable_name}을 {tag} 방식으로 조리해 감칠맛을 살린 요리입니다.",
        "ingredients": unique_ingredients,
        "steps": [
            f"{main_name}은 먹기 좋은 크기로 썰고 {vegetable_name}은 깨끗이 씻어 한입 크기로 준비합니다.",
            f"팬이나 냄비를 중불로 1분 예열한 뒤 식용유를 두르고 마늘과 양파를 1~2분 볶아 향을 냅니다.",
            f"{main_name}을 먼저 넣고 속까지 익도록 3~5분 볶거나 굽습니다.",
            f"{vegetable_name}과 양념을 넣고 {tag} 방식으로 4~6분 더 조리하며 재료가 고르게 익도록 섞습니다.",
            f"불을 끄고 간을 확인한 뒤 1분간 뜸을 들여 그릇에 담아 완성합니다.",
        ],
        "tags": [category, tag, suffix, "재료 조합 레시피"],
        "cuisine": [category],
        "cook_time": effective_cook_time,
        "difficulty": difficulty,
    }


def add_existing_cuisine(recipe: dict) -> dict:
    """기존 샘플 레시피를 네 가지 고정 음식 종류로 정규화합니다."""
    # 사용자가 지정한 예외 분류 규칙을 가장 먼저 적용합니다.
    difficulty = recipe.get("difficulty") or ("쉬움" if recipe.get("cook_time", 30) <= 20 else "보통" if recipe.get("cook_time", 30) <= 35 else "어려움")
    if "죽" in recipe["title"]:
        return {**recipe, "cuisine": ["한식"], "difficulty": difficulty}
    if "스프" in recipe["title"] or "수프" in recipe["title"]:
        return {**recipe, "cuisine": ["양식"], "difficulty": difficulty}
    # 과거 데이터에 남아 있을 수 있는 분식 분류는 파일을 직접 바꾸지 않아도
    # 재생성 시 한식으로 흡수한다.
    legacy_cuisines = ["한식" if value == "분식" else value for value in recipe.get("cuisine", [])]
    cuisine = EXISTING_CUISINES.get(recipe["title"])
    if cuisine is None:
        cuisine = [value for value in legacy_cuisines if value in FIXED_CUISINES]
        cuisine = cuisine or [tag for tag in recipe.get("tags", []) if tag in FIXED_CUISINES] or ["한식"]
    return {**recipe, "cuisine": cuisine, "difficulty": difficulty}


def main() -> None:
    """기존 샘플을 보존하면서 10,000개 이상의 다양한 레시피를 생성합니다."""
    data_path = Path(__file__).parents[1] / "data" / "recipes.json"
    raw_existing = json.loads(data_path.read_text(encoding="utf-8")) if data_path.exists() else []
    # generated-* 레시피는 생성기를 다시 실행할 때 변형 메타데이터도 함께 재생성합니다.
    existing = [add_existing_cuisine(recipe) for recipe in raw_existing if not str(recipe.get("id", "")).startswith("generated-")]
    titles = {recipe["title"] for recipe in existing}
    generated: list[dict] = []
    recipe_id = 1
    for style, main, vegetable in product(STYLES, MAIN_INGREDIENTS, VEGETABLES):
        recipe = make_recipe(recipe_id, style, main, vegetable)
        recipe_id += 1
        if recipe["title"] not in titles:
            generated.append(recipe)
            titles.add(recipe["title"])
    # 한식에 비해 부족한 카테고리는 각 재료 조합에 변형을 고르게 분산한다.
    # 기존처럼 한 조합에 '1번', '2번'을 수천 개 붙이지 않는다.
    target_count = max(sum(1 for recipe in existing if "한식" in recipe.get("cuisine", [])), 4000)
    counts = {cuisine: sum(1 for recipe in existing + generated if cuisine in recipe.get("cuisine", [])) for cuisine in FIXED_CUISINES}
    for cuisine in ("한식", "양식", "중식", "일식"):
        cuisine_styles = [style for style in STYLES if style[0] == cuisine]
        # 재료 조합 하나에 변형을 몰아넣지 않고, 각 조리법을 번갈아 배치한다.
        # 특수 음식명은 조건을 충족하는 재료 조합을 먼저 배치해 유효한 김밥·파스타
        # 등의 다양성도 함께 확보한다.
        style_combinations = []
        for style in cuisine_styles:
            pairs = list(product(MAIN_INGREDIENTS, VEGETABLES))
            pairs.sort(key=lambda pair: not style_requirements_met(style, *pair))
            style_combinations.append((style, pairs))
        combinations = [
            (style, pairs[pair_index][0], pairs[pair_index][1])
            for pair_index in range(len(MAIN_INGREDIENTS) * len(VEGETABLES))
            for style, pairs in style_combinations
        ]
        attempt = 0
        max_attempts = len(combinations) * len(VARIANT_PROFILES)
        while counts[cuisine] < target_count:
            if attempt >= max_attempts:
                raise ValueError(f"{cuisine} 카테고리를 채울 변형 조합이 부족합니다.")
            style, main, vegetable = combinations[attempt % len(combinations)]
            variant = attempt // len(combinations) + 1
            attempt += 1
            recipe = make_recipe(recipe_id, style, main, vegetable, variant)
            recipe_id += 1
            if recipe["title"] in titles:
                continue
            generated.append(recipe)
            titles.add(recipe["title"])
            counts[cuisine] += 1

    recipes = existing + generated
    data_path.write_text(json.dumps(recipes, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"레시피 생성 완료: {len(recipes)}개")


if __name__ == "__main__":
    main()
