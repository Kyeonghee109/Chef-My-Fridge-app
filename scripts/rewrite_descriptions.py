"""제목·재료·조리법이 일치하는 레시피 설명과 조리 단계를 일괄 생성합니다."""
from __future__ import annotations

import json
from pathlib import Path


DATA_PATH = Path(__file__).parents[1] / "rag-agent" / "data" / "recipes.json"
BATCH_SIZE = 100

# 긴 이름과 특수 음식명을 먼저 판별해야 '볶음', '찜' 같은 일반 단어에 잘못
# 흡수되지 않는다. 모든 생성기 STYLES는 아래 조리법 중 하나로 귀결된다.
METHOD_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("마파", ("마파",)),
    ("리소토", ("리소토", "리조또")),
    ("김밥", ("김밥",)),
    ("샌드위치", ("샌드위치", "토스트")),
    ("딤섬", ("딤섬",)),
    ("떡볶이", ("떡볶이", "라볶이")),
    ("볶음밥", ("볶음밥",)),
    ("덮밥", ("덮밥", "규동")),
    ("파스타", ("파스타", "스파게티", "페투치네", "링귀니", "펜네", "마카로니")),
    ("면", ("국수", "우동", "소바", "라멘", "볶음면", "면 요리")),
    ("스튜", ("스튜",)),
    ("국물", ("찌개", "국", "탕", "나베", "수프", "스프")),
    ("카레", ("카레",)),
    ("그라탱", ("그라탱",)),
    ("오믈렛", ("오믈렛",)),
    ("탕수", ("탕수",)),
    ("튀김", ("튀김",)),
    ("전", ("전", "부침")),
    ("구이", ("구이", "스테이크", "오븐")),
    ("조림", ("조림",)),
    ("찜", ("찜", "스팀")),
    ("무침", ("무침",)),
    ("샐러드", ("샐러드",)),
    ("볶음", ("볶음",)),
)


def ingredient_name(value: object) -> str:
    return str(value.get("name", "재료")) if isinstance(value, dict) else str(value)


def particle(word: str, with_batchim: str, without_batchim: str) -> str:
    last = word[-1:] if word else ""
    has_batchim = bool(last and "가" <= last <= "힣" and (ord(last) - ord("가")) % 28)
    return with_batchim if has_batchim else without_batchim


def topic_form(word: str) -> str:
    return word + particle(word, "은", "는")


def object_form(word: str) -> str:
    return word + particle(word, "을", "를")


def link_form(word: str) -> str:
    return word + particle(word, "과", "와")


def recipe_parts(recipe: dict) -> tuple[str, str, str, str, str]:
    names = [ingredient_name(item) for item in recipe.get("ingredients", [])]
    main = names[0] if names else "주재료"
    second = names[1] if len(names) > 1 else "채소"
    title = str(recipe.get("title", "레시피"))
    main_link = link_form(main)
    second_object = object_form(second)
    return title, main, second, main_link, second_object


def detect_method(recipe: dict) -> str:
    title = str(recipe.get("title", ""))
    tags = [str(tag) for tag in recipe.get("tags", [])]
    # 생성기 tags에는 재료명이 아니라 확정된 조리법이 들어 있다. 이를 먼저
    # 사용해야 '파스타면 ... 볶음'을 파스타로 잘못 판별하지 않는다.
    for method, keywords in METHOD_KEYWORDS:
        if any(tag in keywords for tag in tags):
            return method
    # 원본 레시피는 조리법 tag가 없을 수 있으므로 제목의 끝말을 보조로 사용한다.
    # 단, 재료명에 포함된 '파스타면', '우동면'은 조리법으로 취급하지 않는다.
    for method, keywords in METHOD_KEYWORDS:
        if any(title.endswith(keyword) for keyword in keywords):
            return method
    if "마파" in title:
        return "마파"
    return "일반"


def flavor_note(recipe: dict) -> str:
    text = " ".join([str(recipe.get("title", "")), *(ingredient_name(item) for item in recipe.get("ingredients", []))])
    if any(word in text for word in ("두반장", "고추장", "고춧가루", "고추")):
        return "매콤한"
    if any(word in text for word in ("크림", "치즈", "버터", "우유")):
        return "고소한"
    if "간장" in text:
        return "짭조름한"
    if any(word in text for word in ("레몬", "식초", "유자")):
        return "산뜻한"
    return "담백한"


