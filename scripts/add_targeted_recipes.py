"""평가 골든셋의 부족한 재료 조합을 위한 고유 레시피를 추가합니다."""

from __future__ import annotations

import json
from pathlib import Path


DATA_PATH = Path(__file__).parents[1] / "rag-agent" / "data" / "recipes.json"


def make_recipe(recipe_id: int, title: str, cuisine: str, required: list[str], method: str, cook_time: int, difficulty: str) -> dict:
    """재료·조리법·메타데이터를 갖춘 targeted 레시피를 만듭니다."""
    main = "와 ".join(required[:2]) if len(required) > 1 else required[0]
    def ingredient(name: str, amount: int, unit: str) -> dict:
        return {"name": name, "amount": amount, "unit": unit}

    return {
        "id": f"generated-{recipe_id}",
        "title": title,
        "description": f"{required[0]}과 {required[1] if len(required) > 1 else '채소'}를 {method} 조리해 풍미를 살린 요리입니다.",
        "ingredients": [*(ingredient(name, 150 if index == 0 else 100, "g") for index, name in enumerate(required)), ingredient("소금", 1, "작은술"), ingredient("식용유", 1, "큰술")],
        "steps": [
            f"{required[0]}은 먹기 좋은 크기로 썰고 나머지 재료는 깨끗이 씻어 준비합니다.",
            "팬이나 냄비를 중불로 1분 예열한 뒤 식용유를 두르고 향채를 1~2분 볶습니다.",
            f"{required[0]}을 먼저 넣고 3~5분 익힌 뒤 {', '.join(required[1:3])}을 넣습니다.",
            f"{method} 방식으로 4~6분 더 조리하며 소금으로 간을 맞춥니다.",
            f"불을 끄고 1분간 뜸을 들인 뒤 그릇에 담아 약 {cook_time}분 만에 완성합니다.",
        ],
        "tags": [cuisine, method, "골든셋 보강"],
        "cook_time": cook_time,
        "cuisine": [cuisine],
        "difficulty": difficulty,
    }


def add_family(
    recipes: list[dict],
    next_id: int,
    cuisine: str,
    titles: list[str],
    required: list[str],
    methods: list[str],
    times: list[int],
) -> int:
    """한 재료 조합에 조리법·시간을 순환 적용해 다양한 레시피를 추가합니다."""
    for index, title in enumerate(titles):
        method = methods[index % len(methods)]
        cook_time = times[index % len(times)]
        difficulty = "쉬움" if cook_time <= 20 else "보통" if cook_time <= 35 else "어려움"
        recipes.append(make_recipe(next_id, title, cuisine, required, method, cook_time, difficulty))
        next_id += 1
    return next_id


