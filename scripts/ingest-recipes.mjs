import fs from 'node:fs/promises';

const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');

const recipes = JSON.parse(await fs.readFile(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const chunks = recipes.flatMap(recipe => {
  const size = 300, overlap = 50;
  const output = [];
  for (let start = 0; start < recipe.text.length; start += size - overlap) output.push({ recipe_name: recipe.name, content: recipe.text.slice(start, start + size), metadata: { source: 'recipes.json', cuisine: recipe.cuisine || [] } });
  return output;
});

const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
  body: JSON.stringify({
    model: 'text-embedding-3-large',
    dimensions: 1536,
    input: chunks.map(chunk => chunk.content)
  })
});
if (!embeddingResponse.ok) throw new Error(`Embedding failed: ${embeddingResponse.status}`);
const embeddings = (await embeddingResponse.json()).data.map(item => item.embedding);
const rows = chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }));

const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/recipe_chunks`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates', apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  body: JSON.stringify(rows)
});
if (!insertResponse.ok) throw new Error(`Supabase insert failed: ${insertResponse.status} ${await insertResponse.text()}`);
console.log(`인덱싱 완료: ${rows.length}개 청크`);
