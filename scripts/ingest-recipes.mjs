import fs from 'node:fs/promises';

const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
}

// vector(1536) payload와 HNSW 인덱스 갱신으로 statement timeout이 날 수 있어 기본값을 작게 잡습니다.
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 10);
const GROUP_SIZE = Number(process.env.INGEST_GROUP_SIZE || 5000);
const MAX_RETRIES = 3;
const PAGE_SIZE = 1000;
const recipeDataPath = process.env.RECIPE_DATA_PATH || new URL('../rag-agent/data/recipes.json', import.meta.url);
const rawRecipes = JSON.parse(await fs.readFile(recipeDataPath, 'utf8'));
const formatIngredient = ingredient => {
  if (ingredient && typeof ingredient === 'object') {
    return [ingredient.name, ingredient.amount, ingredient.unit].filter(value => value !== undefined && value !== '').join(' ');
  }
  return String(ingredient ?? '');
};
const recipes = rawRecipes.map(recipe => ({
  id: String(recipe.id || recipe.name || recipe.title),
  name: recipe.name || recipe.title,
  cuisine: Array.isArray(recipe.cuisine) ? recipe.cuisine : [],
  text: recipe.text || [
    recipe.title,
    `음식 종류: ${(recipe.cuisine || []).join(', ')}`,
    `필요 재료: ${(recipe.ingredients || []).map(formatIngredient).join(', ')}`,
    `조리 순서: ${(recipe.steps || []).join(' ')}`,
    `태그: ${(recipe.tags || []).join(', ')}`,
    `조리 시간: ${recipe.cook_time || ''}분`,
    `난이도: ${recipe.difficulty || ''}`
  ].join('. ')
}));

const chunks = recipes.flatMap(recipe => {
  const size = 300;
  const overlap = 50;
  const output = [];
  let chunkIndex = 0;
  for (let start = 0; start < recipe.text.length; start += size - overlap) {
    output.push({
      chunk_key: `${recipe.id}::${chunkIndex}`,
      recipe_name: recipe.name,
      content: recipe.text.slice(start, start + size),
      metadata: {
        source: 'recipes.json',
        recipe_id: recipe.id,
        chunk_index: chunkIndex,
        cuisine: recipe.cuisine
      }
    });
    chunkIndex += 1;
  }
  return output;
});

const baseHeaders = {
  'content-type': 'application/json',
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
};

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestWithRetry(label, request) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      const delay = 1000 * (2 ** (attempt - 1));
      console.warn(`${label} 실패 (${attempt}/${MAX_RETRIES}), ${delay}ms 후 재시도: ${error.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function fetchExistingRows() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await requestWithRetry(`기존 row 조회 ${offset}`, () => fetch(
      `${SUPABASE_URL}/rest/v1/recipe_chunks?select=chunk_key,recipe_name,content&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: baseHeaders }
    ));
    if (!response.ok) throw new Error(`Supabase existing rows failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function createEmbeddings(batch) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'text-embedding-3-large',
      dimensions: 1536,
      input: batch.map(chunk => chunk.content)
    })
  });
  if (!response.ok) throw new Error(`Embedding failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload.data.map(item => item.embedding);
}

async function upsertBatch(batch) {
  const embeddings = await requestWithRetry(`임베딩 ${batch[0].chunk_key}`, () => createEmbeddings(batch));
  const rows = batch.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }));
  const response = await requestWithRetry(`Supabase upsert ${batch[0].chunk_key}`, () => fetch(
    `${SUPABASE_URL}/rest/v1/recipe_chunks?on_conflict=chunk_key`,
    {
      method: 'POST',
      headers: { ...baseHeaders, prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    }
  ));
  if (!response.ok) throw new Error(`Supabase upsert failed: ${response.status} ${await response.text()}`);
}

async function upsertWithSplit(batch) {
  try {
    await upsertBatch(batch);
    return;
  } catch (error) {
    if (batch.length === 1) throw error;
    const middle = Math.ceil(batch.length / 2);
    console.warn(`배치 ${batch.length}개 처리 실패, ${middle}개 + ${batch.length - middle}개로 분할 재처리: ${error.message}`);
    await upsertWithSplit(batch.slice(0, middle));
    await upsertWithSplit(batch.slice(middle));
  }
}

