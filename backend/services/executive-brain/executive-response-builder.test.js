'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExecutiveResponse } = require('./executive-response-builder');

test('builds a response with evidence', () => {
  const result = buildExecutiveResponse({
    answer: 'Hay evidencia sobre el roadmap.',
    confidence: 0.84,
    sources: [
      { id: 'b', name: 'Roadmap B', score: 7, rankingPosition: 2 },
      { id: 'a', name: 'Roadmap A', score: 8, rankingPosition: 1 },
    ],
    reasoningSummary: {
      queryType: 'Roadmap',
    },
    limitations: ['Simulation only.'],
  });

  assert.equal(result.confidence, 0.84);
  assert.equal(result.sources[0].id, 'a');
  assert.ok(result.executiveSummary.includes('Hay evidencia sobre el roadmap.'));
  assert.ok(result.executiveSummary.includes('Roadmap A'));
  assert.ok(result.keyFindings.some((finding) => finding.includes('Se identificaron 2 fuentes relevantes.')));
  assert.equal(result.recommendation, 'Proceder con base en la evidencia disponible.');
});

test('builds a response without evidence', () => {
  const result = buildExecutiveResponse({
    answer: 'No se encontraron fuentes relevantes.',
    confidence: 0.2,
    sources: [],
    reasoningSummary: {},
    limitations: ['No sufficient evidence was found in the Knowledge Store.'],
  });

  assert.equal(result.confidence, 0.2);
  assert.deepEqual(result.sources, []);
  assert.ok(result.executiveSummary.includes('No se encontraron fuentes relevantes.'));
  assert.ok(result.keyFindings.some((finding) => finding.includes('No hay evidencia suficiente')));
  assert.equal(result.recommendation, 'Recopilar más evidencia antes de decidir.');
});

test('keeps multiple sources ordered by ranking position', () => {
  const result = buildExecutiveResponse({
    answer: 'Respuesta con múltiples fuentes.',
    confidence: 0.63,
    sources: [
      { id: 'c', name: 'Source C', score: 4, rankingPosition: 3 },
      { id: 'a', name: 'Source A', score: 9, rankingPosition: 1 },
      { id: 'b', name: 'Source B', score: 6, rankingPosition: 2 },
    ],
    reasoningSummary: {
      queryType: 'Documentation',
    },
    limitations: [],
  });

  assert.deepEqual(result.sources.map((source) => source.id), ['a', 'b', 'c']);
  assert.ok(result.keyFindings.some((finding) => finding.includes('Se identificaron 3 fuentes relevantes.')));
  assert.equal(result.recommendation, 'Revisar la evidencia disponible y validar manualmente antes de ejecutar.');
});

test('reports high confidence when evidence is strong', () => {
  const result = buildExecutiveResponse({
    answer: 'Respuesta sólida.',
    confidence: 0.91,
    sources: [{ id: 'a', name: 'Source A', score: 10, rankingPosition: 1 }],
    reasoningSummary: {},
    limitations: [],
  });

  assert.equal(result.confidence, 0.91);
  assert.ok(result.executiveSummary.includes('Confianza alta.'));
  assert.equal(result.recommendation, 'Proceder con base en la evidencia disponible.');
});

test('reports low confidence when evidence is weak', () => {
  const result = buildExecutiveResponse({
    answer: 'Evidencia débil.',
    confidence: 0.28,
    sources: [],
    reasoningSummary: {},
    limitations: ['No sufficient evidence was found in the Knowledge Store.'],
  });

  assert.equal(result.confidence, 0.28);
  assert.ok(result.executiveSummary.includes('Confianza baja.'));
  assert.equal(result.recommendation, 'Recopilar más evidencia antes de decidir.');
});
