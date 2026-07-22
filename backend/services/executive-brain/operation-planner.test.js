'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_STEPS, planOperations } = require('./operation-planner');

test('builds empty, Business and Knowledge plans', () => {
  assert.deepEqual(planOperations({ query: 'Hola', analysis: {} }).steps, []);
  assert.deepEqual(planOperations({ query: 'Analiza empresas y oportunidades', analysis: {} }).steps, ['business-analysis-readonly']);
  assert.deepEqual(planOperations({ query: 'Revisa la biblioteca', analysis: {} }).steps, ['knowledge-review-readonly']);
});

test('builds the real ordered mixed example without executing either step', () => {
  const plan = planOperations({
    query: 'Quiero encontrar empresas y después revisar qué sabemos sobre ellas',
    analysis: { intent: 'unknown' },
  });
  assert.deepEqual(plan.steps, ['business-analysis-readonly', 'knowledge-review-readonly']);
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.steps), true);
});

test('deduplicates, limits and rejects arbitrary planner input', () => {
  let index = 0;
  const decisions = ['business-analysis-readonly', 'knowledge-review-readonly', 'business-analysis-readonly', 'evil'];
  const plan = planOperations({ query: 'uno y dos y tres y cuatro', analysis: {} }, {
    recommendSupervisedOperation: () => ({ decision: decisions[index++] }),
  });
  assert.equal(MAX_STEPS, 3);
  assert.deepEqual(plan.steps, ['business-analysis-readonly', 'knowledge-review-readonly']);
  assert.deepEqual(planOperations({ query: 'empresas', analysis: {}, worker: 'evil' }).steps, []);
  assert.deepEqual(planOperations({ query: 'biblioteca', analysis: {}, type: 'evil' }).steps, []);
});

test('is pure and has no operation or persistence dependencies', () => {
  const input = Object.freeze({ query: 'Mercado', analysis: Object.freeze({ intent: 'unknown' }) });
  assert.deepEqual(planOperations(input), planOperations(input));
  assert.deepEqual(input, { query: 'Mercado', analysis: { intent: 'unknown' } });
});
