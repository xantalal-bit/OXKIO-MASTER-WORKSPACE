'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendSupervisedOperation } = require('./supervised-decision-engine');

test('recommends only the two closed readonly operations', () => {
  const business = recommendSupervisedOperation({ query: 'Analiza empresas y oportunidades de mercado', analysis: {} });
  const knowledge = recommendSupervisedOperation({ query: 'Revisa el estado del conocimiento y sus temas', analysis: {} });
  assert.equal(business.decision, 'business-analysis-readonly');
  assert.equal(knowledge.decision, 'knowledge-review-readonly');
  assert.equal(business.confidence, 'high');
  assert.equal(knowledge.confidence, 'high');
});

test('fails to none for ambiguity, greetings, private services and general requests', () => {
  const queries = [
    'Analiza empresas y la documentación disponible',
    'Hola',
    '¿Qué tengo hoy en Gmail y Calendar?',
    'Explícame una cuestión general',
    'Dame información general sobre este asunto',
  ];
  queries.forEach((query) => assert.equal(recommendSupervisedOperation({ query, analysis: {} }).decision, 'none'));
});

test('is deterministic, closed, immutable and always requires confirmation', () => {
  const input = { query: 'Revisa la biblioteca', analysis: { intent: 'documentation' } };
  const first = recommendSupervisedOperation(input);
  const second = recommendSupervisedOperation(input);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(['high', 'medium', 'low'].includes(first.confidence), true);
  assert.equal(first.requiresConfirmation, true);
  assert.equal(first.reason.length <= 160, true);
  assert.equal(recommendSupervisedOperation({ ...input, worker: 'evil' }).decision, 'none');
  assert.equal(recommendSupervisedOperation({ ...input, type: 'evil' }).decision, 'none');
});

test('uses an existing analysis without calling coordinators or mutating input', () => {
  const input = Object.freeze({ query: 'Business Hunter', analysis: Object.freeze({ project: 'Business Hunter' }) });
  assert.equal(recommendSupervisedOperation(input).decision, 'business-analysis-readonly');
  assert.deepEqual(input, { query: 'Business Hunter', analysis: { project: 'Business Hunter' } });
});
