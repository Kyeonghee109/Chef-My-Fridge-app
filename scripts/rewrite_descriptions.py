"""레시피 설명을 수량 나열 없는 자연스러운 한 문장으로 일괄 생성합니다."""
from __future__ import annotations

import json
from pathlib import Path


DATA_PATH = Path(__file__).parents[1] / "rag-agent" / "data" / "recipes.json"
BATCH_SIZE = 100


def ingredient_name(value: object) -> str:
    return str(value.get("name", "재료")) if isinstance(value, dict) else str(value)


def particle(word: str, with_batchim: str, without_batchim: str) -> str:
    last = word[-1:] if word else ""
    has_batchim = bool(last and "가" <= last <= "힣" and (ord(last) - ord("가")) % 28)
    return with_batchim if has_batchim else without_batchim


def make_description(recipe: dict) -> str:
    names = [ingredient_name(item) for item in recipe.get("ingredients", [])]
    main = names[0] if names else "주재료"
    second = names[1] if len(names) > 1 else "채소"
    tags = " ".join(str(tag) for tag in recipe.get("tags", []))
    title = recipe.get("title", "레시피")
    main_link = main + particle(main, "과", "와")
    second_object = second + particle(second, "을", "를")
    if any(word in title or word in tags for word in ("파스타", "스파게티", "페투치네", "링귀니")):
        return f"고소한 크림소스에 {main_link} {second_object} 볶아 부드럽게 완성한 파스타입니다."
    if any(word in title or word in tags for word in ("떡볶이", "라볶이")):
        return f"쫄깃한 떡과 {second_object} 매콤달콤한 양념에 끓여낸 분식입니다."
    if any(word in title or word in tags for word in ("찌개", "국", "탕", "나베", "수프", "스프")):
        return f"{main_link} {second_object} 깊은 국물에 끓여 따뜻하게 즐기는 요리입니다."
    if any(word in title or word in tags for word in ("구이", "스테이크", "오븐")):
        return f"{main_link} {second_object} 노릇하게 구워 담백한 풍미를 살린 요리입니다."
    if any(word in title or word in tags for word in ("조림",)):
        return f"{main_link} {second_object} 달큰한 간장 양념에 조려 깊은 맛을 낸 요리입니다."
    if any(word in title or word in tags for word in ("찜", "스팀")):
        return f"{main_link} {second_object} 부드럽게 쪄 재료 본연의 맛을 살린 요리입니다."
    if any(word in title or word in tags for word in ("무침", "샐러드")):
        return f"신선한 {main_link} {second_object} 산뜻한 양념에 버무린 가벼운 요리입니다."
    if any(word in title or word in tags for word in ("덮밥", "볶음밥", "리소토")):
        return f"{main_link} {second_object} 고소한 양념에 볶아 든든하게 즐기는 한 그릇입니다."
    if any(word in title or word in tags for word in ("전", "부침", "튀김")):
        return f"{main_link} {second_object} 바삭하게 부쳐 고소하게 즐기는 요리입니다."
    return f"{main_link} {second_object} 향긋한 양념에 볶아 감칠맛을 살린 요리입니다."


def main() -> None:
    recipes = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    total = len(recipes)
    for start in range(0, total, BATCH_SIZE):
        batch = recipes[start:start + BATCH_SIZE]
        for recipe in batch:
            recipe["description"] = make_description(recipe)
        end = min(start + len(batch), total)
        print(f"설명 재작성 진행: {end}/{total}")
    DATA_PATH.write_text(json.dumps(recipes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"설명 재작성 완료: {total}개")


if __name__ == "__main__":
    main()
