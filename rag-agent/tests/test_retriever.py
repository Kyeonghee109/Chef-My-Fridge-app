from retriever import calculate_match_score, filter_candidates_by_cuisines, rank_candidates, select_diverse_candidates


def test_normalized_quantities_and_aliases_are_matched() -> None:
    """수량과 대파/파 동의어를 제거해 같은 재료로 판정하는지 확인합니다."""
    score = calculate_match_score(["양파", "대파"], ["다진 양파 1개", "쪽파 1/2대", "소금 1작은술"])

    assert score["match_count"] == 2
    assert score["match_ratio"] == 0.6667
    assert score["missing_ingredients"] == ["소금 1작은술"]


def test_hybrid_ranking_prefers_recipe_with_more_matches() -> None:
    """벡터 점수가 조금 낮아도 재료가 많이 겹치는 레시피를 우선하는지 확인합니다."""
    candidates = [
        {"recipe": {"title": "한 재료 레시피", "ingredients": ["계란", "소금", "기름"]}, "vector_score": 0.99},
        {"recipe": {"title": "세 재료 레시피", "ingredients": ["계란", "양파", "감자"]}, "vector_score": 0.70},
    ]

    ranked = rank_candidates(["계란", "양파", "감자"], candidates, top_k=2)

    assert ranked[0]["recipe"]["title"] == "세 재료 레시피"
    assert ranked[0]["match_count"] == 3
    assert ranked[0]["match_ratio"] == 1.0
    assert ranked[0]["coverage_ratio"] == 1.0


def test_zero_match_candidates_are_filtered() -> None:
    """벡터 유사도만 높고 재료가 겹치지 않는 레시피는 제외합니다."""
    ranked = rank_candidates(
        ["참기름"],
        [{"recipe": {"title": "무관한 레시피", "ingredients": ["김치", "돼지고기"]}, "vector_score": 1.0}],
    )

    assert len(ranked) == 1
    assert ranked[0]["match_count"] == 0


def test_weak_match_is_used_only_when_three_strong_candidates_are_unavailable() -> None:
    """매칭 1개 후보는 강한 후보가 부족할 때만 3개를 채우는 용도로 사용합니다."""
    candidates = [
        {"recipe": {"title": "강한1", "ingredients": ["연어", "양파"]}},
        {"recipe": {"title": "강한2", "ingredients": ["연어", "대파"]}},
        {"recipe": {"title": "약한", "ingredients": ["연어"]}},
    ]
    ranked = rank_candidates(["연어", "양파", "대파"], candidates, top_k=3)
    assert [item["recipe"]["title"] for item in ranked] == ["강한1", "강한2", "약한"]


def test_core_ingredients_are_prioritized_over_vector_score() -> None:
    """연어처럼 핵심 재료가 실제로 있는 후보를 벡터 점수보다 우선합니다."""
    ranked = rank_candidates(
        ["연어"],
        [
            {"recipe": {"title": "무관", "ingredients": ["소금", "양파"]}, "vector_score": 1.0},
            {"recipe": {"title": "연어", "ingredients": ["연어", "소금"]}, "vector_score": 0.2},
        ],
        top_k=2,
    )
    assert ranked[0]["recipe"]["title"] == "연어"


def test_targeted_ingredient_aliases_match() -> None:
    """연어·떡·어묵의 주요 표기 변형을 canonical 재료로 매칭합니다."""
    score = calculate_match_score(["연어", "떡", "어묵"], ["훈제연어 100g", "가래떡 2줄", "오뎅 3개"])
    assert score["match_count"] == 3


def test_cuisine_filter_uses_or_condition() -> None:
    """한식과 중식을 함께 선택하면 둘 중 하나에 속한 후보를 모두 통과시킵니다."""
    candidates = [
        {"recipe": {"title": "한식", "cuisine": ["한식"], "ingredients": ["계란"]}},
        {"recipe": {"title": "중식", "cuisine": ["중식"], "ingredients": ["계란"]}},
        {"recipe": {"title": "양식", "cuisine": ["양식"], "ingredients": ["계란"]}},
    ]

    filtered = filter_candidates_by_cuisines(candidates, ["한식", "중식"])

    assert [item["recipe"]["title"] for item in filtered] == ["한식", "중식"]


def test_empty_cuisine_filter_keeps_all_candidates() -> None:
    """음식 종류를 선택하지 않으면 모든 후보를 유지합니다."""
    candidates = [
        {"recipe": {"title": "한식", "cuisine": ["한식"], "ingredients": ["계란"]}},
        {"recipe": {"title": "양식", "cuisine": ["양식"], "ingredients": ["계란"]}},
    ]

    assert filter_candidates_by_cuisines(candidates, []) == candidates


def test_diversity_selection_prefers_two_cuisines_without_filter() -> None:
    """전체 검색에서 점수 차이가 작으면 서로 다른 cuisine을 우선 선택합니다."""
    ranked = [
        {"recipe": {"title": "한식1", "cuisine": ["한식"]}, "final_score": 2.0},
        {"recipe": {"title": "한식2", "cuisine": ["한식"]}, "final_score": 1.95},
        {"recipe": {"title": "양식1", "cuisine": ["양식"]}, "final_score": 1.8},
    ]

    selected = select_diverse_candidates(ranked, top_k=2)

    assert [item["recipe"]["title"] for item in selected] == ["한식1", "양식1"]


def test_diversity_selection_is_disabled_when_cuisine_selected() -> None:
    """사용자가 cuisine을 고르면 원래 점수 순서를 그대로 유지합니다."""
    ranked = [
        {"recipe": {"title": "한식1", "cuisine": ["한식"]}, "final_score": 2.0},
        {"recipe": {"title": "한식2", "cuisine": ["한식"]}, "final_score": 1.95},
        {"recipe": {"title": "양식1", "cuisine": ["양식"]}, "final_score": 1.8},
    ]

    selected = select_diverse_candidates(ranked, top_k=2, cuisines_selected=True)

    assert [item["recipe"]["title"] for item in selected] == ["한식1", "한식2"]