def make_description(recipe: dict) -> str:
    """제목에 확정된 조리법을 설명에도 명시해 제목·설명 불일치를 막는다."""
    title, main, second, main_link, second_object = recipe_parts(recipe)
    title_topic = topic_form(title)
    method = detect_method(recipe)
    flavor = flavor_note(recipe)
    if method == "마파":
        return f"{title_topic} 부드러운 두부와 {second_object} 두반장 소스에 볶아 {flavor} 중화풍 맛을 낸 요리입니다."
    if method == "리소토":
        return f"{title_topic} 쌀에 따뜻한 육수를 나누어 더해 천천히 졸인 뒤 {main_link} 어우러지게 만든 리소토입니다."
    if method == "김밥":
        return f"{title_topic} 양념한 밥에 {second_object} 곁들여 김으로 차곡차곡 말아낸 한입 김밥입니다."
    if method == "샌드위치":
        return f"{title_topic} 노릇하게 구운 빵 사이에 {main_link} {second_object} 겹겹이 넣어 완성한 샌드위치입니다."
    if method == "딤섬":
        return f"{title_topic} 만두피에 {main_link} {second_object} 담아 빚은 뒤 촉촉하게 쪄낸 딤섬입니다."
    if method == "떡볶이":
        return f"{title_topic} 쫄깃한 떡과 {second_object} {flavor} 양념에 자작하게 끓여낸 떡 요리입니다."
    if method == "볶음밥":
        return f"{title_topic} 고슬고슬한 밥에 {main_link} {second_object} 센 불에 볶아 완성한 한 그릇 볶음밥입니다."
    if method == "덮밥":
        return f"{title_topic} {main_link} {second_object} 양념과 함께 익혀 따뜻한 밥 위에 올린 든든한 덮밥입니다."
    if method == "파스타":
        return f"{title_topic} 알맞게 삶은 파스타면에 {main_link} {second_object} 더해 {flavor} 소스로 버무린 파스타입니다."
    if method == "면":
        return f"{title_topic} 면과 {main_link} {second_object} 어우러지게 조리해 가볍게 즐기는 면 요리입니다."
    if method == "스튜":
        return f"{title_topic} {main_link} {second_object} 소스와 함께 은근히 끓여 깊고 {flavor} 맛을 낸 스튜입니다."
    if method == "국물":
        return f"{title_topic} {main_link} {second_object} 국물에 충분히 끓여 따뜻하게 즐기는 국물 요리입니다."
    if method == "카레":
        return f"{title_topic} {main_link} {second_object} 카레 향신료와 끓여 {flavor} 풍미를 살린 카레입니다."
    if method == "그라탱":
        return f"{title_topic} {main_link} {second_object} 소스와 치즈를 더해 노릇하게 구운 그라탱입니다."
    if method == "오믈렛":
        return f"{title_topic} 부드러운 달걀에 {main_link} {second_object} 넣어 폭신하게 익힌 오믈렛입니다."
    if method in {"탕수", "튀김"}:
        return f"{title_topic} {main_link} {second_object} 바삭하게 튀겨 {flavor} 소스 또는 곁들임과 즐기는 요리입니다."
    if method == "전":
        return f"{title_topic} {main_link} {second_object} 반죽에 고르게 섞어 노릇노릇하게 부친 전입니다."
    if method == "구이":
        return f"{title_topic} {main_link} {second_object} 노릇하게 구워 {flavor} 풍미와 식감을 살린 요리입니다."
    if method == "조림":
        return f"{title_topic} {main_link} {second_object} 양념에 천천히 조려 깊고 {flavor} 맛을 더한 요리입니다."
    if method == "찜":
        return f"{title_topic} {main_link} {second_object} 수분으로 부드럽게 쪄 재료 본연의 맛을 살린 찜 요리입니다."
    if method == "무침":
        return f"{title_topic} {main_link} {second_object} 양념에 가볍게 버무려 {flavor} 맛을 살린 무침입니다."
    if method == "샐러드":
        return f"{title_topic} 신선한 {main_link} {second_object} 산뜻하게 버무려 즐기는 {flavor} 샐러드입니다."
    if method == "볶음":
        return f"{title_topic} {main_link} {second_object} 센 불에 빠르게 볶아 {flavor} 풍미를 살린 볶음 요리입니다."
    return f"{title_topic} {main_link} {second_object} 맛을 살려 완성한 한 접시 요리입니다."


def prep(main: str, second: str) -> str:
    return f"{main}{particle(main, '은', '는')} 먹기 좋은 크기로 손질하고 {second}{particle(second, '은', '는')} 깨끗이 씻어 알맞게 썹니다."


