const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5.6-terra';
const CUISINES = ['한식', '중식', '양식', '일식', '분식'];
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
  if (/(떡볶이|김밥|김치전|비빔국수|분식)/.test(text)) return ['분식'];
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

async function searchRecipes(queryEmbedding, config, cuisines = []) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/match_recipe_chunks`, {
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
  });
  if (!response.ok) {
    // 새 RPC 마이그레이션 전에도 동작하도록 기존 3개 인자 RPC로 한 번 더 시도합니다.
    const legacyResponse = await fetch(`${config.supabaseUrl}/rest/v1/rpc/match_recipe_chunks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: config.supabaseKey,
        authorization: `Bearer ${config.supabaseKey}`
      },
      body: JSON.stringify({ query_embedding: queryEmbedding, match_threshold: -1, match_count: 2000 })
    });
    if (!legacyResponse.ok) throw new Error(`Supabase search failed (${legacyResponse.status})`);
    return legacyResponse.json();
  }
  return response.json();
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

아래 검색 문서에 있는 레시피를 근거로 정확히 3개 추천하세요. 선택한 음식 종류가 있으면 해당 종류를 우선하고, 3개가 부족할 때만 다른 음식 종류를 보충하세요. 검색 문서에 없는 조리법을 새로 지어내지 말고, 재료가 부족하면 missingIngredients에 표시하세요. 제외 메뉴는 반환하지 마세요. 반드시 JSON 객체 하나만 반환하세요.
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
  if (!cuisines.length) return hits;
  return hits.filter(hit => {
    const cuisine = Array.isArray(hit.metadata?.cuisine) && hit.metadata.cuisine.length
      ? hit.metadata.cuisine
      : inferCuisine(hit.recipe_name, hit.content);
    return cuisine.some(value => cuisines.includes(value));
  });
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

// 사용자가 고른 재료를 기준으로 레시피의 부족 재료를 서버에서 확정합니다.
function calculateMissingIngredients(ownedIngredients, requiredIngredients) {
  const owned = new Set(ownedIngredients.map(normalizeIngredient));
  return requiredIngredients.filter(item => !owned.has(normalizeIngredient(item)));
}

// Claude가 누락한 메뉴를 검색 문서만으로 보충할 때 사용할 기본 메뉴 객체를 만듭니다.
function fallbackMenuFromHit(hit, ownedIngredients) {
  const content = String(hit.content || '');
  const requiredIngredients = hit.requiredIngredients || [];
  const cookTime = content.match(/(?:조리 시간은|조리 시간은 약|조리 시간\s*:)\s*(\d+)분/);
  const difficulty = content.match(/(?:난이도는|난이도\s*:)\s*(쉬움|보통|어려움)/);
  return {
    name: hit.recipe_name,
    cuisine: hit.cuisine || inferCuisine(hit.recipe_name, content),
    description: content.split(/[.。]/)[0].trim(),
    recipe: content.split(/[.。]/).map(step => step.trim()).filter(Boolean),
    cookTime: cookTime ? `${cookTime[1]}분` : '시간 정보 없음',
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
    let preferredHits = filterByCuisine(selectedUniqueHits, cuisines);
    let allHits = selectedUniqueHits;

    // 선택한 카테고리만으로 3개가 안 되면 전체 카테고리에서 추가 후보를 확보합니다.
    if (cuisines.length && preferredHits.length < 3) {
      const allCategoryHits = await searchRecipes(queryEmbedding, config, []);
      allHits = [...new Map([...selectedUniqueHits, ...allCategoryHits].map(hit => [hit.recipe_name, hit])).values()];
      preferredHits = filterByCuisine(allHits, cuisines);
    }
    if (!allHits.length) return res.status(404).json({ error: '관련 레시피를 찾지 못했습니다.' });

    // 선택 카테고리를 앞에 배치하고 부족한 수는 다른 카테고리로 채웁니다.
    const cuisineHits = cuisines.length
      ? [...preferredHits, ...allHits.filter(hit => !preferredHits.some(item => item.recipe_name === hit.recipe_name))]
      : allHits;
    const usedFallbackCuisine = cuisines.length && preferredHits.length < 3;
    const enrichedHits = cuisineHits.map(hit => ({
      ...hit,
      requiredIngredients: extractRecipeIngredients(hit.content),
      cuisine: Array.isArray(hit.metadata?.cuisine) && hit.metadata.cuisine.length
        ? hit.metadata.cuisine
        : inferCuisine(hit.recipe_name, hit.content)
    }));

    // 검색 후보는 충분히 확보하되, LLM 컨텍스트는 제한해 요청 크기 초과를 방지합니다.
    const promptHits = enrichedHits.slice(0, 40);
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
    const hitByName = new Map(enrichedHits.map(hit => [hit.recipe_name, hit]));
    const normalizedMenuName = value => String(value || '').replace(/\s+/g, '');
    const findHit = name => hitByName.get(name) || enrichedHits.find(hit => normalizedMenuName(hit.recipe_name) === normalizedMenuName(name));
    const excludedNames = new Set(exclude);
    const seenGeneratedNames = new Set();
    // 모델이 검색 문서에 없는 이름이나 선택하지 않은 카테고리를 반환하지 못하게 합니다.
    const menus = generatedMenus.map(menu => {
      const hit = findHit(menu.name);
      if (!hit || excludedNames.has(hit.recipe_name) || seenGeneratedNames.has(hit.recipe_name)) return null;
      seenGeneratedNames.add(hit.recipe_name);
      const requiredIngredients = hit?.requiredIngredients?.length
        ? hit.requiredIngredients
        : (Array.isArray(menu.ingredients) ? menu.ingredients : []);
      return {
        ...menu,
        cuisine: hit?.cuisine || inferCuisine(menu.name, menu.description),
        ingredients: requiredIngredients,
        missingIngredients: calculateMissingIngredients(body.ingredients, requiredIngredients)
      };
    }).filter(Boolean);
    const isPreferredMenu = menu => !cuisines.length || (menu.cuisine || []).some(cuisine => cuisines.includes(cuisine));
    menus.sort((left, right) => Number(!isPreferredMenu(right)) - Number(!isPreferredMenu(left)));
    const seenNames = new Set(menus.map(menu => menu.name));
    for (const hit of enrichedHits) {
      if (menus.length >= 3) break;
      if (seenNames.has(hit.recipe_name) || excludedNames.has(hit.recipe_name)) continue;
      menus.push(fallbackMenuFromHit(hit, body.ingredients));
      seenNames.add(hit.recipe_name);
    }
    if (menus.length < 3) throw new Error('3개의 검색 후보를 확보하지 못했습니다.');
    return res.status(200).json({
      menus: menus.slice(0, 3),
      cuisines,
      sources: cuisineHits.map(hit => hit.recipe_name),
      message: usedFallbackCuisine ? '선택한 음식 종류가 부족해 다른 음식 종류의 메뉴를 함께 추천했어요.' : undefined
    });
  } catch (error) {
    console.error('Recommendation request failed:', error.message);
    return res.status(502).json({ error: '다른 메뉴 추천을 생성하지 못했습니다.' });
  }
};
