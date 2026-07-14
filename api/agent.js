const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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
  const payload = await openai('embeddings', { model: 'text-embedding-3-small', input: text }, key);
  return payload.data[0].embedding;
}

async function searchRecipes(queryEmbedding, config) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/match_recipe_chunks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: config.supabaseKey,
      authorization: `Bearer ${config.supabaseKey}`
    },
    body: JSON.stringify({ query_embedding: queryEmbedding, match_threshold: 0.18, match_count: 6 })
  });
  if (!response.ok) throw new Error(`Supabase search failed (${response.status})`);
  return response.json();
}

function promptFor({ ingredients, filters, exclude, hits }) {
  const context = hits.map(hit => `- [${hit.recipe_name}] ${hit.content}`).join('\n');
  return `냉장고 재료 기반 레시피 추천을 수행하세요.
보유 재료: ${ingredients.join(', ')}
조리 시간: ${filters.time || '상관없음'}
난이도: ${filters.difficulty || '상관없음'}
식이 제한: ${filters.diet || '없음'}
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });
  const config = env();
  if (!config.openai || !config.supabaseUrl || !config.supabaseKey) {
    return res.status(500).json({ error: 'RAG 서버 환경변수가 설정되지 않았습니다.' });
  }
  if (!validBody(req.body)) return res.status(400).json({ error: '재료 입력이 올바르지 않습니다.' });

  try {
    const body = req.body;
    const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter(item => typeof item === 'string').slice(0, 20) : [];
    const query = `${body.ingredients.join(', ')} ${filters.time || ''} ${filters.difficulty || ''} ${filters.diet || ''}`;
    const hits = await searchRecipes(await embed(query, config.openai), config);
    if (!hits.length) return res.status(404).json({ error: '관련 레시피를 찾지 못했습니다.' });

    const answer = await openai('chat/completions', {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '검색 문서에 근거한 JSON만 반환하세요.' },
        { role: 'user', content: promptFor({ ingredients: body.ingredients, filters, exclude, hits }) }
      ]
    }, config.openai);
    const result = JSON.parse(answer.choices?.[0]?.message?.content || '{}');
    if (!Array.isArray(result.menus) || result.menus.length === 0) throw new Error('Invalid RAG response');
    return res.status(200).json({ menus: result.menus.slice(0, 3), sources: hits.map(hit => hit.recipe_name) });
  } catch (error) {
    console.error(error.message);
    return res.status(502).json({ error: 'RAG 추천을 생성하지 못했습니다.' });
  }
};