def finish(recipe: dict) -> str:
    title = str(recipe.get("title", ""))
    dish_object = object_form(title)
    if "고소한 참깨" in title:
        return f"불을 끄고 참깨를 뿌린 뒤 {dish_object} 완성해 가장 맛있을 때 냅니다."
    if "매콤한 고추" in title:
        return f"불을 끈 뒤 고춧가루를 가볍게 더해 매콤한 향을 살리고 {dish_object} 완성합니다."
    if "버터 풍미" in title:
        return f"불을 끄고 버터를 녹여 고소한 향을 더한 뒤 {dish_object} 완성합니다."
    if "간장 풍미" in title:
        return f"마지막에 간장을 둘러 향을 입힌 뒤 {dish_object} 완성합니다."
    if "허브 향" in title:
        return f"불을 끄고 말린 허브를 뿌려 향을 더한 뒤 {dish_object} 완성합니다."
    if "채소 듬뿍" in title:
        return f"마지막에 파프리카를 더해 한 번만 섞고 {dish_object} 완성합니다."
    return f"간을 확인한 뒤 {dish_object} 완성해 바로 냅니다."


def make_steps(recipe: dict) -> list[str]:
    """조리법별 열원·투입 순서·마무리를 분리한 다섯 단계 조리법을 만든다."""
    _, main, second, main_link, second_object = recipe_parts(recipe)
    main_object = object_form(main)
    second_topic = topic_form(second)
    pair_object = f"{main_link} {second_object}"
    pair_topic = f"{main_link} {second_topic}"
    method = detect_method(recipe)
    first = prep(main, second)
    if method == "마파":
        return [first, "두부는 큼직하게 썰어 끓는 물에 잠깐 데쳐 부서지지 않게 준비합니다.", "팬에 향채와 두반장을 볶아 향을 낸 뒤 물이나 육수를 조금 붓습니다.", f"{pair_object} 넣고 약한 불에서 소스가 배도록 부드럽게 졸입니다.", finish(recipe)]
    if method == "리소토":
        return [first, "냄비에 버터를 녹여 향채를 볶고 쌀을 넣어 투명해질 때까지 볶습니다.", "따뜻한 육수를 한 국자씩 넣고 흡수될 때마다 저어가며 익힙니다.", f"{pair_object} 넣어 쌀알이 부드럽고 촉촉해질 때까지 마무리합니다.", finish(recipe)]
    if method == "김밥":
        return [first, "따뜻한 밥에 참기름과 소금을 넣어 고루 섞어 한 김 식힙니다.", f"{pair_topic} 각각 볶거나 데쳐 물기를 빼고 간을 맞춥니다.", "김 위에 밥을 얇게 펴고 준비한 속재료를 길게 올립니다.", "김발로 단단히 말아 먹기 좋은 크기로 썬 뒤 참기름을 살짝 바릅니다."]
    if method == "샌드위치":
        return [first, "빵은 마른 팬이나 토스터에 살짝 구워 바삭한 식감을 만듭니다.", f"{pair_topic} 소금과 후추로 가볍게 간해 익히거나 준비합니다.", "빵 한쪽에 소스와 채소를 올리고 준비한 속재료를 겹겹이 쌓습니다.", f"다른 빵으로 덮어 눌러 고정한 뒤 반으로 자릅니다. {finish(recipe)}"]
    if method == "딤섬":
        return [first, f"{pair_object} 잘게 다져 양념과 고루 섞어 속을 만듭니다.", "만두피 가장자리에 물을 바르고 속을 넣어 주름을 잡아 빚습니다.", "김이 오른 찜기에 종이를 깔고 딤섬을 올려 속까지 쪄냅니다.", finish(recipe)]
    if method in {"볶음", "볶음밥"}:
        return [first, "팬을 충분히 달군 뒤 기름과 향채를 넣어 향이 올라올 때까지 볶습니다.", f"{main_object} 먼저 넣어 센 불에서 익힌 뒤 {second_object} 넣어 식감을 살립니다.", "양념과 밥 또는 곁들일 재료를 넣고 수분이 남지 않게 빠르게 볶습니다.", finish(recipe)]
    if method == "구이":
        return [first, f"{main}에 소금과 후추 또는 양념을 고루 발라 잠시 둡니다.", "달군 팬이나 오븐에 기름을 얇게 두르고 재료를 올립니다.", f"{main_object} 앞뒤로 노릇하게 익힌 뒤 {second_object} 곁들여 함께 굽습니다.", finish(recipe)]
    if method == "조림":
        return [first, "냄비에 양념과 물 또는 육수를 넣고 한 번 끓입니다.", f"{main_object} 넣어 중약불에서 양념이 배도록 천천히 조립니다.", f"{second_topic} 너무 무르지 않게 마지막에 넣어 함께 졸입니다.", finish(recipe)]
    if method == "찜":
        return [first, "찜기에 물을 끓여 충분히 김이 오르게 준비합니다.", f"{main_link} {second}에 가벼운 양념을 한 뒤 찜기에 고르게 올립니다.", "뚜껑을 덮고 재료 중심까지 익을 때까지 촉촉하게 찝니다.", finish(recipe)]
    if method == "전":
        return [first, f"{main_link} {second}에 부침가루와 물을 넣어 되직하지 않게 반죽합니다.", "중불로 달군 팬에 기름을 넉넉히 두릅니다.", "반죽을 얇게 펴고 가장자리가 익으면 뒤집어 양면을 노릇하게 부칩니다.", finish(recipe)]
    if method == "덮밥":
        return [first, "팬에 향채와 양념을 끓여 덮밥용 소스를 만듭니다.", f"{pair_object} 넣어 소스가 배도록 부드럽게 익힙니다.", "따뜻한 밥을 그릇에 담고 재료와 소스를 넉넉히 올립니다.", finish(recipe)]
    if method in {"스튜", "국물", "카레"}:
        return [first, "냄비에 기름을 두르고 향채를 볶아 깊은 향을 냅니다.", f"{pair_object} 넣어 겉면을 익힌 뒤 물·육수 또는 소스를 붓습니다.", "중약불에서 재료가 부드러워지고 국물 맛이 어우러질 때까지 끓입니다.", finish(recipe)]
    if method in {"무침", "샐러드"}:
        return [first, f"{main_link} {second}의 물기를 충분히 제거해 양념이 묽어지지 않게 합니다.", "양념 재료를 먼저 섞어 맛을 조절합니다.", "먹기 직전에 재료와 양념을 가볍게 버무려 식감을 살립니다.", finish(recipe)]
    if method in {"파스타", "면"}:
        return [first, "면은 끓는 물에 삶아 면수는 조금 남기고 물기를 뺍니다.", "팬에 향채와 소스를 끓여 기본 맛을 만듭니다.", f"{pair_object} 익힌 뒤 면과 면수를 넣어 소스가 고르게 감기도록 버무립니다.", finish(recipe)]
    if method in {"탕수", "튀김"}:
        return [first, f"{main_link} {second}의 물기를 닦고 가루나 반죽을 고르게 입힙니다.", "기름을 적정 온도로 달군 뒤 재료를 나누어 넣습니다.", "겉은 바삭하고 속은 익을 때까지 튀긴 뒤 기름을 충분히 뺍니다.", finish(recipe)]
    if method == "떡볶이":
        return [first, "떡은 물에 헹구고 양념장은 고추장과 단맛 재료를 섞어 준비합니다.", f"냄비에 양념장과 물을 끓인 뒤 떡, {main_object}, {second_object} 넣습니다.", "중불에서 양념이 걸쭉해지고 떡이 말랑해질 때까지 저어가며 끓입니다.", finish(recipe)]
    if method in {"그라탱", "오믈렛"}:
        return [first, f"{pair_topic} 먼저 볶거나 익혀 수분을 줄입니다.", "그라탱은 소스와 치즈를 얹고, 오믈렛은 달걀물에 재료를 넣어 준비합니다.", "오븐 또는 약한 불에서 속까지 익히고 표면이 노릇해질 때까지 마무리합니다.", finish(recipe)]
    return [first, "조리 도구를 예열하고 양념을 준비합니다.", f"{pair_object} 알맞은 열에서 익힙니다.", "맛과 익힘 정도를 확인해 마무리합니다.", finish(recipe)]


def rewrite_recipe_copy(recipe: dict) -> None:
    recipe["description"] = make_description(recipe)
    recipe["steps"] = make_steps(recipe)


def main() -> None:
    recipes = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    total = len(recipes)
    for start in range(0, total, BATCH_SIZE):
        batch = recipes[start:start + BATCH_SIZE]
        for recipe in batch:
            rewrite_recipe_copy(recipe)
        end = min(start + len(batch), total)
        print(f"설명·조리 단계 재작성 진행: {end}/{total}")
    DATA_PATH.write_text(json.dumps(recipes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"설명·조리 단계 재작성 완료: {total}개")


if __name__ == "__main__":
    main()
