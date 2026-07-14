from retriever import calculate_match_score, rank_candidates


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

    assert ranked == []