def main() -> None:
    """기존 데이터를 유지하면서 targeted 레시피만 한 번 추가합니다."""
    recipes = json.loads(DATA_PATH.read_text())
    existing_ids = {str(recipe["id"]) for recipe in recipes}
    existing_titles = {recipe["title"] for recipe in recipes}
    next_id = max(int(str(recipe["id"]).split("-")[-1]) for recipe in recipes if str(recipe["id"]).split("-")[-1].isdigit()) + 1
    additions: list[dict] = []

    def family(cuisine: str, titles: list[str], required: list[str], methods: list[str], times: list[int]) -> None:
        nonlocal next_id
        fresh_titles = [title for title in titles if title not in existing_titles]
        next_id = add_family(additions, next_id, cuisine, fresh_titles, required, methods, times)

    family("한식", [
        "어묵볶음", "매콤 어묵볶음", "간장 어묵볶음", "어묵탕", "얼큰 어묵탕", "어묵꼬치", "간장 어묵꼬치", "어묵조림", "매운 어묵조림", "어묵전", "어묵튀김", "어묵김밥", "어묵 비빔국수", "어묵 우동", "어묵 라볶이", "어묵 떡국", "어묵 순대볶음", "어묵 야채볶음", "어묵 카레", "어묵 덮밥", "어묵 주먹밥", "어묵 샐러드", "어묵 간식꼬치", "치즈 어묵구이", "고추 어묵볶음", "대파 어묵전", "어묵 김치찌개", "어묵 콩나물국", "어묵 볶음면", "어묵 유부주머니", "어묵 떡꼬치", "어묵 국물떡볶이"
    ], ["어묵", "대파", "양파", "고추장"], ["볶음", "끓이기", "꼬치로 굽기", "조림", "부치기", "튀기기", "무치기"], [10, 15, 20, 25, 30])
    family("한식", [
        "기본 떡볶이", "간장 떡볶이", "궁중 떡볶이", "치즈 떡볶이", "매운 떡볶이", "떡국", "만두 떡국", "떡꼬치", "매콤 떡꼬치", "떡튀김", "떡강정", "떡갈비", "떡갈비 덮밥", "김치 떡볶이", "카레 떡볶이", "크림 떡볶이", "로제 떡볶이", "떡잡채", "떡 불고기", "떡 라볶이", "떡 어묵탕", "떡 순대볶음", "떡 김밥", "떡 주먹밥", "떡 계란국", "떡 버터구이", "떡 고추장조림", "떡 간장조림", "떡 야채볶음", "떡 닭갈비", "떡 해물볶음", "떡 카레", "떡 샐러드"
    ], ["떡", "대파", "양파", "고추장"], ["볶음", "끓이기", "꼬치로 굽기", "튀기기", "조림", "오븐에 굽기", "무치기"], [10, 15, 20, 25, 35])
    family("일식", [
        "연어덮밥", "연어 간장덮밥", "연어구이", "연어 소금구이", "연어 데리야키구이", "연어 스테이크", "연어 미소구이", "연어 초밥", "연어 아부리초밥", "연어 마끼", "연어 사시미", "연어 타다키", "연어 우동", "연어 냉우동", "연어 라멘", "연어 오차즈케", "연어 주먹밥", "연어 김초밥", "연어 계란말이", "연어 찜", "연어 나베", "연어 미소국", "연어 버터구이", "연어 샐러드", "연어 아보카도덮밥", "연어 무조림", "연어 간장조림", "연어 유자구이", "연어 폰즈구이", "연어 참깨무침", "연어 김밥", "연어 볶음밥", "연어 크림우동", "연어 카레", "연어 오니기리", "연어 채소찜", "연어 마요덮밥", "연어 규동", "연어 소바", "연어 계란덮밥"
    ], ["연어", "밥", "간장", "대파"], ["덮밥으로 조리", "팬에 굽기", "초밥으로 만들기", "우동으로 끓이기", "찜으로 익히기", "나베로 끓이기", "조림", "무치기"], [15, 20, 25, 30, 35, 40])
    family("양식", [
        "버섯 우유 크림파스타", "우유 버섯 파스타", "버섯 우유 로제파스타", "우유 버섯 라자냐", "버섯 우유 그라탱", "우유 버섯 리소토", "버섯 우유 수프", "크리미 버섯 우유수프", "우유 버섯 차우더", "버섯 우유 뇨키", "우유 버섯 라비올리", "버섯 우유 페투치네", "우유 버섯 링귀니", "버섯 우유 오븐파스타", "우유 버섯 펜네", "버섯 우유 스파게티", "우유 버섯 마카로니", "버섯 우유 파스타그라탕", "우유 버섯 크림리조또", "버섯 우유 프라이팬파스타", "우유 버섯 수프파스타", "버섯 우유 콘파스타", "우유 버섯 치즈파스타", "버섯 우유 베이컨파스타", "우유 버섯 치킨파스타", "버섯 우유 시금치파스타", "우유 버섯 토마토파스타", "버섯 우유 페스토파스타", "우유 버섯 카레파스타", "버섯 우유 해산물파스타", "우유 버섯 오믈렛파스타", "버섯 우유 샐러드파스타", "우유 버섯 구운파스타", "버섯 우유 스튜파스타", "우유 버섯 크림수프"
    ], ["우유", "파스타면", "버섯", "양파", "치즈"], ["팬에 볶기", "오븐에 굽기", "냄비에 끓이기", "리소토로 조리", "그라탱으로 굽기", "수프로 끓이기"], [20, 25, 30, 35, 40])
    family("한식", [
        "참기름 비빔밥", "참기름 나물비빔밥", "참기름 콩나물무침", "참기름 시금치무침", "참기름 오이무침", "참기름 버섯무침", "참기름 김무침", "참기름 두부구이", "참기름 감자볶음", "참기름 당근볶음", "참기름 애호박볶음", "참기름 소고기볶음", "참기름 돼지고기볶음", "참기름 닭가슴살무침", "참기름 멸치볶음", "참기름 볶음밥", "참기름 주먹밥", "참기름 국수무침", "참기름 비빔국수", "참기름 골뱅이무침", "참기름 도토리묵무침", "참기름 고사리볶음", "참기름 우엉조림", "참기름 연근무침", "참기름 김치무침", "참기름 계란밥", "참기름 무생채", "참기름 파채무침", "참기름 숙주무침", "참기름 해물무침", "참기름 두부무침", "참기름 깻잎무침"
    ], ["참기름", "마늘", "대파", "간장"], ["비비기", "무치기", "팬에 볶기", "노릇하게 굽기", "조리기"], [10, 15, 20, 25, 30])
    family("일식", [
        "참기름 연어무침", "참기름 연어덮밥", "참기름 참치무침", "참기름 오니기리", "참기름 김초밥", "참기름 시금치나물", "참기름 숙주무침", "참기름 오이무침", "참기름 두부샐러드", "참기름 버섯구이", "참기름 가지구이", "참기름 우동무침", "참기름 소바무침", "참기름 계란덮밥", "참기름 닭고기덮밥", "참기름 소고기규동", "참기름 해초샐러드", "참기름 미역무침", "참기름 다시마무침", "참기름 새우무침"
    ], ["참기름", "간장", "대파", "밥"], ["무치기", "덮밥으로 조리", "구이", "초밥으로 만들기", "우동으로 비비기"], [10, 15, 20, 25])
    family("양식", [
        "닭가슴살 브로콜리 당근 샐러드", "닭가슴살 브로콜리 당근 볶음", "닭가슴살 브로콜리 당근 스팀", "닭가슴살 브로콜리 당근 구이", "닭가슴살 브로콜리 당근 수프", "닭가슴살 브로콜리 당근 파스타", "닭가슴살 브로콜리 당근 리조또", "닭가슴살 브로콜리 당근 오븐구이", "닭가슴살 브로콜리 당근 샌드위치", "닭가슴살 브로콜리 당근 랩", "닭가슴살 브로콜리 당근 카레", "닭가슴살 브로콜리 당근 볶음밥", "닭가슴살 브로콜리 당근 찜", "닭가슴살 브로콜리 당근 꼬치", "닭가슴살 브로콜리 당근 토마토찜", "닭가슴살 브로콜리 당근 크림스튜", "닭가슴살 브로콜리 당근 콜드샐러드", "닭가슴살 브로콜리 당근 곡물볼", "닭가슴살 브로콜리 당근 달걀찜", "닭가슴살 브로콜리 당근 덮밥"
    ], ["닭가슴살", "브로콜리", "당근", "올리브유", "후추"], ["샐러드로 버무리기", "팬에 볶기", "찜기에 찌기", "오븐에 굽기", "냄비에 끓이기", "파스타로 조리"], [15, 20, 25, 30, 35])

    for recipe in additions:
        if recipe["id"] in existing_ids:
            raise ValueError(f"중복 ID: {recipe['id']}")
    recipes.extend(additions)
    DATA_PATH.write_text(json.dumps(recipes, ensure_ascii=False, indent=2) + "\n")
    print(f"추가 레시피: {len(additions)}개")
    print(f"전체 레시피: {len(recipes)}개")


if __name__ == "__main__":
    main()
