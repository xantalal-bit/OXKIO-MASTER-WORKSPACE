'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GENERIC_QUESTION, interpretRequest } = require('./mission-blueprints');
const { handleMissionRequest } = require('./mission-chat');
const { createMissionEngine } = require('./mission-engine');

const engine = () => createMissionEngine({ now: () => '2026-10-03T10:00:00.000Z' });

test('interpretation: known requests map to blueprints, missing context becomes one question', () => {
  assert.equal(interpretRequest('Analiza una empresa y prepara una propuesta comercial.').blueprintId, 'COMPANY_PROPOSAL');
  assert.equal(interpretRequest('Analiza este repositorio, encuentra el fallo y repáralo').blueprintId, 'REPOSITORY_REPAIR');
  const missing = interpretRequest('Analiza una empresa y prepara una propuesta comercial.');
  assert.equal(missing.question, '¿Qué empresa quieres que analice?');
  assert.equal(interpretRequest('Analiza una empresa y prepara una propuesta', { company: 'ACME' }).question, null);
  assert.equal(interpretRequest('hola').question, GENERIC_QUESTION);
});

test('chat: an unclear request returns a single concrete question and nothing else', async () => {
  const answer = await handleMissionRequest(engine(), 'haz algo');
  assert.deepEqual(answer, { kind: 'QUESTION', question: GENERIC_QUESTION, executionEnabled: false });
});

test('chat: missing information asks exactly one question, without internal machinery', async () => {
  const answer = await handleMissionRequest(engine(), 'Analiza una empresa y prepara una propuesta comercial.');
  assert.equal(answer.kind, 'QUESTION');
  assert.equal(answer.question, '¿Qué empresa quieres que analice?');
  assert.equal(answer.details, undefined);
  assert.equal(answer.state, undefined);
});

test('chat: blocked missions explain why in plain words; details only on request', async () => {
  const plain = await handleMissionRequest(engine(), 'Analiza este repositorio y arregla el fallo', { context: { repository: 'oxkio' } });
  assert.equal(plain.kind, 'BLOCKED');
  assert.ok(!/agent|coordinator|capability/i.test(plain.message));
  assert.equal(plain.details, undefined);
  const detailed = await handleMissionRequest(engine(), 'Analiza este repositorio y arregla el fallo', {
    context: { repository: 'oxkio' }, includeDetails: true,
  });
  assert.equal(detailed.details.tasks.length, 3);
  assert.ok(detailed.details.tasks.every((task) => task.reason === 'agent_not_implemented'));
});
