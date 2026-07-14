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
    ("분식", "떡볶이", "분식", ["고추장 2큰술", "물엿 1큰술"], 25),
]


def make_recipe(recipe_id: int, style: tuple, main: tuple[str, str], vegetable: tuple[str, str]) -> dict:
    """주재료·채소·조리법 조합 하나를 표준 레시피 문서로 만듭니다."""
    category, suffix, tag, sauce, cook_time = style
    main_name, main_amount = main
    vegetable_name, vegetable_amount = vegetable
    ingredients = [f"{main_name} {main_amount}", f"{vegetable_name} {vegetable_amount}", "양파 1/2개", "마늘 1쪽", *sauce]
    unique_ingredients = list(dict.fromkeys(ingredients))
    title = f"{main_name} {vegetable_name} {suffix}"
    return {
        "id": f"generated-{recipe_id:05d}",
        "title": title,
        "ingredients": unique_ingredients,
        "steps": [
            f"{main_name}과 {vegetable_name}을 손질합니다.",
            f"팬이나 냄비에 {main_name}, 양파, 마늘을 넣고 익힙니다.",
            f"{vegetable_name}과 양념을 넣고 {tag} 방식으로 {cook_time}분간 조리합니다.",
        ],
        "tags": [category, tag, suffix, "재료 조합 레시피"],
        "cook_time": cook_time,
    }


def main() -> None:
    """기존 샘플을 보존하면서 10,000개 이상의 다양한 레시피를 생성합니다."""
    data_path = Path(__file__).parents[1] / "data" / "recipes.json"
    existing = json.loads(data_path.read_text(encoding="utf-8")) if data_path.exists() else []
    titles = {recipe["title"] for recipe in existing}
    generated: list[dict] = []
    recipe_id = 1
    for style, main, vegetable in product(STYLES, MAIN_INGREDIENTS, VEGETABLES):
        recipe = make_recipe(recipe_id, style, main, vegetable)
        recipe_id += 1
        if recipe["title"] not in titles:
            generated.append(recipe)
            titles.add(recipe["title"])
    recipes = existing + generated
    data_path.write_text(json.dumps(recipes, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"레시피 생성 완료: {len(recipes)}개")


if __name__ == "__main__":
    main()

