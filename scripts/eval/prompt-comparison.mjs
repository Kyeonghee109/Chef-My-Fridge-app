import quality from '../../api/recommendation-quality.js';

const { calculateRecommendationScores } = quality;
const endpoint = process.env.PROMPT_COMPARISON_URL || 'http://localhost:3002/api/agent';
const request = {
  ingredients: ['밥', '계란', '간장'],
  cuisines: ['한식'],
  filters: {
    time: '10분 이내',
    difficulty: '',
    diet: ''
  },
  exclude: []
};
const scoreOrder = ['overall_quality', 'cuisine_match', 'menu_count_valid', 'filter_match', 'output_valid'];

function toScoreMap(scores) {
  return Object.fromEntries(scores.map(score => [score.name, score.value]));
}

function formatScore(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : 'N/A';
}

async function runVersion(promptVersion) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...request, promptVersion })
  });
  const payload = await response.json().catch(() => ({}));
  const scores = calculateRecommendationScores({
    success: response.ok,
    responseBody: response.ok ? payload : { menus: [] },
    cuisines: request.cuisines,
    filters: request.filters
  });
  return { promptVersion, status: response.status, payload, scores: toScoreMap(scores) };
}

function printVersion(result) {
  console.log(`\n${result.promptVersion === 'baseline' ? 'Baseline' : 'Improved'} (HTTP ${result.status})`);
  scoreOrder.forEach(name => console.log(`- ${name}: ${formatScore(result.scores[name])}`));
}

function printDifference(baseline, improved) {
  console.log('\nDifference (improved - baseline)');
  scoreOrder.forEach(name => {
    const difference = (improved.scores[name] ?? 0) - (baseline.scores[name] ?? 0);
    console.log(`- ${name}: ${difference >= 0 ? '+' : ''}${formatScore(difference)}`);
  });
}

try {
  const baseline = await runVersion('baseline');
  const improved = await runVersion('improved');
  printVersion(baseline);
  printVersion(improved);
  printDifference(baseline, improved);
} catch (error) {
  console.error(`Prompt comparison failed: ${error.message}`);
  console.error(`Start the local API first, e.g. set -a && source .env.local && set +a && vercel dev --listen 3002`);
  process.exitCode = 1;
}
