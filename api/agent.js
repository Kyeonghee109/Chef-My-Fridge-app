const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const { filterByCuisine: filterRecipesByCuisine } = require('./retrieval');
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const SEARCH_MATCH_COUNT = 500;
const PROMPT_HIT_COUNT = 12;
const PROMPT_CONTENT_LIMIT = 900;
const CUISINES = ['한식', '중식', '양식', '일식'];
const INGREDIENT_ALIASES = {
  '훈제연어': '연어', '생연어': '연어', '연어회': '연어',
  '가래떡': '떡', '떡볶이떡': '떡', '떡국떡': '떡',
  '오뎅': '어묵', '부산어묵': '어묵', '어묵꼬치': '어묵',
  '칵테일새우': '새우', '새우살': '새우'
};
const CORE_INGREDIENTS = new Set(['연어', '어묵', '떡', '새우', '닭가슴살', '닭고기', '브로콜리', '당근', '파스타면', '버섯', '우유']);
const RECIPE_CUISINES = {
  '계란 볶음밥': ['한식'], '김치찌개': ['한식'], '두부 구이': ['한식'],
  '닭가슴살 채소볶음': ['한식'], '토마토 파스타': ['양식'], '감자채 볶음': ['한식']
};

// 기존 검색 문서에 cuisine metadata가 없거나 이름이 변형되어도 음식 종류를 보완합니다.
function inferCuisine(recipeName, content = '') {
  if (RECIPE_CUISINES[recipeName]) return RECIPE_CUISINES[recipeName];
  const text = `${recipeName} ${content}`;
  if (/(짜장|탕수|마파|중화|새우 볶음밥)/.test(text)) return ['중식'];
  if (/(우동|초밥|사시미|일식|일본식|카레)/.test(text)) return ['일식'];
  if (/(파스타|피자|오믈렛|리소토|샐러드|스테이크|양식)/.test(text)) return ['양식'];
  if (/(떡볶이|김밥|김치전|비빔국수|분식)/.test(text)) return ['한식'];
  return ['한식'];
}

const env = () => ({
  openai: process.env.OPENAI_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
});