const existingRows = await fetchExistingRows();
const existingKeyContents = new Map(existingRows.filter(row => row.chunk_key).map(row => [row.chunk_key, row.content]));
const existingContents = new Set(existingRows.map(row => `${row.recipe_name}\u0000${row.content}`));
const pendingChunks = chunks.filter(chunk => (
  existingKeyContents.get(chunk.chunk_key) !== chunk.content &&
  !existingContents.has(`${chunk.recipe_name}\u0000${chunk.content}`)
));

console.log(`레시피 ${recipes.length}개, 전체 청크 ${chunks.length}개`);
console.log(`Supabase 기존 row ${existingRows.length}개, 이미 확인된 청크 ${chunks.length - pendingChunks.length}개, 신규/변경 삽입 예정 ${pendingChunks.length}개`);
console.log(`그룹 크기 ${GROUP_SIZE}개, 배치 크기 ${BATCH_SIZE}개, 최대 재시도 ${MAX_RETRIES}회`);

const failures = [];
let completed = chunks.length - pendingChunks.length;
for (let groupStart = 0; groupStart < pendingChunks.length; groupStart += GROUP_SIZE) {
  const group = pendingChunks.slice(groupStart, groupStart + GROUP_SIZE);
  const groupNumber = Math.floor(groupStart / GROUP_SIZE) + 1;
  const groupCount = Math.ceil(pendingChunks.length / GROUP_SIZE);
  const failedBatches = [];
  console.log(`그룹 ${groupNumber}/${groupCount} 시작: ${group.length}개 청크`);

  for (let batchStart = 0; batchStart < group.length; batchStart += BATCH_SIZE) {
    const batch = group.slice(batchStart, batchStart + BATCH_SIZE);
    try {
      await upsertWithSplit(batch);
    } catch (error) {
      failedBatches.push({ batch, error });
      console.error(`그룹 ${groupNumber} 배치 실패: ${batch[0].chunk_key} ~ ${batch.at(-1).chunk_key}`);
      console.error(`실패 원문: ${error.message}`);
    }
    completed += batch.length;
    console.log(`인덱싱 진행: ${completed}/${chunks.length}`);
  }

  // 그룹 안에서 실패한 배치는 그룹을 끝내기 전에 한 번 더 복구 시도합니다.
  if (failedBatches.length) {
    console.warn(`그룹 ${groupNumber} 실패 배치 ${failedBatches.length}개 복구 재시도`);
    for (const failed of failedBatches) {
      try {
        await upsertWithSplit(failed.batch);
        console.log(`복구 성공: ${failed.batch[0].chunk_key} ~ ${failed.batch.at(-1).chunk_key}`);
      } catch (error) {
        failures.push(...failed.batch.map(chunk => ({
          id: chunk.recipe_id,
          chunk_key: chunk.chunk_key,
          title: chunk.recipe_name,
          error: error.message
        })));
        console.error(`복구 실패: ${failed.batch[0].chunk_key} ~ ${failed.batch.at(-1).chunk_key}`);
      }
    }
  }
  console.log(`그룹 ${groupNumber}/${groupCount} 완료: 실패 ${failures.length}개`);
}

const finalRows = await fetchExistingRows();
const finalRecipeNames = new Set(finalRows.map(row => row.recipe_name));
console.log(`최종 검증: Supabase row ${finalRows.length}/${chunks.length}, 레시피 ${finalRecipeNames.size}/${recipes.length}`);
if (failures.length) {
  console.error(`실패한 청크 ${failures.length}개:`);
  for (const failure of failures) console.error(`- ${failure.id} (${failure.title}) [${failure.chunk_key}]`);
  process.exitCode = 1;
} else if (finalRows.length < chunks.length) {
  console.error(`미완료 청크가 있습니다: ${chunks.length - finalRows.length}개`);
  process.exitCode = 1;
} else {
  console.log(`인덱싱 완료: ${recipes.length}개 레시피, ${chunks.length}개 청크`);
}
