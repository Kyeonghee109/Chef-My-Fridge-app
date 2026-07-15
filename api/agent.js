const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const { calculateMissingIngredients: calculateMissingIngredientsPure, filterByCuisine: filterRecipesByCuisine } = require('./retrieval');
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5.6-terra';
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
  supabaseKey: process.env.SUPABASE_ANON_KEY
});

async function openai(path, body, key) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  return payload;
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
      match_count: 500,
      selected_cuisines: cuisines
    })
  };
  try {
    return await (await fetchSearchWithRetry(url, options, 'Supabase search')).json();
  } catch (error) {
    // 새 RPC가 아직 배포되지 않은 환경에서는 기존 인자 형태로 재시도합니다.
    const legacyOptions = {
      ...options,
      body: JSON.stringify({ query_embedding: queryEmbedding, match_threshold: -1, match_count: 2000 })
    };
    return await (await fetchSearchWithRetry(url, legacyOptions, 'Supabase legacy search')).json();
  }
}

function promptFor({ ingredients, filters, exclude, hits }) {
  const context = hits.map(hit => `- [${hit.recipe_name}] 필요 재료: ${(hit.requiredIngredients || []).join(', ')}\n  ${hit.content}`).join('\n');
  return `냉장고 재료 기반 레시피 추천을 수행하세요.
보유 재료: ${ingredients.join(', ')}
조리 시간: ${filters.time || '상관없음'}
난이도: ${filters.difficulty || '상관없음'}
식이 제한: ${filters.diet || '없음'}
음식 종류: ${filters.cuisines?.join(', ') || '전체'}
제외할 직전 메뉴: ${exclude.join(', ') || '없음'}

아래 검색 문서에 있는 레시피를 근거로 정확히 3개 추천하세요. 선택한 음식 종류가 있으면 해당 종류를 우선하고, 3개가 부족할 때만 다른 음식 종류를 보충하세요. 검색 문서에 없는 조리법을 새로 지어내지 말고, 재료가 부족하면 missingIngredients에 표시하세요. 제외 메뉴는 반환하지 마세요. 각 메뉴의 recipe 배열은 최소 5~6개의 현실적인 조리 단계로 작성하세요. 모든 단계에 구체적인 조리 시간(예: 2~3분), 불 세기(강불/중불/약불), 소금·후추·식용유·간장처럼 필요한 기본 조미료의 사용 여부와 양 또는 "사용하지 않음"을 포함하세요. 재료 손질, 예열 또는 기름 두르기, 핵심 조리, 간 맞추기, 마무리 순서가 자연스럽게 이어지도록 작성하세요. 반드시 JSON 객체 하나만 반환하세요.
형식: {"menus":[{"name":"메뉴명","description":"짧은 설명","recipe":["조리 단계"],"cookTime":"조리 시간","difficulty":"쉬움|보통|어려움","ingredients":["필요 재료"],"missingIngredients":["추가 재료"]}]}

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
      .map(item => item.trim().replace(/[.。]$/g, ''))
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
    .map(item => item.trim().replace(/[.。]$/g, ''))
    .filter(Boolean);
}

// 검색 문서에서 조리 순서 구간만 추출하고 제목·메타데이터는 단계에서 제외합니다.
function extractRecipeSteps(content) {
  const text = String(content || '');
  const labeledMatch = text.match(/조리\s*순서\s*:\s*(.*?)(?=\.\s*(?:태그|조리\s*시간|난이도)\s*:|$)/);
  const source = labeledMatch ? labeledMatch[1] : text;
  return source
    .split(/[.。]/)
    .map(step => step.trim())
    .filter(step => step && !/^(?:음식\s*종류|필요\s*재료|조리\s*순서|태그|조리\s*시간|난이도)\s*:/.test(step));
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
  return calculateMissingIngredientsPure(ownedIngredients, requiredIngredients);
}

function sameIngredientList(left, right) {
  const normalizeList = values => [...new Set((Array.isArray(values) ? values : []).map(canonicalIngredient).filter(Boolean))].sort();
  return JSON.stringify(normalizeList(left)) === JSON.stringify(normalizeList(right));
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
  return {
    ok: failures.length === 0,
    failures,
    value: {
      ...menu,
      name: hit?.recipe_name,
      cuisine: hit?.cuisine || [],
      cookTime: resolveCookTime(menu?.cookTime, hit?.content, menu?.recipe),
      ingredients: requiredIngredients,
      missingIngredients: expectedMissing
    }
  };
}

// Claude가 누락한 메뉴를 검색 문서만으로 보충할 때 사용할 기본 메뉴 객체를 만듭니다.
function fallbackMenuFromHit(hit, ownedIngredients) {
  const content = String(hit.content || '');
  const requiredIngredients = hit.requiredIngredients || [];
  const difficulty = content.match(/(?:난이도는|난이도\s*:)\s*(쉬움|보통|어려움)/);
  const recipe = extractRecipeSteps(content);
  return {
    name: hit.recipe_name,
    cuisine: hit.cuisine || inferCuisine(hit.recipe_name, content),
    description: content.split(/[.。]/)[0].trim(),
    recipe,
    cookTime: resolveCookTime('', content, recipe),
    difficulty: difficulty ? difficulty[1] : '보통',
    ingredients: requiredIngredients,
    missingIngredients: calculateMissingIngredients(ownedIngredients, requiredIngredients)
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
    const rankedHits = rankRecipeHits(body.ingredients, enrichedHits);

    // 검색 후보는 충분히 확보하되, LLM 컨텍스트는 제한해 요청 크기 초과를 방지합니다.
    const promptHits = rankedHits.slice(0, 40);
    let generatedMenus = [];
    try {
      const answer = await openai('chat/completions', {
        model: CHAT_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '검색 문서에 근거한 JSON만 반환하세요.' },
          { role: 'user', content: promptFor({ ingredients: body.ingredients, filters: { ...filters, cuisines }, exclude, hits: promptHits }) }
        ]
      }, config.openai);
      const result = JSON.parse(answer.choices?.[0]?.message?.content || '{}');
      generatedMenus = Array.isArray(result.menus) ? result.menus : [];
    } catch (error) {
      // LLM 응답이 실패해도 검색 후보의 기본 정보로 3개를 구성합니다.
      console.error('LLM recommendation failed:', error.message);
    }
    const hitByName = new Map(rankedHits.map(hit => [hit.recipe_name, hit]));
    const normalizedMenuName = value => String(value || '').replace(/\s+/g, '');
    const findHit = name => hitByName.get(name) || rankedHits.find(hit => normalizedMenuName(hit.recipe_name) === normalizedMenuName(name));
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
    const seenNames = new Set(menus.map(menu => menu.name));
    for (const hit of rankedHits) {
      if (menus.length >= 3) break;
      if (seenNames.has(hit.recipe_name) || excludedNames.has(hit.recipe_name)) continue;
      const fallback = fallbackMenuFromHit(hit, body.ingredients);
      const validation = validateMenu(fallback, { hit, ownedIngredients: body.ingredients, cuisines, strictCuisine });
      if (validation.ok) {
        menus.push(validation.value);
        seenNames.add(hit.recipe_name);
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
          if (seenNames.has(hit.recipe_name) || excludedNames.has(hit.recipe_name)) continue;
          const fallback = fallbackMenuFromHit(hit, body.ingredients);
          const validation = validateMenu(fallback, { hit, ownedIngredients: body.ingredients, cuisines, strictCuisine: false });
          if (validation.ok) {
            console.warn(`Cuisine fallback used for ${hit.recipe_name}: ${hit.cuisine.join(', ')}`);
            menus.push(validation.value);
            seenNames.add(hit.recipe_name);
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
