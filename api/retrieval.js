const ALIASES = {
  '훈제연어': '연어', '생연어': '연어', '연어회': '연어',
  '가래떡': '떡', '떡볶이떡': '떡', '떡국떡': '떡',
  '오뎅': '어묵', '부산어묵': '어묵', '어묵꼬치': '어묵',
  '칵테일새우': '새우', '새우살': '새우'
};

function assertIngredients(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name}은 배열이어야 합니다.`);
}

function normalizeIngredient(value) {
  return String(value || '')
    .toLocaleLowerCase('ko-KR')
    .replace(/\([^)]*\)/g, '')
    .replace(/(?:\d+(?:[./]\d+)?|[½¼¾])\s*(?:kg|g|mg|ml|l|개|알|장|봉|팩|캔|컵|큰술|작은술|스푼|쪽|대|줄|마리|근|인분)/gi, '')
    .replace(/약간|적당량|한줌|한 줌/g, '')
    .replace(/[\s.,。/·]+/g, '');
}

function canonicalIngredient(value) {
  const normalized = normalizeIngredient(value);
  return ALIASES[normalized] || normalized;
}

function calculateMatchScore(userIngredients, recipeIngredients) {
  assertIngredients(userIngredients, 'userIngredients');
  assertIngredients(recipeIngredients, 'recipeIngredients');
  const userKeys = new Set(userIngredients.map(canonicalIngredient).filter(Boolean));
  const recipeKeyToValue = new Map();
  for (const value of recipeIngredients) {
    const key = canonicalIngredient(value);
    if (key && !recipeKeyToValue.has(key)) recipeKeyToValue.set(key, value);
  }
  const matchedKeys = [...userKeys].filter(key => recipeKeyToValue.has(key));
  const matchCount = matchedKeys.length;
  const matchRatio = matchCount / Math.max(recipeKeyToValue.size, 1);
  const coverageRatio = matchCount / Math.max(userKeys.size, 1);
  const finalScore = (matchCount * 0.5) + (matchRatio * 0.3) + (coverageRatio * 0.2);
  return {
    matchCount,
    matchRatio,
    coverageRatio,
    finalScore,
    matchedIngredients: matchedKeys.map(key => recipeKeyToValue.get(key)),
    missingIngredients: [...recipeKeyToValue.entries()]
      .filter(([key]) => !matchedKeys.includes(key))
      .map(([, value]) => value)
  };
}

function calculateMissingIngredients(userIngredients, recipeIngredients) {
  assertIngredients(userIngredients, 'userIngredients');
  assertIngredients(recipeIngredients, 'recipeIngredients');
  const owned = new Set(userIngredients.map(canonicalIngredient).filter(Boolean));
  return recipeIngredients.filter(item => !owned.has(canonicalIngredient(item)));
}

function filterByCuisine(recipes, selectedCuisines) {
  assertIngredients(recipes, 'recipes');
  assertIngredients(selectedCuisines, 'selectedCuisines');
  if (selectedCuisines.length === 0) return recipes;
  return recipes.filter(recipe => {
    const cuisine = Array.isArray(recipe.cuisine)
      ? recipe.cuisine
      : Array.isArray(recipe.metadata?.cuisine) ? recipe.metadata.cuisine : [];
    return cuisine.some(value => selectedCuisines.includes(value));
  });
}

module.exports = {
  calculateMatchScore,
  calculateMissingIngredients,
  filterByCuisine,
  normalizeIngredient,
  canonicalIngredient
};