async function openai(path, body, key, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function embed(text, key) {
  const payload = await openai('embeddings', {
    model: 'text-embedding-3-large',
    dimensions: 1536,
    input: text
  }, key);
  return payload.data[0].embedding;
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Supabase 적재·인덱스 갱신 중 발생하는 일시적인 5xx를 짧게 재시도합니다.
async function fetchSearchWithRetry(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      const detail = await response.text();
      lastError = new Error(`${label} failed (${response.status}): ${detail.slice(0, 240)}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await sleep(400 * (2 ** (attempt - 1)));
  }
  throw lastError;
}

async function searchRecipes(queryEmbedding, config, cuisines = []) {
  const url = `${config.supabaseUrl}/rest/v1/rpc/match_recipe_chunks`;
  const options = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: config.supabaseKey,
      authorization: `Bearer ${config.supabaseKey}`
    },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      // 선택 카테고리 안에서는 유사도보다 카테고리 후보 확보를 우선합니다.
      match_threshold: -1,
      match_count: SEARCH_MATCH_COUNT,
      selected_cuisines: cuisines
    })
  };
  try {
    return await (await fetchSearchWithRetry(url, options, 'Supabase search')).json();
  } catch (error) {
    // 새 RPC가 아직 배포되지 않은 환경에서는 기존 인자 형태로 재시도합니다.
    const legacyOptions = {
      ...options,
      body: JSON.stringify({ query_embedding: queryEmbedding, match_threshold: -1, match_count: SEARCH_MATCH_COUNT })
    };
    return await (await fetchSearchWithRetry(url, legacyOptions, 'Supabase legacy search')).json();
  }
}

function promptFor({ ingredients, filters, exclude, hits }) {
  const context = hits.map(hit => `- [${hit.recipe_name}] 필요 재료: ${(hit.requiredIngredients || []).join(', ')}\n  ${String(hit.content || '').slice(0, PROMPT_CONTENT_LIMIT)}`).join('\n');
  return `냉장고 재료 기반 레시피 추천을 수행하세요.
보유 재료: ${ingredients.join(', ')}
조리 시간: ${filters.time || '상관없음'}
난이도: ${filters.difficulty || '상관없음'}
식이 제한: ${filters.diet || '없음'}
음식 종류: ${filters.cuisines?.join(', ') || '전체'}
제외할 직전 메뉴: ${exclude.join(', ') || '없음'}

아래 검색 문서에 있는 레시피를 근거로 정확히 3개 추천하세요. 선택한 음식 종류가 있으면 해당 종류를 우선하고, 3개가 부족할 때만 다른 음식 종류를 보충하세요. 검색 문서에 없는 조리법을 새로 지어내지 말고, 재료가 부족하면 missingIngredients에 표시하세요. 메뉴명은 사용자가 그대로 검색했을 때 일반적인 레시피를 찾을 수 있는 표준 메뉴명으로 작성하세요. 임의의 감성 표현, 재료 나열식 이름, 브랜드명, 유행어를 메뉴명에 붙이지 말고 "김치찌개", "토마토 파스타", "계란 볶음밥"처럼 널리 쓰이는 대표 명칭만 사용하세요. 제외 메뉴는 반환하지 마세요. description은 카드에 보여 줄 60자 이하의 한 문장 메뉴 소개만 작성하세요. 조리 순서, 시간, 단계, "넣고·볶고·익히고·준비합니다" 같은 과정 설명은 description에 절대 넣지 마세요. 각 메뉴의 steps 배열은 요리 특성에 맞게 5~7개의 현실적인 조리 단계로 작성하세요. 단계 수를 임의로 4개로 고정하거나 줄이지 말고, 필요한 준비·손질·가열·간 맞추기·마무리 과정을 자연스럽게 나누세요. steps의 각 항목에는 한 가지 핵심 동작만 넣고, 여러 동작이나 여러 문장을 한 단계에 합치지 마세요. 조리 순서의 모든 문장은 "~합니다, ~썹니다, ~볶습니다, ~끓입니다"처럼 합니다체 서술형 존댓말로 끝내고, "~해주세요" 같은 요청형 표현은 사용하지 마세요. 재료의 정확한 수량은 처음 사용하는 단계에 한 번만 쓰고, 이후 단계에서는 "재료들을", "전체를", "볶은 재료" 같은 자연스러운 대명사로 이어서 수량을 반복하지 마세요. 재료 손질·준비 단계(썰기, 다지기, 씻기, 계량하기 등)에는 시간이나 불 세기를 절대 넣지 말고 동작만 자연스럽게 서술하세요. 실제로 불을 사용하는 가열 조리 단계(끓이기, 익히기, 조리기, 볶기)에만 구체적인 조리 시간(예: 2~3분), 불 세기(강불/중불/약불), 실제로 그 단계에서 사용하는 재료·조미료와 양을 포함하세요. 모든 가열 조리 단계의 시간 합계는 20분을 넘지 않도록 하며, 볶음·찜 요리는 총 15~20분 내외의 현실적인 시간으로 작성하세요. 사용하지 않는 재료나 조미료는 절대 언급하지 말고, "사용하지 않음", "아직 넣지 않음" 같은 부정 설명도 쓰지 마세요. 음식 종류·필요 재료·태그·조리 시간·난이도는 각각 별도 필드에만 넣고 steps 배열에는 절대 넣지 마세요. 재료 손질, 예열 또는 기름 두르기, 핵심 조리, 간 맞추기, 마무리 순서가 자연스럽게 이어지도록 작성하세요. 반드시 JSON 객체 하나만 반환하세요.
형식: {"menus":[{"name":"메뉴명","description":"돼지고기와 감자를 활용한 파스타입니다.","cuisine":["음식 종류"],"tags":["태그"],"steps":["1단계 내용","2단계 내용"],"cookTime":"조리 시간","difficulty":"쉬움|보통|어려움","ingredients":["필요 재료"],"missingIngredients":["추가 재료"]}]}

<검색 문서>
${context}
</검색 문서>`;
}

function validBody(body) {
  return body && Array.isArray(body.ingredients) && body.ingredients.length > 0 &&
    body.ingredients.length <= 50 && body.ingredients.every(item => typeof item === 'string' && item.trim());
}

// 선택한 음식 종류가 지원 목록에 있고 중복되지 않는지 검증합니다.
function validCuisines(cuisines) {
  return Array.isArray(cuisines) && cuisines.length <= CUISINES.length && cuisines.every(cuisine => CUISINES.includes(cuisine));
}

// 레시피의 cuisine 배열과 선택 조건을 비교해 OR 조건으로 후보를 필터링합니다.
function filterByCuisine(hits, cuisines) {
  const prepared = hits.map(hit => ({
    ...hit,
    cuisine: Array.isArray(hit.metadata?.cuisine) && hit.metadata.cuisine.length
      ? hit.metadata.cuisine
      : inferCuisine(hit.recipe_name, hit.content)
  }));
  return filterRecipesByCuisine(prepared, cuisines);
}

// 재료명 비교를 위해 공백과 문장부호를 정리합니다.
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
  return INGREDIENT_ALIASES[normalized] || normalized;
}

// 구버전 DB 문서에 수량이 없을 때도 화면에 일관된 대략적인 분량을 표시합니다.
function ensureIngredientQuantity(value) {
  const text = String(value || '').trim();
  if (!text || /\d+(?:[./]\d+)?\s*(?:kg|g|mg|ml|l|개|알|장|봉|팩|캔|컵|큰술|작은술|스푼|쪽|대|줄|마리|근|인분)/i.test(text)) return text;
  if (/소금|후추|고춧가루|참깨|설탕/.test(text)) return `${text} 1작은술`;
  if (/간장|식초|참기름|올리브유|식용유|된장|고추장|굴소스|버터/.test(text)) return `${text} 1큰술`;
  if (/계란|달걀/.test(text)) return `${text} 2개`;
  if (/면|파스타|우동|국수|밥|쌀/.test(text)) return `${text} 1인분`;
  if (/닭|소고기|돼지고기|연어|새우|어묵|두부/.test(text)) return `${text} 150g`;
  return `${text} 100g`;
}

function rankRecipeHits(userIngredients, hits, limit = 40) {
  const userKeys = new Set(userIngredients.map(canonicalIngredient).filter(Boolean));
  const scored = hits.map(hit => {
    const recipeKeys = new Set((hit.requiredIngredients || []).map(canonicalIngredient).filter(Boolean));
    const matched = [...userKeys].filter(key => recipeKeys.has(key));
    const matchCount = matched.length;
    const matchRatio = matchCount / Math.max(recipeKeys.size, 1);
    const coverageRatio = matchCount / Math.max(userKeys.size, 1);
    const coreMatchCount = matched.filter(key => CORE_INGREDIENTS.has(key)).length;
    const finalScore = (matchCount * 0.5) + (matchRatio * 0.3) + (coverageRatio * 0.2);
    return { ...hit, matchCount, matchRatio, coverageRatio, coreMatchCount, finalScore };
  });
  scored.sort((a, b) => b.coreMatchCount - a.coreMatchCount || b.finalScore - a.finalScore || (b.similarity || 0) - (a.similarity || 0));
  const strong = scored.filter(hit => hit.matchCount > 1);
  const weak = scored.filter(hit => hit.matchCount <= 1);
  return (strong.length >= 3 ? strong : [...strong, ...weak]).slice(0, Math.max(limit, 3));
}

// 검색된 레시피 원문에서 쉼표로 나열된 필요 재료를 추출합니다.
function extractRecipeIngredients(content) {
  const labeledMatch = String(content || '').match(/필요\s*재료\s*:\s*(.+?)(?:\.\s*(?:조리 순서|태그|조리 시간|난이도)\s*:|$)/);
  if (labeledMatch) {
    return labeledMatch[1]
      .split(/,|\s+및\s+|\s+와\s+|\s+과\s+/)
      .map(item => ensureIngredientQuantity(item.trim().replace(/[.。]$/g, '')))
      .filter(Boolean);
  }
  const patterns = [
    /(?:은|는)\s+(.+?)(?:으로 만드는|으로 만들 수 있다|으로 만든다|로 만든다|을 넣어|를 사용한다)[.。]/,
    /(?:은|는)\s+(.+?)(?:으로 만드는|으로 만들 수 있다|으로 만든다|로 만든다|을 넣어|를 사용한다)/
  ];
  const match = patterns.map(pattern => String(content || '').match(pattern)).find(Boolean);
  if (!match) return [];
  return match[1]
    .split(/,|\s+및\s+|\s+와\s+|\s+과\s+/)
    .map(item => ensureIngredientQuantity(item.trim().replace(/[.。]$/g, '')))
    .filter(Boolean);
}

function resolveCookTime(value, content, recipe = []) {
  const format = candidate => {
    const match = String(candidate || '').match(/(\d+)\s*(?:[~\-–]\s*(\d+)\s*)?분/);
    if (!match) return '';
    return match[2] ? `${match[1]}~${match[2]}분` : `${match[1]}분`;
  };

  const provided = format(value);
  if (provided) return provided;

  const labeled = String(content || '').match(/조리\s*시간(?:은)?\s*(?:약\s*)?(\d+)\s*(?:[~\-–]\s*(\d+)\s*)?분/);
  if (labeled) return labeled[2] ? `${labeled[1]}~${labeled[2]}분` : `${labeled[1]}분`;

  const estimatedMinutes = (Array.isArray(recipe) ? recipe : [])
    .flatMap(step => [...String(step || '').matchAll(/(\d+)\s*(?:[~\-–]\s*(\d+)\s*)?분/g)])
    .reduce((total, match) => total + Number(match[2] || match[1]), 0);
  return `${Math.min(Math.max(estimatedMinutes || 20, 5), 180)}분`;
}

// 사용자가 고른 재료를 기준으로 레시피의 부족 재료를 서버에서 확정합니다.
function calculateMissingIngredients(ownedIngredients, requiredIngredients) {
  const owned = new Set((Array.isArray(ownedIngredients) ? ownedIngredients : []).map(canonicalIngredient).filter(Boolean));
  const seen = new Set();
  return (Array.isArray(requiredIngredients) ? requiredIngredients : []).filter(item => {
    const key = canonicalIngredient(item);
    if (!key || owned.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameIngredientList(left, right) {
  const normalizeList = values => [...new Set((Array.isArray(values) ? values : []).map(canonicalIngredient).filter(Boolean))].sort();
  return JSON.stringify(normalizeList(left)) === JSON.stringify(normalizeList(right));
}

function objectParticle(value) {
  const code = String(value || '').trim().charCodeAt(String(value || '').trim().length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 ? '을' : '를';
}

function cardDescription(value, hit) {
  const sourceDescription = extractLabeledValue(hit?.content, '설명');
  if (sourceDescription) return sourceDescription;
  const description = String(value || '').replace(/\s+/g, ' ').trim();
  const looksLikeRecipe = description.length > 80 || /준비합니다|예열|넣고|볶아|볶고|익히|조리|분간|불을|단계/.test(description) || (description.match(/[.。!?]/g) || []).length > 1;
  if (description && !looksLikeRecipe) return description;
  const ingredients = (hit?.requiredIngredients || []).filter(Boolean).slice(0, 2);
  const main = ingredients.join('와 ');
  return main ? `${main}${objectParticle(main)} 활용한 ${hit.recipe_name}입니다.` : `주재료를 활용한 ${hit.recipe_name}입니다.`;
}

function validateMenu(menu, { hit, ownedIngredients, cuisines, strictCuisine = true }) {
  const failures = [];
  if (!hit) failures.push('검색 후보에 없는 메뉴');
  const requiredIngredients = hit?.requiredIngredients || [];
  const matchedIngredients = requiredIngredients.filter(item => ownedIngredients.some(owned => canonicalIngredient(owned) === canonicalIngredient(item)));
  const expectedMissing = calculateMissingIngredients(ownedIngredients, requiredIngredients);
  if (strictCuisine && cuisines.length && !hit?.cuisine?.some(cuisine => cuisines.includes(cuisine))) {
    failures.push(`선택 cuisine 불일치: ${hit?.cuisine?.join(', ') || '없음'}`);
  }
  if (matchedIngredients.length < 1) failures.push('사용자 재료와 실제 교집합 없음');
  if (!sameIngredientList(menu?.missingIngredients, expectedMissing)) failures.push('missingIngredients 계산 불일치');
  const generatedRecipe = cleanRecipeSteps(menu?.steps || menu?.recipe);
  const sourceRecipe = extractRecipeSteps(hit?.content);
  return {
    ok: failures.length === 0,
    failures,
    value: {
      ...menu,
      name: normalizeRecipeName(hit?.recipe_name),
      description: cardDescription(menu?.description, hit),
      cuisine: hit?.cuisine || [],
      cookTime: resolveCookTime(menu?.cookTime, hit?.content, menu?.recipe),
      ingredients: requiredIngredients,
      missingIngredients: expectedMissing,
      // LLM이 단계를 축약하면 검색 원문의 상세 조리 순서를 우선합니다.
      recipe: sourceRecipe.length > generatedRecipe.length ? sourceRecipe : generatedRecipe
    }
  };
}

// Claude가 누락한 메뉴를 검색 문서만으로 보충할 때 사용할 기본 메뉴 객체를 만듭니다.
const RECIPE_METADATA_LINE = /^(?:음식\s*종류|필요\s*재료|태그|조리\s*시간|난이도)\s*:/;

function extractLabeledValue(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(`(?:^|\\n|[.。]\\s*)${escapedLabel}\\s*:\\s*([^\\n.。]+)`, 'm'));
  return match ? match[1].trim() : '';
}

function extractRecipeSteps(content) {
  const source = String(content || '').replace(/\r/g, '');
  const match = source.match(/(?:^|\n|[.。]\s*)조리\s*순서\s*:\s*([\s\S]*?)(?=(?:\n|[.。]\s*)(?:음식\s*종류|필요\s*재료|태그|조리\s*시간|난이도)\s*:|$)/m);
  if (!match) return [];
  return match[1]
    .replace(/(?:^|\s)\d+\s*[.)]\s*/g, '\n')
    .split(/\n+/)
    .flatMap(splitRecipeStepText)
    .filter(step => step && !RECIPE_METADATA_LINE.test(step));
}

// 한 항목에 여러 문장이 들어온 구버전/LLM 응답도 화면에서 동작 단위별로 나눕니다.
function splitRecipeStepText(value) {
  const text = String(value || '')
    .trim()
    .replace(/^[-•]\s*/, '')
    .replace(/^[.。\s]+|[.。\s]+$/g, '');
  if (!text) return [];
  return text
    .split(/(?<=[.!?。])\s+/)
    .map(step => step.trim().replace(/^[-•]\s*/, '').replace(/^[.。\s]+|[.。\s]+$/g, ''))
    .filter(Boolean);
}

function cleanRecipeSteps(recipe) {
  const values = Array.isArray(recipe) ? recipe : [];
  return values.flatMap(value => {
    const step = String(value || '').trim();
    if (!step) return [];
    const structuredSteps = step.includes('조리 순서') ? extractRecipeSteps(step) : [];
    return structuredSteps.length ? structuredSteps : splitRecipeStepText(step);
  }).filter(step => !RECIPE_METADATA_LINE.test(step));
}

function normalizeRecipeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    // 모델이나 원문에 붙은 목록 번호는 메뉴명으로 노출하지 않습니다.
    .replace(/^(?:메뉴\s*)?(?:\d{1,3}|[①②③④⑤⑥⑦⑧⑨⑩])\s*[.)、:：-]?\s*/u, '')
    .replace(/(^|\s)([^\s]+)(?:\s+\2)(?=\s|$)/g, '$1$2');
}

function parseRecipeMetadata(content) {
  const ingredients = extractLabeledValue(content, '필요 재료')
    .split(/,|\s+및\s+|\s+와\s+|\s+과\s+/)
    .map(item => item.trim())
    .filter(Boolean);
  const cookTime = extractLabeledValue(content, '조리 시간').match(/\d+\s*분/)?.[0] || '';
  const difficulty = extractLabeledValue(content, '난이도').match(/쉬움|보통|어려움/)?.[0] || '';
  return {
    cuisine: extractLabeledValue(content, '음식 종류'),
    ingredients,
    tags: extractLabeledValue(content, '태그').split(/,|\s+/).map(tag => tag.trim()).filter(Boolean),
    cookTime,
    difficulty,
    recipe: extractRecipeSteps(content)
  };
}

function fallbackMenuFromHit(hit, ownedIngredients) {
  const content = String(hit.content || '');
  const metadata = parseRecipeMetadata(content);
  const requiredIngredients = hit.requiredIngredients?.length ? hit.requiredIngredients : metadata.ingredients;
  return {
    name: normalizeRecipeName(hit.recipe_name),
    cuisine: hit.cuisine || metadata.cuisine || inferCuisine(hit.recipe_name, content),
    description: cardDescription('', { ...hit, requiredIngredients }),
    recipe: metadata.recipe,
    cookTime: resolveCookTime(metadata.cookTime, content, metadata.recipe),
    difficulty: metadata.difficulty || '보통',
    ingredients: requiredIngredients,
    missingIngredients: calculateMissingIngredients(ownedIngredients, requiredIngredients),
    tags: metadata.tags
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });
  const config = env();
  if (!config.openai || !config.supabaseUrl || !config.supabaseKey) {
    return res.status(500).json({ error: 'RAG 서버 환경변수가 설정되지 않았습니다.' });
  }
  if (!validBody(req.body)) return res.status(400).json({ error: '재료 입력이 올바르지 않습니다.' });
  const cuisines = Array.isArray(req.body.cuisines) ? [...new Set(req.body.cuisines)] : [];
  if (!validCuisines(cuisines)) return res.status(400).json({ error: '음식 종류 입력이 올바르지 않습니다.' });

  try {
    const body = req.body;
    const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter(item => typeof item === 'string').slice(0, 20) : [];
    const query = `${body.ingredients.join(', ')} ${cuisines.join(', ')} ${filters.time || ''} ${filters.difficulty || ''} ${filters.diet || ''}`;
    const queryEmbedding = await embed(query, config.openai);
    const selectedHits = await searchRecipes(queryEmbedding, config, cuisines);
    const selectedUniqueHits = [...new Map(selectedHits.map(hit => [hit.recipe_name, hit])).values()];
    const preferredHits = filterByCuisine(selectedUniqueHits, cuisines);
    const allHits = cuisines.length ? preferredHits : selectedUniqueHits;
    if (!allHits.length) return res.status(404).json({ error: '선택한 음식 종류의 레시피를 찾지 못했습니다.' });

    // 선택 카테고리를 앞에 배치하고 부족한 수는 다른 카테고리로 채웁니다.
    const cuisineHits = allHits;
    const enrichedHits = cuisineHits.map(hit => ({
      ...hit,
      requiredIngredients: extractRecipeIngredients(hit.content),
      cuisine: Array.isArray(hit.metadata?.cuisine) && hit.metadata.cuisine.length
        ? hit.metadata.cuisine
        : inferCuisine(hit.recipe_name, hit.content)
    }));
    // 벡터 유사도 후보를 재료 매칭 점수와 핵심 재료 우선순위로 재정렬합니다.
    const rankedHits = rankRecipeHits(body.ingredients, enrichedHits, 20);

    // 검색 후보는 충분히 확보하되, LLM 컨텍스트는 제한해 요청 크기 초과를 방지합니다.
    const promptHits = rankedHits.slice(0, PROMPT_HIT_COUNT);
    let generatedMenus = [];
    try {
      const answer = await openai('chat/completions', {
        model: CHAT_MODEL,
        response_format: { type: 'json_object' },
        max_tokens: 3000,
        messages: [
          { role: 'system', content: '검색 문서에 근거한 JSON만 반환하세요.' },
          { role: 'user', content: promptFor({ ingredients: body.ingredients, filters: { ...filters, cuisines }, exclude, hits: promptHits }) }
        ]
      }, config.openai, 12000);
      const result = JSON.parse(answer.choices?.[0]?.message?.content || '{}');
      generatedMenus = Array.isArray(result.menus) ? result.menus : [];
    } catch (error) {
      // LLM 응답이 실패해도 검색 후보의 기본 정보로 3개를 구성합니다.
      console.error('LLM recommendation failed:', error.message);
    }
    const hitByName = new Map(rankedHits.map(hit => [normalizeRecipeName(hit.recipe_name), hit]));
    const normalizedMenuName = value => normalizeRecipeName(value).replace(/\s+/g, '');
    const findHit = name => hitByName.get(normalizeRecipeName(name)) || rankedHits.find(hit => normalizedMenuName(hit.recipe_name) === normalizedMenuName(name));
    const excludedNames = new Set(exclude);
    const seenGeneratedNames = new Set();
    const validationFailures = [];
    const strictCuisine = cuisines.length > 0;
    const menus = generatedMenus.map(menu => {
      const hit = findHit(menu.name);
      if (!hit || excludedNames.has(hit?.recipe_name) || seenGeneratedNames.has(hit?.recipe_name)) {
        validationFailures.push({ menu: menu?.name || '(이름 없음)', reasons: [!hit ? '검색 후보에 없는 메뉴' : '중복 또는 제외 메뉴'] });
        return null;
      }
      seenGeneratedNames.add(hit.recipe_name);
      const validation = validateMenu(menu, { hit, ownedIngredients: body.ingredients, cuisines, strictCuisine });
      if (!validation.ok) validationFailures.push({ menu: menu.name, reasons: validation.failures });
      return validation.ok ? validation.value : null;
    }).filter(Boolean);
    const seenNames = new Set(menus.map(menu => normalizedMenuName(menu.name)));
    for (const hit of rankedHits) {
      if (menus.length >= 3) break;
      if (seenNames.has(normalizedMenuName(hit.recipe_name)) || excludedNames.has(hit.recipe_name)) continue;
      const fallback = fallbackMenuFromHit(hit, body.ingredients);
      const validation = validateMenu(fallback, { hit, ownedIngredients: body.ingredients, cuisines, strictCuisine });
      if (validation.ok) {
        menus.push(validation.value);
        seenNames.add(normalizedMenuName(hit.recipe_name));
      } else {
        validationFailures.push({ menu: hit.recipe_name, reasons: validation.failures });
      }
    }
    // 선택 cuisine 후보만으로 부족할 때만 검색 범위를 완화해 마지막 보충을 시도합니다.
    if (menus.length < 3 && cuisines.length) {
      try {
        const relaxedHits = await searchRecipes(queryEmbedding, config, []);
        const relaxedUniqueHits = [...new Map(relaxedHits.map(hit => [hit.recipe_name, hit])).values()];
        const relaxedEnriched = relaxedUniqueHits.map(hit => ({
          ...hit,
          requiredIngredients: extractRecipeIngredients(hit.content),
          cuisine: Array.isArray(hit.metadata?.cuisine) && hit.metadata.cuisine.length ? hit.metadata.cuisine : inferCuisine(hit.recipe_name, hit.content)
        }));
        for (const hit of rankRecipeHits(body.ingredients, relaxedEnriched)) {
          if (menus.length >= 3) break;
          if (seenNames.has(normalizedMenuName(hit.recipe_name)) || excludedNames.has(hit.recipe_name)) continue;
          const fallback = fallbackMenuFromHit(hit, body.ingredients);
          const validation = validateMenu(fallback, { hit, ownedIngredients: body.ingredients, cuisines, strictCuisine: false });
          if (validation.ok) {
            console.warn(`Cuisine fallback used for ${hit.recipe_name}: ${hit.cuisine.join(', ')}`);
            menus.push(validation.value);
            seenNames.add(normalizedMenuName(hit.recipe_name));
          }
        }
      } catch (error) {
        console.error('Relaxed candidate search failed:', error.message);
      }
    }
    if (validationFailures.length) {
      console.warn('Recommendation validation failures:', JSON.stringify(validationFailures));
    }
    if (menus.length < 3) throw new Error('3개의 검색 후보를 확보하지 못했습니다.');
    return res.status(200).json({
      menus: menus.slice(0, 3),
      cuisines,
      sources: cuisineHits.map(hit => hit.recipe_name),
      message: undefined
    });
  } catch (error) {
    console.error('Recommendation request failed:', error.message);
    return res.status(502).json({ error: '다른 메뉴 추천을 생성하지 못했습니다.' });
  }
};
