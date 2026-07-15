const TARGET_MENU_COUNT = 3;

function clampScore(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function parseCookTimeMinutes(value) {
  const match = String(value || '').match(/(\d+)\s*(?:[~\-–]\s*(\d+)\s*)?분/);
  if (!match) return null;
  return Number(match[2] || match[1]);
}

function parseTimeLimitMinutes(value) {
  const text = String(value || '');
  if (/1\s*시간/.test(text)) return 60;
  const match = text.match(/(\d+)\s*분/);
  return match ? Number(match[1]) : null;
}

function calculateCuisineMatch(requestedCuisines, menus) {
  const requested = Array.isArray(requestedCuisines) ? requestedCuisines.filter(Boolean) : [];
  if (!requested.length) return null;

  const items = Array.isArray(menus) ? menus : [];
  const matched = items.filter(menu => {
    const menuCuisines = Array.isArray(menu?.cuisine) ? menu.cuisine : [];
    return menuCuisines.some(cuisine => requested.includes(cuisine));
  }).length;
  const value = items.length ? clampScore(matched / items.length) : 0;
  return {
    name: 'cuisine_match',
    value,
    comment: `선택 음식 종류(${requested.join(', ')})와 일치한 메뉴 ${matched}/${items.length}개`
  };
}

function calculateMenuCountScore(menus, targetMenuCount = TARGET_MENU_COUNT) {
  const actual = Array.isArray(menus) ? menus.length : 0;
  const target = Math.max(1, Number(targetMenuCount) || TARGET_MENU_COUNT);
  return {
    name: 'menu_count_valid',
    value: clampScore(actual / target),
    comment: `추천 메뉴 ${actual}개 / 목표 ${target}개`
  };
}

function menuMatchesDiet(menu, diet) {
  const expected = String(diet || '').trim().toLocaleLowerCase('ko-KR');
  if (!expected) return true;
  const tags = Array.isArray(menu?.tags) ? menu.tags : [];
  return tags.some(tag => String(tag || '').toLocaleLowerCase('ko-KR').includes(expected));
}

function calculateFilterMatch(filters, menus) {
  const activeFilters = filters && typeof filters === 'object' ? filters : {};
  const items = Array.isArray(menus) ? menus : [];
  const checks = [];
  const timeLimit = parseTimeLimitMinutes(activeFilters.time);

  if (timeLimit !== null) {
    checks.push({
      label: `조리 시간 ${activeFilters.time}`,
      passed: items.length > 0 && items.every(menu => {
        const cookTime = parseCookTimeMinutes(menu?.cookTime);
        return cookTime !== null && cookTime <= timeLimit;
      })
    });
  }
  if (String(activeFilters.difficulty || '').trim()) {
    const expected = String(activeFilters.difficulty).trim();
    checks.push({
      label: `난이도 ${expected}`,
      passed: items.length > 0 && items.every(menu => menu?.difficulty === expected)
    });
  }
  if (String(activeFilters.diet || '').trim()) {
    checks.push({
      label: `식이 제한 ${String(activeFilters.diet).trim()}`,
      // 현재 응답의 구조화된 식이 정보는 tags뿐이므로, 명시 태그가 있는 경우에만 통과로 판정합니다.
      passed: items.length > 0 && items.every(menu => menuMatchesDiet(menu, activeFilters.diet))
    });
  }
  if (!checks.length) return null;

  const matched = checks.filter(check => check.passed).length;
  return {
    name: 'filter_match',
    value: clampScore(matched / checks.length),
    comment: `입력 필터 ${checks.length}개 중 ${matched}개 반영 (${checks.map(check => `${check.label}: ${check.passed ? '통과' : '미통과'}`).join(', ')})`
  };
}

function validateRecommendationOutput(responseBody) {
  const menus = responseBody?.menus;
  const requiredFields = ['name', 'description', 'cuisine', 'recipe', 'cookTime', 'difficulty', 'ingredients', 'missingIngredients'];
  const valid = Array.isArray(menus) && menus.length > 0 && menus.every(menu => {
    if (!menu || typeof menu !== 'object') return false;
    if (requiredFields.some(field => menu[field] === undefined || menu[field] === null || menu[field] === '')) return false;
    return Array.isArray(menu.cuisine) && menu.cuisine.length > 0 &&
      Array.isArray(menu.recipe) && menu.recipe.length > 0 &&
      Array.isArray(menu.ingredients) && Array.isArray(menu.missingIngredients);
  });
  return {
    name: 'output_valid',
    value: valid ? 1 : 0,
    comment: valid
      ? '응답 JSON, 필수 필드, 비어 있지 않은 메뉴 배열을 모두 확인했습니다.'
      : '응답 JSON, 필수 필드 또는 메뉴 배열 검증에 실패했습니다.'
  };
}

function calculateOverallQuality(scores) {
  const applicable = (Array.isArray(scores) ? scores : []).filter(score => score && score.name !== 'request_success' && Number.isFinite(score.value));
  if (!applicable.length) return null;
  const value = clampScore(applicable.reduce((total, score) => total + score.value, 0) / applicable.length);
  return {
    name: 'overall_quality',
    value,
    comment: `계산 대상 ${applicable.map(score => score.name).join(', ')}의 평균`
  };
}

function calculateRecommendationScores({ success, responseBody, cuisines, filters, targetMenuCount = TARGET_MENU_COUNT } = {}) {
  const menus = Array.isArray(responseBody?.menus) ? responseBody.menus : [];
  const scores = [{
    name: 'request_success',
    value: success ? 1 : 0,
    comment: success ? '레시피 추천 API 요청과 응답 생성이 정상 완료되었습니다.' : '레시피 추천 API 요청 처리 중 오류가 발생했습니다.'
  }];
  const cuisineScore = calculateCuisineMatch(cuisines, menus);
  const menuCountScore = calculateMenuCountScore(menus, targetMenuCount);
  const filterScore = calculateFilterMatch(filters, menus);
  const outputScore = validateRecommendationOutput(responseBody);

  [cuisineScore, menuCountScore, filterScore, outputScore].filter(Boolean).forEach(score => scores.push(score));
  const overallScore = calculateOverallQuality(scores.filter(score => score.name !== 'request_success'));
  if (overallScore) scores.push(overallScore);
  return scores;
}

module.exports = {
  TARGET_MENU_COUNT,
  calculateCuisineMatch,
  calculateMenuCountScore,
  calculateFilterMatch,
  validateRecommendationOutput,
  calculateOverallQuality,
  calculateRecommendationScores
};
