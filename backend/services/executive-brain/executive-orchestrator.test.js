'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { orchestrateExecutiveQuery } = require('./executive-orchestrator');

function buildPrivateContext(overrides = {}) {
  return {
    clientId: 'client-alpha',
    userId: 'user-alpha',
    scope: 'private:user',
    sensitivity: 'confidential',
    sourceType: 'agenda-ficticia',
    sourceId: 'agenda-source-alpha',
    authorization: { status: 'granted' },
    purpose: 'executive-context',
    retentionPolicy: 'CLIENT_CONTROLLED',
    promotionPolicy: 'NEVER_PROMOTE',
    ...overrides,
  };
}

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
  assert.equal(result.privateContextUsed, false);
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
  assert.equal(result.privateContextUsed, false);
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
  assert.ok(Object.hasOwn(result, 'privateContextUsed'));
  assert.equal(result.privateContextUsed, false);
});

test('uses authorized private context without adding it to global sources', () => {
  const privatePayload = {
    events: [
      { title: 'Reunion ficticia critica', date: '2026-07-04' },
      { title: 'Renovacion ficticia', date: '2026-07-05' },
    ],
  };
  const originalPayload = structuredClone(privatePayload);
  let builderInput = null;
  let knowledgeSearchCalled = false;

  const result = orchestrateExecutiveQuery('Prepara mi briefing de hoy', {
    privateContextMetadata: buildPrivateContext(),
    expectedClientId: 'client-alpha',
    privatePayload,
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'briefing',
          project: null,
          documentTypes: [],
          keywords: ['briefing'],
          filters: {},
          priority: 'high',
          confidence: 0.9,
        };
      },
      searchKnowledge() {
        knowledgeSearchCalled = true;
        return { found: true };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Prepara mi briefing de hoy',
          answer: 'Respuesta ejecutiva base.',
          confidence: 0.7,
          sources: [
            {
              id: 'global-1',
              name: 'governance.md',
              path: 'C:\\private\\fixtures\\governance.md',
              token: 'secret-token',
              credentials: 'secret-credentials',
              metadata: { internal: true },
              type: 'Governance',
              score: 5,
            },
          ],
          reasoningSummary: {},
          limitations: ['Simulation only.'],
        };
      },
      buildExecutiveResponse(input) {
        builderInput = input;

        return {
          executiveSummary: input.answer,
          keyFindings: [input.answer],
          recommendation: 'Revisar contexto autorizado.',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(knowledgeSearchCalled, false);
  assert.equal(result.privateContextUsed, true);
  assert.match(result.response, /Contexto privado autorizado considerado: 2 elemento\(s\)\./);
  assert.doesNotMatch(result.response, /Reunion ficticia critica/);
  assert.doesNotMatch(result.response, /Renovacion ficticia/);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, 'global-1');
  assert.equal(Object.hasOwn(result.sources[0], 'path'), false);
  assert.equal(Object.hasOwn(result.sources[0], 'token'), false);
  assert.equal(Object.hasOwn(result.sources[0], 'credentials'), false);
  assert.equal(Object.hasOwn(result.sources[0], 'metadata'), false);
  assert.equal(JSON.stringify(result.sources).includes('agenda-source-alpha'), false);
  assert.equal(JSON.stringify(result).includes(JSON.stringify(privatePayload)), false);
  assert.deepEqual(privatePayload, originalPayload);
  assert.ok(builderInput.answer.startsWith('Respuesta ejecutiva base.'));
  assert.ok(builderInput.answer.includes('Contexto privado autorizado'));
});

