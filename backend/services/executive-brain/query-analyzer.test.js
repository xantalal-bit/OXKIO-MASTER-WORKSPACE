'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeExecutiveQuery } = require('./query-analyzer');

test('analyzes Learning Heroes learning queries', () => {
  const result = analyzeExecutiveQuery('Que sabemos de Learning Heroes y sus cursos?');

  assert.equal(result.intent, 'learning');
  assert.equal(result.project, 'Learning Heroes');
  assert.deepEqual(result.documentTypes, ['Learning']);
  assert.equal(result.priority, 'medium');
  assert.ok(result.confidence > 0.7);
});

test('analyzes Governance queries', () => {
  const result = analyzeExecutiveQuery('Cuales son las reglas de governance de XANTALAL?');

  assert.equal(result.intent, 'governance');
  assert.equal(result.project, 'XANTALAL');
  assert.ok(result.documentTypes.includes('Governance'));
  assert.equal(result.priority, 'high');
});

test('analyzes Roadmap queries', () => {
  const result = analyzeExecutiveQuery('Resumen del roadmap de Oxkio');

  assert.equal(result.intent, 'roadmap');
  assert.equal(result.project, 'Oxkio');
  assert.deepEqual(result.documentTypes, ['Roadmap']);
});

test('detects Business Hunter project', () => {
  const result = analyzeExecutiveQuery('Estado de tareas pendientes de Business Hunter');

  assert.equal(result.intent, 'tasks');
  assert.equal(result.project, 'Business Hunter');
  assert.ok(result.documentTypes.includes('Roadmap'));
  assert.equal(result.priority, 'high');
});

test('detects Profesor IA project', () => {
  const result = analyzeExecutiveQuery('Documentacion de Profesor IA');

  assert.equal(result.intent, 'documentation');
  assert.equal(result.project, 'Profesor IA');
  assert.deepEqual(result.documentTypes, ['Documentation']);
});

test('detects Oxkio project', () => {
  const result = analyzeExecutiveQuery('Decisiones pendientes de Oxkio');

  assert.equal(result.intent, 'tasks');
  assert.equal(result.project, 'Oxkio');
  assert.ok(result.documentTypes.includes('Governance'));
});

test('analyzes decisions queries', () => {
  const result = analyzeExecutiveQuery('Que decisiones tenemos aprobadas?');

  assert.equal(result.intent, 'decisions');
  assert.equal(result.project, null);
  assert.ok(result.documentTypes.includes('Governance'));
  assert.equal(result.priority, 'high');
});

test('returns unknown intent with normal priority for unclear queries', () => {
  const result = analyzeExecutiveQuery('hola mundo sin contexto');

  assert.equal(result.intent, 'unknown');
  assert.equal(result.project, null);
  assert.deepEqual(result.documentTypes, []);
  assert.equal(result.priority, 'normal');
  assert.ok(result.confidence < 0.6);
});

test('returns required output shape', () => {
  const result = analyzeExecutiveQuery('Roadmap de Learning Heroes');

  assert.ok(Object.hasOwn(result, 'intent'));
  assert.ok(Object.hasOwn(result, 'project'));
  assert.ok(Object.hasOwn(result, 'documentTypes'));
  assert.ok(Object.hasOwn(result, 'keywords'));
  assert.ok(Object.hasOwn(result, 'filters'));
  assert.ok(Object.hasOwn(result, 'priority'));
  assert.ok(Object.hasOwn(result, 'confidence'));
});
