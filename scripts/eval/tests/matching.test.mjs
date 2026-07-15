import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { calculateMatchScore, calculateMissingIngredients, filterByCuisine } = require('../../../api/retrieval.js');

test('재료가 절반 겹치면 세 가지 점수를 계산한다', () => {
  const score = calculateMatchScore(['계란', '양파', '감자', '당근'], ['계란', '양파', '소금', '식용유']);
  assert.equal(score.matchCount, 2);
  assert.equal(score.matchRatio, 0.5);
  assert.equal(score.coverageRatio, 0.5);
  assert.equal(score.finalScore, 1.25);
});

test('재료가 하나도 겹치지 않으면 점수는 0이다', () => {
  const score = calculateMatchScore(['연어'], ['두부', '양파']);
  assert.equal(score.matchCount, 0);
  assert.equal(score.finalScore, 0);
});

test('재료가 전부 겹치면 모든 비율이 1이다', () => {
  const score = calculateMatchScore(['계란', '양파'], ['계란', '양파']);
  assert.equal(score.matchCount, 2);
  assert.equal(score.matchRatio, 1);
  assert.equal(score.coverageRatio, 1);
  assert.equal(score.finalScore, 1.5);
});

test('빈 배열 경계값을 처리한다', () => {
  assert.deepEqual(calculateMatchScore([], []), {
    matchCount: 0, matchRatio: 0, coverageRatio: 0, finalScore: 0,
    matchedIngredients: [], missingIngredients: []
  });
  assert.deepEqual(calculateMissingIngredients([], ['계란']), ['계란']);
  assert.deepEqual(calculateMissingIngredients(['계란'], []), []);
});

test('null/undefined 입력은 TypeError를 던진다', () => {
  assert.throws(() => calculateMatchScore(null, []), TypeError);
  assert.throws(() => calculateMissingIngredients([], undefined), TypeError);
  assert.throws(() => filterByCuisine([], null), TypeError);
});

test('cuisine을 선택하지 않으면 전체를 반환한다', () => {
  const recipes = [{ cuisine: ['한식'] }, { cuisine: ['양식'] }];
  assert.deepEqual(filterByCuisine(recipes, []), recipes);
});

test('cuisine이 하나도 겹치지 않으면 빈 배열을 반환한다', () => {
  const recipes = [{ cuisine: ['한식'] }, { cuisine: ['양식'] }];
  assert.deepEqual(filterByCuisine(recipes, ['일식']), []);
});

test('연어·떡·어묵 동의어를 같은 재료로 계산한다', () => {
  const score = calculateMatchScore(['연어', '떡', '어묵'], ['훈제연어 100g', '가래떡 2줄', '오뎅 3개']);
  assert.equal(score.matchCount, 3);
});
