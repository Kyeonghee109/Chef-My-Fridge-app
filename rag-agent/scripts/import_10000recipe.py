from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen


FIXED_CUISINES = {"한식", "중식", "양식", "일식", "분식"}


def fetch_html(url: str) -> str:
    """사용자가 제공한 개별 레시피 URL의 HTML을 가져옵니다."""
    request = Request(url, headers={"User-Agent": "FridgeRecipeRAG/1.0"})
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_json_ld(html: str) -> dict:
    """페이지의 JSON-LD Recipe 객체를 찾아 반환합니다."""
    scripts = re.findall(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", html, re.S | re.I)
    for raw in scripts:
        try:
            payload = json.loads(raw.strip())
        except json.JSONDecodeError:
            continue
        objects = payload if isinstance(payload, list) else payload.get("@graph", [payload]) if isinstance(payload, dict) else []
        for item in objects:
            if isinstance(item, dict) and item.get("@type") in ("Recipe", ["Recipe"]):
                return item
    raise ValueError("페이지에서 Recipe JSON-LD를 찾지 못했습니다.")


def classify_cuisine(title: str, keywords: list[str] | None = None) -> list[str]:
    """레시피 제목과 키워드로 고정된 음식 종류를 분류합니다."""
    text = f"{title} {' '.join(keywords or [])}"
    if "죽" in text:
        return ["한식"]
    if "스프" in text or "수프" in text:
        return ["양식"]
    if any(word in text for word in ("짜장", "탕수", "마파", "중화")):
        return ["중식"]
    if any(word in text for word in ("초밥", "우동", "사시미", "일식")):
        return ["일식"]
    if any(word in text for word in ("파스타", "피자", "스테이크", "리소토", "샐러드")):
        return ["양식"]
    if any(word in text for word in ("떡볶이", "김밥", "김치전", "분식")):
        return ["분식"]
    return ["한식"]


def recipe_from_page(url: str) -> dict:
    """개별 10000recipe 페이지를 프로젝트 레시피 스키마로 변환합니다."""
    data = extract_json_ld(fetch_html(url))
    title = data.get("name", "").strip()
    ingredients = [str(item).strip() for item in data.get("recipeIngredient", []) if str(item).strip()]
    steps = [
        str(item.get("text", item)).strip()
        for item in data.get("recipeInstructions", [])
        if str(item.get("text", item)).strip()
    ]
    return {
        "id": f"10000recipe-{abs(hash(url))}",
        "title": title,
        "ingredients": ingredients,
        "steps": steps,
        "tags": ["10000recipe"],
        "cuisine": classify_cuisine(title, data.get("keywords", "").split(",")),
        "cook_time": 30,
        "source": "10000recipe",
        "source_url": url,
    }


def main() -> None:
    """URL 목록에서 허용된 개별 레시피만 가져와 JSON 파일에 병합합니다."""
    parser = argparse.ArgumentParser()
    parser.add_argument("url_file", type=Path, help="10000recipe 개별 레시피 URL을 한 줄에 하나씩 담은 파일")
    parser.add_argument("--output", type=Path, default=Path("data/recipes.json"))
    args = parser.parse_args()
    recipes = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else []
    known_sources = {item.get("source_url") for item in recipes}
    for url in args.url_file.read_text(encoding="utf-8").splitlines():
        url = url.strip()
        if not url or url in known_sources:
            continue
        recipe = recipe_from_page(url)
        recipes.append(recipe)
        known_sources.add(url)
    args.output.write_text(json.dumps(recipes, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"가져온 레시피 포함 총 {len(recipes)}개")


if __name__ == "__main__":
    main()
