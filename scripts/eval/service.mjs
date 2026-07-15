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

const API_URL = process.env.EVAL_API_URL || 'https://chef-my-fridge-app.vercel.app/api/agent';

// 실제 배포된 추천 API를 호출해 평가 대상 결과를 표준 형태로 감쌉니다.
export async function recommend({ ingredients = [], cuisines = [], filters = {}, exclude = [] }) {
  const startedAt = Date.now();
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ingredients, cuisines, filters, exclude })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ...payload,
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAt,
      menus: Array.isArray(payload.menus) ? payload.menus : []
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      menus: [],
      error: error.message
    };
  }
}

export { API_URL };
