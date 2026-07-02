'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { orchestrateExecutiveQuery } = require('./executive-orchestrator');

test('orchestrates analyzer, knowledge query service, and simulation for project queries', () => {
  const calls = {
    analyzer: 0,
    knowledgeSearch: 0,
    simulation: 0,
    builder: 0,
  };

  const result = orchestrateExecutiveQuery('Resumen del roadmap de Oxkio', {
    dependencies: {
      analyzeExecutiveQuery(query) {
        calls.analyzer += 1;
        assert.equal(query, 'Resumen del roadmap de Oxkio');

        return {
          intent: 'roadmap',
          project: 'Oxkio',
          documentTypes: ['Roadmap'],
          keywords: ['resumen'],
          filters: {
            project: 'Oxkio',
            documentTypes: ['Roadmap'],
            intent: 'roadmap',
          },
          priority: 'medium',
          confidence: 0.8,
        };
      },
      searchKnowledge(project) {
        calls.knowledgeSearch += 1;
        assert.equal(project, 'Oxkio');

        return {
          found: true,
          asset: { name: 'Oxkio' },
          pipeline: null,
        };
      },
      simulateExecutiveBrainQuery(query) {
        calls.simulation += 1;
        assert.ok(query.includes('Oxkio'));
        assert.ok(query.includes('roadmap'));

        return {
          query,
          answer: 'Respuesta simulada de roadmap.',
          confidence: 0.72,
          sources: [
            {
              id: 'ko-1',
              name: 'roadmap.md',
              path: 'fixtures/roadmap.md',
              type: 'Roadmap',
              score: 8,
              reasons: ['documentTypeClassification matched Roadmap'],
            },
          ],
          reasoningSummary: {},
          limitations: ['Simulation only.'],
        };
      },
      buildExecutiveResponse(input) {
        calls.builder += 1;
        assert.equal(input.answer, 'Respuesta simulada de roadmap.');
        assert.equal(input.confidence, 0.72);
        assert.equal(input.sources.length, 1);

        return {
          executiveSummary: 'Resumen ejecutivo de roadmap.',
          keyFindings: ['Resumen ejecutivo de roadmap.'],
          recommendation: 'Proceder con base en la evidencia disponible.',
          confidence: 0.72,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(calls.analyzer, 1);
  assert.equal(calls.knowledgeSearch, 1);
  assert.equal(calls.simulation, 1);
  assert.equal(calls.builder, 1);
  assert.equal(result.query, 'Resumen del roadmap de Oxkio');
  assert.equal(result.analysis.intent, 'roadmap');
  assert.equal(result.response, 'Resumen ejecutivo de roadmap.');
  assert.equal(result.confidence, 0.72);
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.limitations, ['Simulation only.']);
});

test('does not call Knowledge Query Service when analyzer finds no project', () => {
  let knowledgeSearchCalled = false;

  const result = orchestrateExecutiveQuery('Que decisiones tenemos aprobadas?', {
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'decisions',
          project: null,
          documentTypes: ['Governance', 'Meeting', 'Notes'],
          keywords: ['aprobadas'],
          filters: {
            project: null,
            documentTypes: ['Governance', 'Meeting', 'Notes'],
            intent: 'decisions',
          },
          priority: 'high',
          confidence: 0.7,
        };
      },
      searchKnowledge() {
        knowledgeSearchCalled = true;
        return { found: true };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Que decisiones tenemos aprobadas?',
          answer: 'Respuesta simulada de decisiones.',
          confidence: 0.66,
          sources: [],
          reasoningSummary: {},
          limitations: ['No sufficient evidence was found in the Knowledge Store.'],
        };
      },
      buildExecutiveResponse(input) {
        return {
          executiveSummary: 'Resumen ejecutivo de decisiones.',
          keyFindings: ['Resumen ejecutivo de decisiones.'],
          recommendation: 'Revisar la evidencia disponible y validar manualmente antes de ejecutar.',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(knowledgeSearchCalled, false);
  assert.equal(result.analysis.intent, 'decisions');
  assert.equal(result.response, 'Resumen ejecutivo de decisiones.');
  assert.equal(result.confidence, 0.66);
  assert.deepEqual(result.sources, []);
  assert.ok(result.limitations[0].includes('No sufficient evidence'));
});

test('returns the required orchestrator response shape with default components', () => {
  const result = orchestrateExecutiveQuery('documentacion tecnica sin proyecto concreto', {
    dependencies: {
      searchKnowledge() {
        throw new Error('Knowledge Query Service should not be called without project.');
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'documentacion tecnica sin proyecto concreto',
          answer: 'Respuesta simulada de documentacion.',
          confidence: 0.5,
          sources: [],
          reasoningSummary: {},
          limitations: ['Simulation only.'],
        };
      },
      buildExecutiveResponse(input) {
        return {
          executiveSummary: 'Resumen ejecutivo de documentacion.',
          keyFindings: ['Resumen ejecutivo de documentacion.'],
          recommendation: 'Revisar la evidencia disponible y validar manualmente antes de ejecutar.',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.ok(Object.hasOwn(result, 'query'));
  assert.ok(Object.hasOwn(result, 'analysis'));
  assert.ok(Object.hasOwn(result, 'response'));
  assert.ok(Object.hasOwn(result, 'confidence'));
  assert.ok(Object.hasOwn(result, 'sources'));
  assert.ok(Object.hasOwn(result, 'limitations'));
});
