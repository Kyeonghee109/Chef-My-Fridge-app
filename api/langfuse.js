const { randomUUID } = require('node:crypto');
const { LangfuseClient } = require('@langfuse/client');

const TRACE_TIMEOUT_MS = 1200;

function getConfig() {
  const host = String(process.env.LANGFUSE_HOST || '').replace(/\/$/, '');
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!host || !publicKey || !secretKey) return null;
  return { host, publicKey, secretKey };
}

function now() {
  return new Date().toISOString();
}

function envelope(type, body) {
  return {
    id: randomUUID(),
    type,
    timestamp: now(),
    body
  };
}

function startTrace({ input, metadata } = {}) {
  const config = getConfig();
  if (!config) return null;

  const traceId = randomUUID();
  const startedAt = now();
  const traceMetadata = { application: 'chef-my-fridge', ...metadata };
  return {
    config,
    traceId,
    startedAt,
    metadata: traceMetadata,
    events: [envelope('trace-create', {
      id: traceId,
      name: 'recipe-recommendation',
      timestamp: startedAt,
      input,
      metadata: traceMetadata
    })]
  };
}

function recordOpenAIGeneration(trace, { path, body, payload, startedAt, error } = {}) {
  if (!trace) return;

  const isEmbedding = path === 'embeddings';
  const output = error
    ? null
    : isEmbedding
      ? { dimensions: payload?.data?.[0]?.embedding?.length || 0 }
      : payload?.choices?.[0]?.message?.content || null;

  trace.events.push(envelope('generation-create', {
    id: randomUUID(),
    traceId: trace.traceId,
    name: `openai-${isEmbedding ? 'embedding' : 'chat-completion'}`,
    startTime: startedAt,
    endTime: now(),
    model: body?.model || null,
    input: isEmbedding ? { input: body?.input } : body,
    output,
    usage: payload?.usage || null,
    metadata: {
      application: 'chef-my-fridge',
      openai_path: path,
      ...(error ? { status: 'error', status_message: String(error.message || 'OpenAI request failed') } : {})
    },
    ...(error ? { level: 'ERROR', statusMessage: String(error.message || 'OpenAI request failed') } : {})
  }));
}

function finishTrace(trace, { output, error } = {}) {
  if (!trace) return;
  trace.events.push(envelope('trace-create', {
    id: trace.traceId,
    name: 'recipe-recommendation',
    output: error ? null : output,
    metadata: error
      ? { ...trace.metadata, status: 'error', status_message: String(error.message || 'Request failed') }
      : { ...trace.metadata, status: 'success' }
  }));
}

async function flushTrace(trace) {
  if (!trace || !trace.events.length) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);
  try {
    const auth = Buffer.from(`${trace.config.publicKey}:${trace.config.secretKey}`).toString('base64');
    const response = await fetch(`${trace.config.host}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ batch: trace.events }),
      signal: controller.signal
    });

    if (!response.ok && response.status !== 207) {
      console.warn('Langfuse trace upload failed', { status: response.status });
    }
  } catch (error) {
    // Observability 장애가 추천 요청의 성공/실패에 영향을 주지 않도록 삼킵니다.
    console.warn('Langfuse trace upload skipped', { reason: error.name === 'AbortError' ? 'timeout' : 'network_error' });
  } finally {
    clearTimeout(timeout);
  }
}

async function recordScores(trace, scores) {
  if (!trace?.traceId || !trace?.config || !Array.isArray(scores) || !scores.length) return;

  try {
    // @langfuse/client v5의 공식 ScoreManager를 사용합니다. LANGFUSE_HOST는
    // SDK의 baseUrl 옵션에 명시적으로 매핑해 브라우저에 비밀키가 노출되지 않습니다.
    const client = new LangfuseClient({
      publicKey: trace.config.publicKey,
      secretKey: trace.config.secretKey,
      baseUrl: trace.config.host,
      timeout: 1
    });
    scores.forEach(score => {
      client.score.create({
        id: `${trace.traceId}-${score.name}`,
        traceId: trace.traceId,
        name: score.name,
        value: score.value,
        dataType: 'NUMERIC',
        comment: score.comment
      });
    });
    // Vercel 함수 종료 전에 큐에 쌓인 점수를 전송합니다.
    await client.flush();
  } catch (error) {
    // 점수 전송 실패는 관측성 문제일 뿐 추천 API의 성공 여부를 바꾸지 않습니다.
    console.error('Langfuse score upload failed', {
      score_names: scores.map(score => score.name),
      reason: error?.message || 'unknown_error'
    });
  }
}

module.exports = { startTrace, recordOpenAIGeneration, finishTrace, flushTrace, recordScores };
