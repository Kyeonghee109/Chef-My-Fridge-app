import fs from 'node:fs/promises';
import { recommend } from './service.mjs';
import { judge } from './judge.mjs';
import { deterministicChecks } from './deterministic-checks.mjs';

const goldenSet = JSON.parse(await fs.readFile(new URL('./golden-set.json', import.meta.url), 'utf8'));
const rows = [];

for (const [index, testCase] of goldenSet.entries()) {
  const actualResult = await recommend(testCase.input);
  const checks = deterministicChecks(testCase.input, actualResult);
  const deterministicPass = checks.every(check => check.pass);
  let judged;
  try {
    judged = await judge(testCase.input, testCase.criteria, actualResult);
  } catch (error) {
    judged = { score: 0, reason: error.message };
  }
  const passed = deterministicPass && judged.score >= 4;
  rows.push({ case: index + 1, score: judged.score, passed, elapsedMs: actualResult.elapsedMs, reason: judged.reason, checks });
  console.log(`${passed ? 'PASS' : 'FAIL'}\tcase ${index + 1}\tscore ${judged.score}/5\t${actualResult.elapsedMs}ms\t${judged.reason}`);
  for (const check of checks.filter(check => !check.pass)) console.log(`  - CHECK FAIL: ${check.name} (${check.detail})`);
}

const passedCount = rows.filter(row => row.passed).length;
console.log('\n평가 결과');
console.table(rows.map(({ case: caseNumber, score, passed, elapsedMs }) => ({ case: caseNumber, score, passed: passed ? 'PASS' : 'FAIL', elapsedMs })));
console.log(`전체 통과율: ${passedCount}/${rows.length} (${((passedCount / rows.length) * 100).toFixed(1)}%)`);
