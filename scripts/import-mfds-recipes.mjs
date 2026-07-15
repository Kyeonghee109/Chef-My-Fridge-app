import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = process.env.MFDS_RECIPE_OUTPUT || path.join(root, 'rag-agent/data/mfds-recipes.json');
const rawOutputPath = process.env.MFDS_RAW_RECIPE_OUTPUT || path.join(root, 'rag-agent/data/mfds-recipes.raw.json');
const reportPath = process.env.MFDS_REPORT_OUTPUT || path.join(root, 'rag-agent/data/mfds-import-report.json');
const PAGE_SIZE = 100;
const MAX_PAGE_RETRIES = 8;

const localEnv = await fs.readFile(path.join(root, '.env.local'), 'utf8').catch(() => '');
const readEnv = name => process.env[name] || localEnv.match(new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1]?.replace(/^['"]|['"]$/g, '');
const apiKey = readEnv('FOODSAFETY_KOREA_API_KEY');
if (!apiKey) throw new Error('FOODSAFETY_KOREA_API_KEY가 필요합니다. .env.local에 설정하세요.');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const stripStepArtifacts = value => clean(value)
  .replace(/^\d+\.\s*/, '')
  // 식약처 원문에 단계 사진 각주로 붙은 a/b/c 등을 제거합니다.
  .replace(/[a-z]$/, '')
  .trim();

function inferCuisine(title, ingredientText) {
  const text = `${title} ${ingredientText}`;
  const match = words => words.some(word => text.includes(word));
  if (match(['마파', '짜장', '짬뽕', '탕수', '중화', '유산슬', '깐풍', '고추잡채', '팔보채', '딤섬', '마라'])) return ['중식'];
  if (match(['초밥', '사시미', '우동', '라멘', '돈가스', '오야코', '가라아게', '나베', '규동', '스시', '소바'])) return ['일식'];
  if (match(['파스타', '스파게티', '피자', '리조또', '그라탱', '스테이크', '샌드위치', '햄버거', '오믈렛', '수프', '토스트'])) return ['양식'];
  if (match(['김치', '된장', '고추장', '불고기', '비빔', '나물', '찌개', '국', '전', '장조림', '갈비', '잡채', '떡'])) return ['한식'];
  return [];
}

function ingredientName(segment) {
  return clean(segment)
    .replace(/\([^)]*\)/g, '')
    .replace(/\s*(?:\d+(?:\.\d+)?(?:\s*[~∼-]\s*\d+(?:\.\d+)?)?\s*(?:g|kg|ml|L|ℓ|개|장|쪽|큰술|작은술|컵|모|줄기|알|마리|봉|줌|인분|적당량)).*$/i, '')
    .replace(/\s+$/, '');
}

function parseIngredients(raw) {
  const items = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    for (const segment of line.split(',')) {
      const value = clean(segment);
      const name = ingredientName(value);
      // '고명', '양념'처럼 섹션 제목만 있는 줄은 원문에는 남기되 개별 재료로 넣지 않습니다.
      if (!name || /^(고명|양념|재료|소스)$/u.test(name)) continue;
      items.push({ name, amount_text: value });
    }
  }
  return items;
}

function recipeFromRow(row) {
  const ingredientsRaw = clean(row.RCP_PARTS_DTLS);
  const steps = Array.from({ length: 20 }, (_, index) => stripStepArtifacts(row[`MANUAL${String(index + 1).padStart(2, '0')}`]))
    .filter(Boolean);
  const stepImages = Array.from({ length: 20 }, (_, index) => clean(row[`MANUAL_IMG${String(index + 1).padStart(2, '0')}`]))
    .filter(Boolean);
  const title = clean(row.RCP_NM);
  const cuisine = inferCuisine(title, ingredientsRaw);
  const method = clean(row.RCP_WAY2);
  const category = clean(row.RCP_PAT2);
  return {
    id: `mfds-${row.RCP_SEQ}`,
    title,
    description: `${method || '조리'} 방식의 ${category || '요리'}입니다. 식품의약품안전처 조리식품 레시피 DB의 원문 재료와 조리 순서를 제공합니다.`,
    ingredients: parseIngredients(row.RCP_PARTS_DTLS),
    ingredients_raw: ingredientsRaw,
    steps,
    images: { main: clean(row.ATT_FILE_NO_MAIN), steps: stepImages },
    tags: [method, category, '식품의약품안전처'].filter(Boolean),
    cuisine,
    cuisine_classification: cuisine.length ? 'keyword-rule' : 'unclassified',
    nutrition_per_serving: {
      kcal: clean(row.INFO_ENG), carbohydrate_g: clean(row.INFO_CAR), protein_g: clean(row.INFO_PRO),
      fat_g: clean(row.INFO_FAT), sodium_mg: clean(row.INFO_NA)
    },
    source: {
      provider: '식품의약품안전처', dataset: '조리식품 레시피 DB', service_id: 'COOKRCP01',
      recipe_id: String(row.RCP_SEQ), source_license: '공공데이터포털 이용허락 범위 확인 필요'
    }
  };
}

