// LLM 없이 응답 개수, 필드 타입, 응답 시간 같은 계약을 검사합니다.
export function deterministicChecks(input, result) {
  const checks = [];
  const isEmptyInput = !Array.isArray(input.ingredients) || input.ingredients.length === 0;
  checks.push({ name: '응답 시간 15초 이내', pass: result.elapsedMs <= 15000, detail: `${result.elapsedMs}ms` });
  if (isEmptyInput) {
    checks.push({ name: '빈 재료 안내 응답', pass: Boolean(result.error) && result.status >= 400 && result.status < 500, detail: result.error || '안내 없음' });
    return checks;
  }
  checks.push({ name: '메뉴 정확히 3개', pass: result.menus.length === 3, detail: `${result.menus.length}개` });
  for (const [index, menu] of result.menus.entries()) {
    checks.push({ name: `메뉴 ${index + 1} missing_ingredients 배열`, pass: Array.isArray(menu.missingIngredients), detail: typeof menu.missingIngredients });
    checks.push({ name: `메뉴 ${index + 1} cuisine 배열`, pass: Array.isArray(menu.cuisine), detail: typeof menu.cuisine });
  }
  if (input.cuisines?.length && result.menus.length === 3) {
    checks.push({
      name: '선택 cuisine 포함',
      pass: result.menus.every(menu => menu.cuisine.some(cuisine => input.cuisines.includes(cuisine))),
      detail: result.menus.map(menu => menu.cuisine.join('/')).join(', ')
    });
  }
  return checks;
}
