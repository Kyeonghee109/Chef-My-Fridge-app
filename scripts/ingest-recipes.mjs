import fs from 'node:fs/promises';

const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');

const recipeDataPath = process.env.RECIPE_DATA_PATH || new URL('../rag-agent/data/recipes.json', import.meta.url);
const rawRecipes = JSON.parse(await fs.readFile(recipeDataPath, 'utf8'));
const recipes = rawRecipes.map(recipe => ({
  name: recipe.name || recipe.title,
  cuisine: Array.isArray(recipe.cuisine) ? recipe.cuisine : [],
  text: recipe.text || [
    recipe.title,
    `음식 종류: ${(recipe.cuisine || []).join(', ')}`,
    `필요 재료: ${(recipe.ingredients || []).join(', ')}`,
    `조리 순서: ${(recipe.steps || []).join(' ')}`,
    `태그: ${(recipe.tags || []).join(', ')}`,
    `조리 시간: ${recipe.cook_time || ''}분`,
    `난이도: ${recipe.difficulty || ''}`
  ].join('. ')
}));
const chunks = recipes.flatMap(recipe => {
  const size = 300, overlap = 50;
  const output = [];
  for (let start = 0; start < recipe.text.length; start += size - overlap) output.push({ recipe_name: recipe.name, content: recipe.text.slice(start, start + size), metadata: { source: 'recipes.json', cuisine: recipe.cuisine || [] } });
  return output;
});

const baseHeaders = {
  'content-type': 'application/json',
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
};

// 이전에 적재된 소수 샘플이나 중복 청크가 새 데이터와 섞이지 않도록 초기화합니다.
const clearResponse = await fetch(`${SUPABASE_URL}/rest/v1/recipe_chunks?id=gt.0`, {
  method: 'DELETE',
  headers: { ...baseHeaders, prefer: 'return=minimal' }
});
if (!clearResponse.ok) throw new Error(`Supabase reset failed: ${clearResponse.status} ${await clearResponse.text()}`);

const batchSize = 100;
for (let start = 0; start < chunks.length; start += batchSize) {
  const batch = chunks.slice(start, start + batchSize);
  const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-large', dimensions: 1536, input: batch.map(chunk => chunk.content) })
  });
  if (!embeddingResponse.ok) throw new Error(`Embedding failed: ${embeddingResponse.status}`);
  const embeddings = (await embeddingResponse.json()).data.map(item => item.embedding);
  const rows = batch.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }));
  const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/recipe_chunks`, {
    method: 'POST',
    headers: { ...baseHeaders, prefer: 'return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!insertResponse.ok) throw new Error(`Supabase insert failed: ${insertResponse.status} ${await insertResponse.text()}`);
  console.log(`인덱싱 진행: ${Math.min(start + batch.length, chunks.length)}/${chunks.length}`);
}
console.log(`인덱싱 완료: ${recipes.length}개 레시피, ${chunks.length}개 청크`);
