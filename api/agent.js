const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
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

아래 검색 문서에 있는 레시피를 근거로 서로 다른 메뉴를 최대 3개 추천하세요. 검색 문서에 없는 조리법을 새로 지어내지 말고, 재료가 부족하면 missingIngredients에 표시하세요. 제외 메뉴는 반환하지 마세요. 반드시 JSON 객체 하나만 반환하세요.
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
  return String(value || '').toLocaleLowerCase('ko-KR').replace(/[\s.,。]+/g, '');
}

// 검색된 레시피 원문에서 쉼표로 나열된 필요 재료를 추출합니다.
function extractRecipeIngredients(content) {
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
  const cookTime = content.match(/(?:조리 시간은|조리 시간은 약)\s*(\d+)분/);
  const difficulty = content.match(/난이도는\s*(쉬움|보통|어려움)/);
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
    let hits = await searchRecipes(queryEmbedding, config, cuisines);
    // 같은 레시피의 여러 청크가 후보 수를 차지하지 않도록 메뉴 단위로 중복을 제거합니다.
    const uniqueHits = [...new Map(hits.map(hit => [hit.recipe_name, hit])).values()];
    let cuisineHits = filterByCuisine(uniqueHits, cuisines);
    // 구형 RPC가 아직 배포된 경우에도 카테고리 전용 질의로 후보 3개를 추가 확보합니다.
    if (cuisines.length && cuisineHits.length < 3) {
      const cuisineQuery = `${cuisines.join(', ')} 대표 요리 레시피`;
      const cuisineQueryHits = await searchRecipes(await embed(cuisineQuery, config.openai), config, cuisines);
      hits = [...hits, ...cuisineQueryHits];
      const mergedHits = [...new Map(hits.map(hit => [hit.recipe_name, hit])).values()];
      cuisineHits = filterByCuisine(mergedHits, cuisines);
    }
    if (!hits.length) return res.status(404).json({ error: '관련 레시피를 찾지 못했습니다.' });
    if (cuisines.length && !cuisineHits.length) {
      return res.status(200).json({ menus: [], cuisines, message: '선택하신 음식 종류에 맞는 레시피를 찾지 못했어요. 다른 재료나 음식 종류를 선택해보세요.' });
    }
    const enrichedHits = cuisineHits.map(hit => ({
      ...hit,
      requiredIngredients: extractRecipeIngredients(hit.content),
      cuisine: Array.isArray(hit.metadata?.cuisine) && hit.metadata.cuisine.length
        ? hit.metadata.cuisine
        : inferCuisine(hit.recipe_name, hit.content)
    }));

    const answer = await openai('chat/completions', {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '검색 문서에 근거한 JSON만 반환하세요.' },
        { role: 'user', content: promptFor({ ingredients: body.ingredients, filters: { ...filters, cuisines }, exclude, hits: enrichedHits }) }
      ]
    }, config.openai);
    const result = JSON.parse(answer.choices?.[0]?.message?.content || '{}');
    if (!Array.isArray(result.menus) || result.menus.length === 0) throw new Error('Invalid RAG response');
    const hitByName = new Map(enrichedHits.map(hit => [hit.recipe_name, hit]));
    const normalizedMenuName = value => String(value || '').replace(/\s+/g, '');
    const findHit = name => hitByName.get(name) || enrichedHits.find(hit => normalizedMenuName(hit.recipe_name) === normalizedMenuName(name));
    const excludedNames = new Set(exclude);
    // 모델이 검색 문서에 없는 이름이나 선택하지 않은 카테고리를 반환하지 못하게 합니다.
    const menus = result.menus.map(menu => {
      const hit = findHit(menu.name);
      if (!hit || excludedNames.has(hit.recipe_name)) return null;
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
    const seenNames = new Set(menus.map(menu => menu.name));
    for (const hit of enrichedHits) {
      if (menus.length >= 3) break;
      if (seenNames.has(hit.recipe_name) || excludedNames.has(hit.recipe_name)) continue;
      menus.push(fallbackMenuFromHit(hit, body.ingredients));
      seenNames.add(hit.recipe_name);
    }
    if (menus.length < 3) {
      return res.status(409).json({
        menus: [],
        cuisines,
        message: cuisines.length
          ? '선택하신 음식 종류와 재료 조건을 만족하는 메뉴 3개를 준비하지 못했어요. 다른 재료나 음식 종류를 선택해보세요.'
          : '조건을 만족하는 메뉴 3개를 준비하지 못했어요. 재료나 필터를 바꿔 다시 시도해보세요.'
      });
    }
    return res.status(200).json({
      menus: menus.slice(0, 3),
      cuisines,
      sources: cuisineHits.map(hit => hit.recipe_name),
      message: menus.length < 3 ? '추가로 추천할 수 있는 다른 메뉴가 부족합니다.' : undefined
    });
  } catch (error) {
    console.error(error.message);
    return res.status(502).json({ error: 'RAG 추천을 생성하지 못했습니다.' });
  }
};