test('uses authorized Calendar context to answer daily agenda queries', () => {
  const result = orchestrateExecutiveQuery('Que tengo hoy?', {
    privateContextMetadata: buildPrivateContext({
      sourceType: 'calendar',
      sourceId: 'calendar-source-alpha',
      purpose: 'executive-briefing',
    }),
    expectedClientId: 'client-alpha',
    privateContextRequiredPurpose: 'executive-briefing',
    privatePayload: {
      source: 'calendar',
      range: {
        preset: 'today',
        timeMin: '2026-07-03T00:00:00.000Z',
        timeMax: '2026-07-04T00:00:00.000Z',
        maxResults: 10,
      },
      events: [
        {
          id: 'event-1',
          title: 'Reunion ficticia de seguimiento',
          start: '2026-07-03T10:00:00.000Z',
          end: '2026-07-03T10:30:00.000Z',
        },
      ],
    },
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'briefing',
          project: null,
          documentTypes: [],
          keywords: ['agenda'],
          filters: {},
          priority: 'high',
          confidence: 0.9,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Que tengo hoy?',
          answer: 'Respuesta ejecutiva base.',
          confidence: 0.7,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
      buildExecutiveResponse(input) {
        return {
          executiveSummary: input.answer,
          keyFindings: [],
          recommendation: '',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(result.privateContextUsed, true);
  assert.match(
    result.response,
    /Agenda privada autorizada: tienes 1 evento hoy: Reunion ficticia de seguimiento a las 10:00\./,
  );
  assert.doesNotMatch(result.response, /Respuesta ejecutiva base/);
  assert.deepEqual(result.sources, []);
  assert.equal(JSON.stringify(result).includes('event-1'), false);
});

test('prioritizes authorized Calendar agenda over noisy Knowledge Store response', () => {
  let builderInput = null;
  const result = orchestrateExecutiveQuery('Que tengo hoy?', {
    privateContextMetadata: buildPrivateContext({
      sourceType: 'calendar',
      sourceId: 'calendar-source-alpha',
      purpose: 'executive-briefing',
    }),
    expectedClientId: 'client-alpha',
    privateContextRequiredPurpose: 'executive-briefing',
    privatePayload: {
      source: 'calendar',
      events: [
        {
          id: 'event-1',
          title: 'Prueba Calendar Oxkio',
          start: '2026-07-04T12:15:00+02:00',
        },
      ],
    },
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'unknown',
          project: null,
          documentTypes: [],
          keywords: ['hoy'],
          filters: {},
          priority: 'normal',
          confidence: 0.45,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Que tengo hoy?',
          answer: 'No se encontraron Knowledge Objects relevantes para "Que tengo hoy?" en el Knowledge Store.',
          confidence: 0.2,
          sources: [
            {
              id: 'global-noise',
              name: 'knowledge-noise.md',
              path: 'C:\\private\\knowledge-noise.md',
              type: 'Notes',
            },
          ],
          reasoningSummary: {},
          limitations: [
            'No sufficient evidence was found in the Knowledge Store.',
            'Simulation only: this is not the definitive Executive Brain.',
            'No AI is used.',
            'Only persisted Knowledge Objects are read.',
            'Answers are based on deterministic keyword and metadata matching.',
          ],
        };
      },
      buildExecutiveResponse(input) {
        builderInput = input;

        return {
          executiveSummary: `${input.answer} ${input.confidence >= 0.5 ? 'Confianza media.' : 'Confianza baja.'}`,
          keyFindings: [],
          recommendation: '',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(result.privateContextUsed, true);
  assert.equal(result.response, 'Agenda privada autorizada: tienes 1 evento hoy: Prueba Calendar Oxkio a las 12:15. Confianza media.');
  assert.doesNotMatch(result.response, /No se encontraron Knowledge Objects/);
  assert.doesNotMatch(result.response, /Knowledge Store/);
  assert.doesNotMatch(result.response, /Confianza baja/);
  assert.equal(builderInput.confidence, 0.7);
  assert.equal(result.confidence, 0.7);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.limitations, []);
  assert.deepEqual(builderInput.sources, []);
  assert.deepEqual(builderInput.limitations, []);
  assert.equal(JSON.stringify(result).includes('event-1'), false);
});

test('formats multiple Calendar events for executive agenda without adding sources', () => {
  const result = orchestrateExecutiveQuery('Que tengo hoy?', {
    privateContextMetadata: buildPrivateContext({
      sourceType: 'calendar',
      sourceId: 'calendar-source-alpha',
      purpose: 'executive-briefing',
    }),
    expectedClientId: 'client-alpha',
    privateContextRequiredPurpose: 'executive-briefing',
    privatePayload: {
      source: 'calendar',
      events: [
        {
          id: 'event-1',
          title: 'Evento A',
          start: '2026-07-04T10:00:00+02:00',
        },
        {
          id: 'event-2',
          title: 'Evento B',
          start: '2026-07-04T12:15:00+02:00',
        },
        {
          id: 'event-3',
          title: 'Evento C',
          start: '2026-07-04T15:30:00+02:00',
        },
        {
          id: 'event-4',
          title: 'Evento D',
          start: '2026-07-04T18:45:00+02:00',
        },
      ],
    },
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'briefing',
          project: null,
          documentTypes: [],
          keywords: ['agenda'],
          filters: {},
          priority: 'high',
          confidence: 0.9,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Que tengo hoy?',
          answer: 'Respuesta ejecutiva base.',
          confidence: 0.7,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
      buildExecutiveResponse(input) {
        return {
          executiveSummary: input.answer,
          keyFindings: [],
          recommendation: '',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(result.privateContextUsed, true);
  assert.match(
    result.response,
    /Agenda privada autorizada: tienes 4 eventos hoy: Evento A a las 10:00; Evento B a las 12:15; Evento C a las 15:30 y 1 evento\(s\) mas\./,
  );
  assert.doesNotMatch(result.response, /Evento D/);
  assert.deepEqual(result.sources, []);
  assert.equal(JSON.stringify(result).includes('event-1'), false);
});

test('does not expose private payload counts for critical sensitivity', () => {
  const result = orchestrateExecutiveQuery('Prepara briefing critico', {
    privateContextMetadata: buildPrivateContext({ sensitivity: 'critical' }),
    expectedClientId: 'client-alpha',
    privatePayload: {
      items: [
        { secret: 'dato sensible ficticio' },
        { secret: 'otro dato sensible ficticio' },
      ],
    },
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'briefing',
          project: null,
          documentTypes: [],
          keywords: [],
          filters: {},
          priority: 'high',
          confidence: 0.9,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Prepara briefing critico',
          answer: 'Respuesta ejecutiva base.',
          confidence: 0.7,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
      buildExecutiveResponse(input) {
        return {
          executiveSummary: input.answer,
          keyFindings: [],
          recommendation: '',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(result.privateContextUsed, true);
  assert.match(result.response, /Contexto privado autorizado considerado\./);
  assert.doesNotMatch(result.response, /2 elemento/);
  assert.doesNotMatch(result.response, /dato sensible ficticio/);
});

test('rejects private context without authorization', () => {
  assert.throws(
    () => orchestrateExecutiveQuery('Consulta privada', {
      privateContextMetadata: buildPrivateContext({ authorization: { status: 'pending' } }),
      expectedClientId: 'client-alpha',
      privatePayload: { items: [] },
    }),
    /authorization must be granted/,
  );
});

test('rejects incompatible private clientId and prevents client crossing', () => {
  assert.throws(
    () => orchestrateExecutiveQuery('Consulta privada', {
      privateContextMetadata: buildPrivateContext({ clientId: 'client-alpha' }),
      expectedClientId: 'client-beta',
      privatePayload: { projects: [{ name: 'Proyecto ficticio privado' }] },
    }),
    /does not match/,
  );
});

test('requires expectedClientId for private scopes', () => {
  assert.throws(
    () => orchestrateExecutiveQuery('Consulta privada', {
      privateContextMetadata: buildPrivateContext(),
      privatePayload: { items: [] },
    }),
    /expectedClientId is required for private scopes/,
  );
});