async function requestPage(start, end) {
  const expectedRows = end - start + 1;
  for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt += 1) {
    const url = `https://openapi.foodsafetykorea.go.kr/api/${encodeURIComponent(apiKey)}/COOKRCP01/json/${start}/${end}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const payload = await response.json().catch(() => null);
    const service = payload?.COOKRCP01;
    const rows = service?.row ?? [];
    if (response.ok && service?.RESULT?.CODE === 'INFO-000' && rows.length === expectedRows) return { total: Number(service.total_count), rows };
    if (attempt === MAX_PAGE_RETRIES) {
      throw new Error(`API ${start}-${end} 조회 실패: ${response.status}, ${service?.RESULT?.CODE ?? 'invalid'}, ${rows.length}/${expectedRows}건`);
    }
    await sleep(500 * attempt);
  }
}

const firstPage = await requestPage(1, PAGE_SIZE);
const rows = [...firstPage.rows];
for (let start = PAGE_SIZE + 1; start <= firstPage.total; start += PAGE_SIZE) {
  const end = Math.min(start + PAGE_SIZE - 1, firstPage.total);
  const page = await requestPage(start, end);
  rows.push(...page.rows);
  console.log(`수집 진행: ${rows.length}/${firstPage.total}`);
}

const recipes = rows.map(recipeFromRow);
const duplicateIds = recipes.length - new Set(recipes.map(recipe => recipe.id)).size;
const duplicateTitles = recipes.length - new Set(recipes.map(recipe => recipe.title)).size;
const missingIngredients = recipes.filter(recipe => recipe.ingredients.length === 0).map(recipe => recipe.id);
const missingSteps = recipes.filter(recipe => recipe.steps.length === 0).map(recipe => recipe.id);
const missingMainImages = recipes.filter(recipe => !recipe.images.main).map(recipe => recipe.id);
const artifactSteps = recipes.flatMap(recipe => recipe.steps.filter(step => /[a-z]$/u.test(step)).map(step => ({ id: recipe.id, step })));
const duplicateTitleGroups = Object.entries(Object.groupBy(recipes, recipe => recipe.title))
  .filter(([, group]) => group.length > 1)
  .map(([title, group]) => ({ title, ids: group.map(recipe => recipe.id) }));
const incompleteIds = new Set([...missingIngredients, ...missingSteps]);
const completeRecipes = recipes.filter(recipe => !incompleteIds.has(recipe.id));
const selectedRecipes = [];
const excludedDuplicateIds = [];
for (const group of Object.values(Object.groupBy(completeRecipes, recipe => recipe.title))) {
  const ordered = [...group].sort((left, right) => (
    Number(Boolean(right.images.main)) - Number(Boolean(left.images.main)) ||
    right.steps.length - left.steps.length ||
    right.ingredients.length - left.ingredients.length ||
    left.id.localeCompare(right.id)
  ));
  selectedRecipes.push(ordered[0]);
  excludedDuplicateIds.push(...ordered.slice(1).map(recipe => recipe.id));
}
const selectedArtifactSteps = selectedRecipes.flatMap(recipe => recipe.steps.filter(step => /[a-z]$/u.test(step)).map(step => ({ id: recipe.id, step })));
const cuisineCounts = Object.fromEntries(['한식', '중식', '양식', '일식', 'unclassified'].map(cuisine => [cuisine, cuisine === 'unclassified'
  ? recipes.filter(recipe => recipe.cuisine.length === 0).length
  : recipes.filter(recipe => recipe.cuisine.includes(cuisine)).length]));
const report = {
  source_total: firstPage.total, raw_imported_recipes: recipes.length, service_eligible_recipes: selectedRecipes.length,
  duplicate_ids: duplicateIds, duplicate_titles: duplicateTitles,
  missing_ingredients: missingIngredients.length, missing_steps: missingSteps.length, missing_main_images: missingMainImages.length,
  remaining_step_artifacts: artifactSteps.length, cuisine_counts: cuisineCounts,
  issue_ids: {
    missing_ingredients: missingIngredients, missing_steps: missingSteps, missing_main_images: missingMainImages,
    duplicate_titles: duplicateTitleGroups, excluded_incomplete: [...incompleteIds], excluded_duplicate_titles: excludedDuplicateIds
  },
  samples: selectedRecipes.slice(0, 3).map(recipe => ({ id: recipe.id, title: recipe.title, ingredient_count: recipe.ingredients.length, step_count: recipe.steps.length, has_main_image: Boolean(recipe.images.main) }))
};
await fs.writeFile(rawOutputPath, `${JSON.stringify(recipes, null, 2)}\n`, 'utf8');
await fs.writeFile(outputPath, `${JSON.stringify(selectedRecipes, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (recipes.length !== firstPage.total || duplicateIds || selectedArtifactSteps.length || selectedRecipes.some(recipe => !recipe.ingredients.length || !recipe.steps.length)) {
  throw new Error(`검수 실패: ${JSON.stringify(report)}`);
}
console.log(JSON.stringify(report, null, 2));
