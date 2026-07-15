import fs from 'node:fs';

function loadLocalEnv() {
  try {
    const content = fs.readFileSync('.env.local', 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

loadLocalEnv();

// 심판 모델에게 기준과 실제 결과를 전달해 1~5점 JSON으로 채점합니다.
export async function judge(input, criteria, actualResult) {
  if (!process.env.OPENAI_API_KEY) return { score: 0, reason: 'OPENAI_API_KEY가 없어 LLM judge를 실행하지 못했습니다.' };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '레시피 추천 평가자입니다. 반드시 {"score":1~5,"reason":"한국어 근거"} JSON만 반환하세요.' },
        { role: 'user', content: JSON.stringify({ input, criteria, actualResult }, null, 2) }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Judge API failed (${response.status}): ${JSON.stringify(payload)}`);
  const raw = payload.choices?.[0]?.message?.content || '{}';
  const result = JSON.parse(raw);
  const score = Math.max(1, Math.min(5, Number(result.score) || 1));
  return { score, reason: String(result.reason || '근거가 없습니다.') };
}
