'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  orchestrateExecutiveQuery,
  prepareAuthorizedPrivateContexts,
} = require('./executive-orchestrator');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function buildPrivateContextCollection(overrides = {}) {
  const calendar = overrides.calendar || {};
  const gmail = overrides.gmail || {};

  return [
    {
      privateContextMetadata: buildPrivateContext({
        sourceType: 'calendar',
        sourceId: 'calendar-source-alpha',
        purpose: 'executive-briefing',
        ...calendar.metadata,
      }),
      expectedClientId: Object.hasOwn(calendar, 'expectedClientId') ? calendar.expectedClientId : 'client-alpha',
      privatePayload: calendar.privatePayload || { events: [] },
    },
    {
      privateContextMetadata: buildPrivateContext({
        sourceType: 'gmail',
        sourceId: 'gmail-source-alpha',
        purpose: 'executive-briefing',
        ...gmail.metadata,
      }),
      expectedClientId: Object.hasOwn(gmail, 'expectedClientId') ? gmail.expectedClientId : 'client-alpha',
      privatePayload: gmail.privatePayload || { messages: [] },
    },
  ];
}

function assertPrivateContextIdentityMismatch(fn) {
  assert.throws(
    fn,
    (error) => error && error.code === 'private_context_identity_mismatch',
  );
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

test('reads shared memory without invoking proposal or approval dependencies or changing the response contract', () => {
  const calls = [];
  const diagnostics = {};
  const runtimeDependencies = {
    memory: {
      searchMemory(query) {
        calls.push(['memory.searchMemory', query]);
        return [
          { data: 'contenido sensible que no debe salir' },
          { data: 'otro contenido privado' },
        ];
      },
      saveShortTerm() {
        throw new Error('memory must remain read-only');
      },
    },
    proposalEngine: {
      generate() {
        throw new Error('proposal engine must not be invoked');
      },
    },
    approvalQueue: {
      add() {
        throw new Error('approval queue must not be invoked');
      },
    },
  };
  const componentDependencies = {
    analyzeExecutiveQuery() {
      calls.push(['analyzeExecutiveQuery']);
      return {
        intent: 'unknown',
        project: null,
        documentTypes: [],
        keywords: [],
        filters: {},
        priority: 'normal',
        confidence: 0.35,
      };
    },
    simulateExecutiveBrainQuery(query) {
      calls.push(['simulateExecutiveBrainQuery']);
      return {
        query,
        answer: 'Respuesta estable.',
        confidence: 0.5,
        sources: [],
        reasoningSummary: {},
        limitations: [],
      };
    },
    buildExecutiveResponse(input) {
      return {
        executiveSummary: input.answer,
        confidence: input.confidence,
        sources: input.sources,
        limitations: input.limitations,
      };
    },
  };
  const withoutRuntimeDependencies = orchestrateExecutiveQuery('Consulta estable', {
    dependencies: componentDependencies,
  });
  const withRuntimeDependencies = orchestrateExecutiveQuery('Consulta estable', {
    diagnostics,
    dependencies: {
      ...componentDependencies,
      ...runtimeDependencies,
    },
  });

  assert.deepEqual(
    { ...withRuntimeDependencies, interactionId: '<interaction-id>' },
    { ...withoutRuntimeDependencies, interactionId: '<interaction-id>' },
  );
  assert.notEqual(withRuntimeDependencies.interactionId, withoutRuntimeDependencies.interactionId);
  assert.deepEqual(calls.slice(-3), [
    ['analyzeExecutiveQuery'],
    ['memory.searchMemory', 'Consulta estable'],
    ['simulateExecutiveBrainQuery'],
  ]);
  assert.deepEqual(diagnostics, {
    memorySearchAttempted: true,
    memorySearchSucceeded: true,
    memoryResultCount: 2,
    proposalAttempted: false,
    proposalSucceeded: false,
    proposalType: null,
    approvalAttempted: false,
    approvalSucceeded: false,
    memoryWriteAttempted: true,
    memoryWriteSucceeded: false,
  });
  assert.equal(JSON.stringify(withRuntimeDependencies).includes('contenido sensible'), false);
  assert.equal(JSON.stringify(withRuntimeDependencies).includes('contenido privado'), false);
  assert.deepEqual(Object.keys(withRuntimeDependencies), [
    'interactionId',
    'query',
    'analysis',
    'response',
    'confidence',
    'sources',
    'privateContextUsed',
    'proposal',
    'approval',
    'limitations',
  ]);
});

test('continues normally when memory search fails', () => {
  const diagnostics = {};
  const result = orchestrateExecutiveQuery('Consulta con memoria no disponible', {
    diagnostics,
    dependencies: {
      memory: {
        searchMemory() {
          throw new Error('memory unavailable');
        },
        saveShortTerm() {
          throw new Error('memory must remain read-only');
        },
      },
      proposalEngine: {
        generate() {
          throw new Error('proposal engine must not be invoked');
        },
      },
      approvalQueue: {
        add() {
          throw new Error('approval queue must not be invoked');
        },
      },
      simulateExecutiveBrainQuery(query) {
        return {
          query,
          answer: 'Respuesta disponible.',
          confidence: 0.5,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
    },
  });

  assert.equal(result.response.includes('Respuesta disponible.'), true);
  assert.match(result.interactionId, UUID_PATTERN);
  assert.deepEqual(diagnostics, {
    memorySearchAttempted: true,
    memorySearchSucceeded: false,
    memoryResultCount: 0,
    proposalAttempted: false,
    proposalSucceeded: false,
    proposalType: null,
    approvalAttempted: false,
    approvalSucceeded: false,
    memoryWriteAttempted: true,
    memoryWriteSucceeded: false,
  });
});

test('normalizes empty and oversized memory results without exposing them', () => {
  const emptyDiagnostics = {};
  const oversizedDiagnostics = {};
  const sensitiveEntries = Array.from({ length: 8 }, (_, index) => ({
    secret: `private-memory-${index}`,
  }));
  const commonDependencies = {
    simulateExecutiveBrainQuery(query) {
      return {
        query,
        answer: 'Respuesta sin memoria.',
        confidence: 0.5,
        sources: [],
        reasoningSummary: {},
        limitations: [],
      };
    },
  };
  const emptyResult = orchestrateExecutiveQuery('Consulta vacia', {
    diagnostics: emptyDiagnostics,
    dependencies: {
      ...commonDependencies,
      memory: { searchMemory: () => [] },
    },
  });
  const oversizedResult = orchestrateExecutiveQuery('Consulta limitada', {
    diagnostics: oversizedDiagnostics,
    dependencies: {
      ...commonDependencies,
      memory: { searchMemory: () => sensitiveEntries },
    },
  });

  assert.deepEqual(emptyDiagnostics, {
    memorySearchAttempted: true,
    memorySearchSucceeded: true,
    memoryResultCount: 0,
    proposalAttempted: false,
    proposalSucceeded: false,
    proposalType: null,
    approvalAttempted: false,
    approvalSucceeded: false,
    memoryWriteAttempted: false,
    memoryWriteSucceeded: false,
  });
  assert.equal(oversizedDiagnostics.memoryResultCount, 5);
  assert.deepEqual(emptyResult.sources, []);
  assert.deepEqual(oversizedResult.sources, []);
  assert.equal(JSON.stringify(oversizedResult).includes('private-memory'), false);
});

test('reports no memory attempt internally when the dependency is absent', () => {
  const diagnostics = {};
  const result = orchestrateExecutiveQuery('Consulta sin memoria', {
    diagnostics,
    dependencies: {
      simulateExecutiveBrainQuery(query) {
        return {
          query,
          answer: 'Respuesta normal.',
          confidence: 0.5,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
    },
  });

  assert.equal(typeof result.response, 'string');
  assert.deepEqual(diagnostics, {
    memorySearchAttempted: false,
    memorySearchSucceeded: false,
    memoryResultCount: 0,
    proposalAttempted: false,
    proposalSucceeded: false,
    proposalType: null,
    approvalAttempted: false,
    approvalSucceeded: false,
    memoryWriteAttempted: false,
    memoryWriteSucceeded: false,
  });
  assert.equal(Object.hasOwn(result, 'memorySearchAttempted'), false);
  assert.equal(Object.hasOwn(result, 'memorySearchSucceeded'), false);
  assert.equal(Object.hasOwn(result, 'memoryResultCount'), false);
});

test('does not generate proposals for informational email, calendar, briefing, or inventory queries', () => {
  const informationalQueries = [
    'Que correos tengo',
    'Lee mi correo',
    'Que tengo hoy',
    'Prepara mi briefing de hoy',
    'Muestra el inventario de proyectos',
  ];
  let proposalCalls = 0;

  informationalQueries.forEach((query) => {
    const result = orchestrateExecutiveQuery(query, {
      dependencies: {
        memory: {
          searchMemory: () => [],
          saveShortTerm() {
            throw new Error('memory must remain read-only');
          },
        },
        proposalEngine: {
          generate() {
            proposalCalls += 1;
            throw new Error('informational queries must not generate proposals');
          },
        },
        approvalQueue: {
          add() {
            throw new Error('approval queue must not be invoked');
          },
        },
        simulateExecutiveBrainQuery(simulationQuery) {
          return {
            query: simulationQuery,
            answer: 'Respuesta informativa.',
            confidence: 0.5,
            sources: [],
            reasoningSummary: {},
            limitations: [],
          };
        },
      },
    });

    assert.equal(result.proposal, null);
    assert.equal(result.approval, null);
  });

  assert.equal(proposalCalls, 0);
});

test('generates safe proposals for explicit email, meeting, and task actions', () => {
  const cases = [
    {
      query: 'Prepara un borrador',
      intent: 'email',
      actionType: 'propose_email',
      proposalType: 'email_draft',
    },
    {
      query: 'Programa una reunion',
      intent: 'meeting',
      actionType: 'propose_meeting',
      proposalType: 'meeting_proposal',
    },
    {
      query: 'Crea una tarea',
      intent: 'task',
      actionType: 'create_task_proposal',
      proposalType: 'task_proposal',
    },
  ];

  cases.forEach((testCase) => {
    let proposalInput = null;
    let queuedProposal = null;
    let queuedContext = null;
    let memoryReads = 0;
    const diagnostics = {};
    const result = orchestrateExecutiveQuery(testCase.query, {
      diagnostics,
      dependencies: {
        memory: {
          searchMemory(query) {
            memoryReads += 1;
            assert.equal(query, testCase.query);
            return [{ secret: 'sensitive-memory-value' }];
          },
          saveShortTerm() {
            throw new Error('memory must remain read-only');
          },
        },
        proposalEngine: {
          generate(input) {
            proposalInput = input;
            return {
              type: testCase.proposalType,
              requiresApproval: true,
              body: 'private-email-body',
              title: 'private-event-title',
              agenda: ['private-event-agenda'],
            };
          },
        },
        approvalQueue: {
          add(proposal, context) {
            queuedProposal = proposal;
            queuedContext = context;
            return {
              id: `approval-${testCase.intent}`,
              status: 'pending',
              createdAt: '2026-07-18T12:00:00.000Z',
            };
          },
        },
        simulateExecutiveBrainQuery(simulationQuery) {
          return {
            query: simulationQuery,
            answer: 'Respuesta ejecutiva estable.',
            confidence: 0.6,
            sources: [],
            reasoningSummary: {},
            limitations: [],
          };
        },
        buildExecutiveResponse(input) {
          return {
            executiveSummary: input.answer,
            recommendation: 'Validar antes de ejecutar.',
            confidence: input.confidence,
            sources: input.sources,
            limitations: input.limitations,
          };
        },
      },
    });

    assert.equal(memoryReads, 1);
    assert.deepEqual(proposalInput, {
      message: testCase.query,
      analysis: {
        intent: testCase.intent,
        urgency: result.analysis.priority,
        actionType: testCase.actionType,
        requiresApproval: true,
      },
      decision: {
        recommendation: 'Validar antes de ejecutar.',
        requiresApproval: true,
      },
    });
    assert.deepEqual(result.proposal, {
      type: testCase.proposalType,
      summary: {
        email_draft: 'Borrador de email preparado para revision.',
        meeting_proposal: 'Propuesta de reunion preparada para revision.',
        task_proposal: 'Propuesta de tarea preparada para revision.',
      }[testCase.proposalType],
      requiresApproval: true,
    });
    assert.deepEqual(queuedProposal, result.proposal);
    assert.deepEqual(queuedContext, {
      interactionId: result.interactionId,
      query: `Solicitud accionable de tipo ${testCase.intent}.`,
      intent: testCase.intent,
      actionType: testCase.actionType,
      priority: result.analysis.priority,
      privateContextUsed: false,
      source: 'executive-orchestrator',
    });
    assert.equal(typeof queuedContext.privateContextUsed, 'boolean');
    assert.deepEqual(result.approval, {
      id: `approval-${testCase.intent}`,
      status: 'pending',
      createdAt: '2026-07-18T12:00:00.000Z',
    });
    assert.equal(JSON.stringify(result).includes('sensitive-memory-value'), false);
    assert.equal(JSON.stringify(result).includes('private-email-body'), false);
    assert.equal(JSON.stringify(result).includes('private-event-title'), false);
    assert.equal(JSON.stringify(result).includes('private-event-agenda'), false);
    assert.equal(diagnostics.proposalAttempted, true);
    assert.equal(diagnostics.proposalSucceeded, true);
    assert.equal(diagnostics.proposalType, testCase.proposalType);
    assert.equal(diagnostics.approvalAttempted, true);
    assert.equal(diagnostics.approvalSucceeded, true);
  });
});

test('keeps the executive response when Proposal Engine is absent or fails', () => {
  const baseDependencies = {
    simulateExecutiveBrainQuery(query) {
      return {
        query,
        answer: 'Respuesta conservada.',
        confidence: 0.5,
        sources: [],
        reasoningSummary: {},
        limitations: [],
      };
    },
  };
  const withoutEngine = orchestrateExecutiveQuery('Crea una tarea', {
    dependencies: baseDependencies,
  });
  const diagnostics = {};
  const withFailure = orchestrateExecutiveQuery('Crea una tarea', {
    diagnostics,
    dependencies: {
      ...baseDependencies,
      proposalEngine: {
        generate() {
          throw new Error('proposal unavailable');
        },
      },
      approvalQueue: {
        add() {
          throw new Error('approval queue must not be invoked');
        },
      },
    },
  });

  assert.equal(withoutEngine.proposal, null);
  assert.equal(withoutEngine.approval, null);
  assert.equal(withFailure.proposal, null);
  assert.equal(withFailure.approval, null);
  assert.match(withFailure.interactionId, UUID_PATTERN);
  assert.equal(withFailure.response, withoutEngine.response);
  assert.deepEqual(diagnostics, {
    memorySearchAttempted: false,
    memorySearchSucceeded: false,
    memoryResultCount: 0,
    proposalAttempted: true,
    proposalSucceeded: false,
    proposalType: 'task_proposal',
    approvalAttempted: false,
    approvalSucceeded: false,
    memoryWriteAttempted: false,
    memoryWriteSucceeded: false,
  });
});

test('keeps proposal when Approval Queue is absent or fails', () => {
  const proposalEngine = {
    generate() {
      return {
        type: 'task_proposal',
        requiresApproval: true,
        title: 'sensitive-task-title',
      };
    },
  };
  const simulateExecutiveBrainQuery = (query) => ({
    query,
    answer: 'Respuesta ejecutiva.',
    confidence: 0.5,
    sources: [],
    reasoningSummary: {},
    limitations: [],
  });
  const withoutQueue = orchestrateExecutiveQuery('Crea una tarea', {
    dependencies: { proposalEngine, simulateExecutiveBrainQuery },
  });
  const diagnostics = {};
  const withQueueFailure = orchestrateExecutiveQuery('Crea una tarea', {
    diagnostics,
    dependencies: {
      proposalEngine,
      simulateExecutiveBrainQuery,
      approvalQueue: {
        add() {
          throw new Error('queue unavailable');
        },
      },
    },
  });

  assert.notEqual(withoutQueue.proposal, null);
  assert.equal(withoutQueue.approval, null);
  assert.deepEqual(withQueueFailure.proposal, withoutQueue.proposal);
  assert.equal(withQueueFailure.approval, null);
  assert.equal(withQueueFailure.response, withoutQueue.response);
  assert.match(withQueueFailure.interactionId, UUID_PATTERN);
  assert.equal(diagnostics.approvalAttempted, true);
  assert.equal(diagnostics.approvalSucceeded, false);
});

test('does not enqueue a proposal that does not require approval', () => {
  let approvalCalls = 0;
  const result = orchestrateExecutiveQuery('Crea una tarea', {
    dependencies: {
      proposalEngine: {
        generate() {
          return {
            type: 'task_proposal',
            requiresApproval: false,
          };
        },
      },
      approvalQueue: {
        add() {
          approvalCalls += 1;
        },
      },
      simulateExecutiveBrainQuery(query) {
        return {
          query,
          answer: 'Respuesta ejecutiva.',
          confidence: 0.5,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
    },
  });

  assert.equal(result.proposal.requiresApproval, false);
  assert.equal(result.approval, null);
  assert.equal(approvalCalls, 0);
});

test('writes only safe completed metadata after response, proposal, and approval are built', () => {
  const calls = [];
  let savedEntry = null;
  let approvalContext = null;
  const sensitiveQuery = 'Prepara un borrador de respuesta para asunto privado 123';
  const result = orchestrateExecutiveQuery(sensitiveQuery, {
    dependencies: {
      memory: {
        searchMemory(query) {
          calls.push('memory.search');
          assert.equal(query, sensitiveQuery);
          return [{ secret: 'private-memory-content' }];
        },
        saveShortTerm(entry) {
          calls.push('memory.write');
          savedEntry = entry;
        },
      },
      analyzeExecutiveQuery() {
        calls.push('analysis');
        return {
          intent: 'unknown',
          project: null,
          documentTypes: [],
          keywords: [],
          filters: {},
          priority: 'high',
          confidence: 0.5,
        };
      },
      simulateExecutiveBrainQuery(query) {
        calls.push('response');
        return {
          query,
          answer: 'private-executive-response',
          confidence: 0.5,
          sources: [{ id: 'private-source', path: 'private-path' }],
          reasoningSummary: {},
          limitations: ['private-limitation'],
        };
      },
      buildExecutiveResponse(input) {
        calls.push('response-builder');
        return {
          executiveSummary: input.answer,
          recommendation: 'private-recommendation',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
      proposalEngine: {
        generate() {
          calls.push('proposal');
          return {
            type: 'email_draft',
            body: 'private-proposal-body',
            requiresApproval: true,
          };
        },
      },
      approvalQueue: {
        add(proposal, context) {
          calls.push('approval');
          approvalContext = context;
          return {
            id: 'private-approval-id',
            status: 'pending',
            createdAt: '2026-07-18T12:00:00.000Z',
          };
        },
      },
    },
  });

  assert.deepEqual(calls, [
    'analysis',
    'memory.search',
    'response',
    'response-builder',
    'proposal',
    'approval',
    'memory.write',
  ]);
  assert.deepEqual(Object.keys(savedEntry), [
    'type',
    'interactionId',
    'intent',
    'priority',
    'actionable',
    'actionType',
    'proposalCreated',
    'approvalCreated',
    'privateContextUsed',
    'status',
    'createdAt',
  ]);
  assert.deepEqual({ ...savedEntry, createdAt: '<timestamp>' }, {
    type: 'executive-interaction',
    interactionId: result.interactionId,
    intent: 'email',
    priority: 'high',
    actionable: true,
    actionType: 'email',
    proposalCreated: true,
    approvalCreated: true,
    privateContextUsed: false,
    status: 'completed',
    createdAt: '<timestamp>',
  });
  assert.equal(Number.isNaN(Date.parse(savedEntry.createdAt)), false);
  assert.equal(savedEntry.interactionId, result.interactionId);
  assert.equal(approvalContext.interactionId, result.interactionId);
  [
    sensitiveQuery,
    'private-memory-content',
    'private-executive-response',
    'private-source',
    'private-path',
    'private-limitation',
    'private-recommendation',
    'private-proposal-body',
    'private-approval-id',
  ].forEach((sensitiveValue) => {
    assert.equal(JSON.stringify(savedEntry).includes(sensitiveValue), false);
  });
  assert.notEqual(result.proposal, null);
  assert.notEqual(result.approval, null);
});

test('writes correct safe metadata for informational, meeting, and task interactions', () => {
  const cases = [
    {
      query: 'Que correos tengo',
      intent: 'unknown',
      actionable: false,
      actionType: null,
      proposalCreated: false,
      approvalCreated: false,
    },
    {
      query: 'Programa una reunion',
      intent: 'meeting',
      actionable: true,
      actionType: 'meeting',
      proposalCreated: true,
      approvalCreated: true,
    },
    {
      query: 'Crea una tarea',
      intent: 'task',
      actionable: true,
      actionType: 'task',
      proposalCreated: true,
      approvalCreated: true,
    },
  ];

  cases.forEach((testCase) => {
    let savedEntry = null;
    const result = orchestrateExecutiveQuery(testCase.query, {
      dependencies: {
        memory: {
          searchMemory: () => [],
          saveShortTerm(entry) {
            savedEntry = entry;
          },
        },
        proposalEngine: {
          generate() {
            return { requiresApproval: true };
          },
        },
        approvalQueue: {
          add() {
            return {
              id: 'approval-test',
              status: 'pending',
              createdAt: '2026-07-18T12:00:00.000Z',
            };
          },
        },
        simulateExecutiveBrainQuery(query) {
          return {
            query,
            answer: 'Respuesta.',
            confidence: 0.5,
            sources: [],
            reasoningSummary: {},
            limitations: [],
          };
        },
      },
    });

    assert.equal(savedEntry.intent, testCase.intent);
    assert.equal(savedEntry.actionable, testCase.actionable);
    assert.equal(savedEntry.actionType, testCase.actionType);
    assert.equal(savedEntry.proposalCreated, testCase.proposalCreated);
    assert.equal(savedEntry.approvalCreated, testCase.approvalCreated);
    assert.equal(savedEntry.privateContextUsed, false);
    assert.equal(savedEntry.interactionId, result.interactionId);
    assert.equal(result.proposal !== null, testCase.proposalCreated);
    assert.equal(result.approval !== null, testCase.approvalCreated);
  });
});

test('private context writes the same safe metadata without private content', () => {
  const privatePayload = {
    messages: [{ subject: 'private-subject-write', snippet: 'private-snippet-write' }],
  };
  let savedEntry = null;
  const result = orchestrateExecutiveQuery('Prepara un borrador de respuesta privada', {
    privateContextMetadata: buildPrivateContext({
      sourceType: 'gmail',
      sourceId: 'private-source-write',
    }),
    expectedClientId: 'client-alpha',
    privatePayload,
    dependencies: {
      memory: {
        searchMemory: () => [{ secret: 'private-memory-write' }],
        saveShortTerm(entry) {
          savedEntry = entry;
        },
      },
      proposalEngine: {
        generate() {
          return {
            requiresApproval: true,
            body: 'private-body-write',
          };
        },
      },
      approvalQueue: {
        add() {
          return {
            id: 'private-approval-write',
            status: 'pending',
            createdAt: '2026-07-18T12:00:00.000Z',
          };
        },
      },
      simulateExecutiveBrainQuery(query) {
        return {
          query,
          answer: 'private-response-write',
          confidence: 0.5,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
    },
  });

  assert.equal(savedEntry.privateContextUsed, true);
  assert.equal(savedEntry.interactionId, result.interactionId);
  [
    'private-subject-write',
    'private-snippet-write',
    'private-source-write',
    'private-memory-write',
    'private-body-write',
    'private-approval-write',
    'private-response-write',
  ].forEach((sensitiveValue) => {
    assert.equal(JSON.stringify(savedEntry).includes(sensitiveValue), false);
  });
});

test('memory write failure or missing saveShortTerm does not change the executive result', () => {
  const diagnostics = {};
  const commonDependencies = {
    proposalEngine: {
      generate() {
        return { requiresApproval: true };
      },
    },
    approvalQueue: {
      add() {
        return {
          id: 'approval-stable',
          status: 'pending',
          createdAt: '2026-07-18T12:00:00.000Z',
        };
      },
    },
    simulateExecutiveBrainQuery(query) {
      return {
        query,
        answer: 'Respuesta estable.',
        confidence: 0.5,
        sources: [],
        reasoningSummary: {},
        limitations: [],
      };
    },
  };
  const withoutWriter = orchestrateExecutiveQuery('Crea una tarea', {
    dependencies: {
      ...commonDependencies,
      memory: { searchMemory: () => [] },
    },
  });
  const withWriteFailure = orchestrateExecutiveQuery('Crea una tarea', {
    diagnostics,
    dependencies: {
      ...commonDependencies,
      memory: {
        searchMemory: () => [],
        saveShortTerm() {
          throw new Error('write unavailable');
        },
      },
    },
  });

  assert.deepEqual(
    { ...withWriteFailure, interactionId: '<interaction-id>' },
    { ...withoutWriter, interactionId: '<interaction-id>' },
  );
  assert.notEqual(withWriteFailure.interactionId, withoutWriter.interactionId);
  assert.match(withWriteFailure.interactionId, UUID_PATTERN);
  assert.equal(diagnostics.memoryWriteAttempted, true);
  assert.equal(diagnostics.memoryWriteSucceeded, false);
});

test('generates one unique non-sensitive UUID interactionId per operation', () => {
  const firstSavedEntries = [];
  const secondSavedEntries = [];
  const buildDependencies = (savedEntries) => ({
    memory: {
      searchMemory: () => [],
      saveShortTerm(entry) {
        savedEntries.push(entry);
      },
    },
    simulateExecutiveBrainQuery(query) {
      return {
        query,
        answer: 'Respuesta.',
        confidence: 0.5,
        sources: [],
        reasoningSummary: {},
        limitations: [],
      };
    },
  });
  const first = orchestrateExecutiveQuery('Consulta sensible alpha@example.com', {
    dependencies: buildDependencies(firstSavedEntries),
  });
  const second = orchestrateExecutiveQuery('Consulta sensible alpha@example.com', {
    dependencies: buildDependencies(secondSavedEntries),
  });
  assert.match(first.interactionId, UUID_PATTERN);
  assert.match(second.interactionId, UUID_PATTERN);
  assert.notEqual(first.interactionId, second.interactionId);
  assert.equal(firstSavedEntries.length, 1);
  assert.equal(secondSavedEntries.length, 1);
  assert.equal(firstSavedEntries[0].interactionId, first.interactionId);
  assert.equal(secondSavedEntries[0].interactionId, second.interactionId);
  assert.equal(first.interactionId.includes('alpha@example.com'), false);
  assert.equal(JSON.stringify(firstSavedEntries[0]).includes('alpha@example.com'), false);
});

test('does not expose private context through safe proposal metadata', () => {
  const privatePayload = {
    messages: [{ subject: 'private-subject', snippet: 'private-snippet' }],
  };
  let queuedProposal = null;
  let queuedContext = null;
  const result = orchestrateExecutiveQuery('Prepara un borrador de respuesta', {
    privateContextMetadata: buildPrivateContext({
      sourceType: 'gmail',
      sourceId: 'gmail-private-source',
    }),
    expectedClientId: 'client-alpha',
    privatePayload,
    dependencies: {
      proposalEngine: {
        generate() {
          return {
            type: 'email_draft',
            requiresApproval: true,
            body: privatePayload.messages[0].snippet,
            subject: privatePayload.messages[0].subject,
          };
        },
      },
      approvalQueue: {
        add(proposal, context) {
          queuedProposal = proposal;
          queuedContext = context;
          return {
            id: 'approval-private-context',
            status: 'pending',
            createdAt: '2026-07-18T12:00:00.000Z',
          };
        },
      },
      simulateExecutiveBrainQuery(query) {
        return {
          query,
          answer: 'Respuesta base.',
          confidence: 0.5,
          sources: [],
          reasoningSummary: {},
          limitations: [],
        };
      },
    },
  });

  assert.equal(result.proposal.type, 'email_draft');
  assert.equal(JSON.stringify(result.proposal).includes('private-subject'), false);
  assert.equal(JSON.stringify(result.proposal).includes('private-snippet'), false);
  assert.deepEqual(queuedProposal, result.proposal);
  assert.equal(queuedContext.interactionId, result.interactionId);
  assert.equal(queuedContext.privateContextUsed, true);
  assert.equal(typeof queuedContext.privateContextUsed, 'boolean');
  assert.equal(JSON.stringify(queuedContext).includes('private-subject'), false);
  assert.equal(JSON.stringify(queuedContext).includes('private-snippet'), false);
  assert.equal(JSON.stringify(result.approval).includes('private-subject'), false);
  assert.equal(JSON.stringify(result.approval).includes('private-snippet'), false);
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

test('adapts a collection of private contexts individually without mixing payloads', () => {
  const adapterInputs = [];
  const calendarPayload = {
    source: 'calendar',
    events: [{ id: 'event-private-1', title: 'Evento privado' }],
  };
  const gmailPayload = {
    source: 'gmail',
    messages: [{ id: 'msg-private-1', subject: 'Correo privado' }],
  };

  const authorizedContexts = prepareAuthorizedPrivateContexts({
    privateContextRequiredPurpose: 'executive-briefing',
    privateContexts: [
      {
        privateContextMetadata: buildPrivateContext({
          sourceType: 'calendar',
          purpose: 'executive-briefing',
        }),
        expectedClientId: 'client-alpha',
        privatePayload: calendarPayload,
      },
      {
        privateContextMetadata: buildPrivateContext({
          sourceType: 'gmail',
          purpose: 'executive-briefing',
        }),
        expectedClientId: 'client-alpha',
        privatePayload: gmailPayload,
      },
    ],
  }, (input) => {
    adapterInputs.push(input);

    return {
      authorized: true,
      sourceType: input.privateContext.sourceType,
      payload: input.payload,
    };
  });

  assert.equal(adapterInputs.length, 2);
  assert.equal(authorizedContexts.length, 2);
  assert.equal(authorizedContexts[0].sourceType, 'calendar');
  assert.equal(authorizedContexts[1].sourceType, 'gmail');
  assert.equal(adapterInputs[0].requiredPurpose, 'executive-briefing');
  assert.equal(adapterInputs[1].requiredPurpose, 'executive-briefing');
  assert.deepEqual(adapterInputs[0].payload, calendarPayload);
  assert.deepEqual(adapterInputs[1].payload, gmailPayload);
  assert.equal(Object.hasOwn(adapterInputs[0].payload, 'messages'), false);
  assert.equal(Object.hasOwn(adapterInputs[1].payload, 'events'), false);
});

test('allows Calendar and Gmail private context collection with the same identity', () => {
  let adapterCalls = 0;
  const authorizedContexts = prepareAuthorizedPrivateContexts({
    privateContexts: buildPrivateContextCollection(),
  }, (input) => {
    adapterCalls += 1;

    return {
      authorized: true,
      clientId: input.privateContext.clientId,
      userId: input.privateContext.userId,
      sourceType: input.privateContext.sourceType,
      purpose: input.privateContext.purpose,
      promotionPolicy: input.privateContext.promotionPolicy,
      payload: input.payload,
    };
  });

  assert.equal(adapterCalls, 2);
  assert.equal(authorizedContexts.length, 2);
  assert.equal(authorizedContexts[0].clientId, 'client-alpha');
  assert.equal(authorizedContexts[1].clientId, 'client-alpha');
  assert.equal(authorizedContexts[0].userId, 'user-alpha');
  assert.equal(authorizedContexts[1].userId, 'user-alpha');
});

test('rejects private context collection with mismatched clientId', () => {
  assertPrivateContextIdentityMismatch(() => prepareAuthorizedPrivateContexts({
    privateContexts: buildPrivateContextCollection({
      gmail: {
        metadata: { clientId: 'client-beta' },
        expectedClientId: 'client-beta',
      },
    }),
  }, () => {
    throw new Error('Adapter should not run for identity mismatch.');
  }));
});

test('rejects private context collection with mismatched userId', () => {
  assertPrivateContextIdentityMismatch(() => prepareAuthorizedPrivateContexts({
    privateContexts: buildPrivateContextCollection({
      gmail: { metadata: { userId: 'user-beta' } },
    }),
  }, () => {
    throw new Error('Adapter should not run for identity mismatch.');
  }));
});

test('rejects private context collection with mismatched expectedClientId', () => {
  assertPrivateContextIdentityMismatch(() => prepareAuthorizedPrivateContexts({
    privateContexts: buildPrivateContextCollection({
      gmail: { expectedClientId: 'client-beta' },
    }),
  }, () => {
    throw new Error('Adapter should not run for identity mismatch.');
  }));
});

test('rejects private context collection with mismatched purpose safely', () => {
  assertPrivateContextIdentityMismatch(() => prepareAuthorizedPrivateContexts({
    privateContexts: buildPrivateContextCollection({
      gmail: { metadata: { purpose: 'email-sync' } },
    }),
  }, () => {
    throw new Error('Adapter should not run for identity mismatch.');
  }));
});

test('rejects private context collection with mismatched promotionPolicy safely', () => {
  assertPrivateContextIdentityMismatch(() => prepareAuthorizedPrivateContexts({
    privateContexts: buildPrivateContextCollection({
      gmail: { metadata: { promotionPolicy: 'PROMOTE_ALLOWED' } },
    }),
  }, () => {
    throw new Error('Adapter should not run for identity mismatch.');
  }));
});

test('builds a combined Calendar and Gmail answer for mixed private queries', () => {
  const adapterInputs = [];
  const result = orchestrateExecutiveQuery('Que tengo hoy y que correos tengo?', {
    privateContextRequiredPurpose: 'executive-briefing',
    privateContexts: [
      {
        privateContextMetadata: buildPrivateContext({
          sourceType: 'calendar',
          sourceId: 'calendar-source-alpha',
          purpose: 'executive-briefing',
        }),
        expectedClientId: 'client-alpha',
        privatePayload: {
          source: 'calendar',
          events: [
            {
              id: 'event-private-1',
              title: 'Evento privado A',
              start: '2026-07-04T10:00:00+02:00',
            },
            {
              id: 'event-private-2',
              title: 'Evento privado B',
              start: '2026-07-04T12:15:00+02:00',
            },
            {
              id: 'event-private-3',
              title: 'Evento privado C',
              start: '2026-07-04T15:30:00+02:00',
            },
            {
              id: 'event-private-4',
              title: 'Evento privado D',
              start: '2026-07-04T18:45:00+02:00',
            },
          ],
        },
      },
      {
        privateContextMetadata: buildPrivateContext({
          sourceType: 'gmail',
          sourceId: 'gmail-source-alpha',
          purpose: 'executive-briefing',
        }),
        expectedClientId: 'client-alpha',
        privatePayload: {
          source: 'gmail',
          messages: [
            {
              id: 'msg-private-1',
              threadId: 'thread-private-1',
              from: 'Remitente privado',
              subject: 'Correo privado A',
              snippet: 'Snippet privado A',
            },
            {
              id: 'msg-private-2',
              threadId: 'thread-private-2',
              from: 'Remitente B',
              subject: 'Correo privado B',
              snippet: 'Snippet privado B',
            },
            {
              id: 'msg-private-3',
              threadId: 'thread-private-3',
              from: 'Remitente C',
              subject: 'Correo privado C',
              snippet: 'Snippet privado C',
            },
            {
              id: 'msg-private-4',
              threadId: 'thread-private-4',
              from: 'Remitente D',
              subject: 'Correo privado D',
              snippet: 'Snippet privado D',
            },
          ],
        },
      },
    ],
    dependencies: {
      preparePrivateContextAdapter(input) {
        adapterInputs.push(input);

        return {
          sourceType: input.privateContext.sourceType,
          sensitivity: input.privateContext.sensitivity,
          payload: input.payload,
          authorized: true,
          private: true,
          persistable: false,
          promotable: false,
        };
      },
      analyzeExecutiveQuery() {
        return {
          intent: 'briefing',
          project: null,
          documentTypes: [],
          keywords: ['agenda', 'correos'],
          filters: {},
          priority: 'high',
          confidence: 0.9,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Que tengo hoy y que correos tengo?',
          answer: 'No se encontraron Knowledge Objects relevantes para "Que tengo hoy y que correos tengo?" en el Knowledge Store.',
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
          ],
        };
      },
      buildExecutiveResponse(input) {
        return {
          executiveSummary: `${input.answer} ${input.confidence >= 0.7 ? 'Confianza media.' : 'Confianza baja.'}`,
          keyFindings: [],
          recommendation: '',
          confidence: input.confidence,
          sources: input.sources,
          limitations: input.limitations,
        };
      },
    },
  });

  assert.equal(adapterInputs.length, 2);
  assert.equal(result.privateContextUsed, true);
  assert.equal(
    result.response,
    'Agenda privada autorizada: tienes 4 eventos hoy: Evento privado A a las 10:00; Evento privado B a las 12:15; Evento privado C a las 15:30 y 1 evento(s) mas. Correo privado autorizado: tienes 4 correos recientes:\n- Correo privado A de Remitente privado\n- Correo privado B de Remitente B\n- Correo privado C de Remitente C y 1 correo(s) mas. Confianza media.',
  );
  assert.match(result.response, /\n- Correo privado A de Remitente privado/);
  assert.match(result.response, /\n- Correo privado B de Remitente B/);
  assert.match(result.response, /\n- Correo privado C de Remitente C/);
  assert.doesNotMatch(result.response, /No se encontraron Knowledge Objects/);
  assert.doesNotMatch(result.response, /Knowledge Store/);
  assert.doesNotMatch(result.response, /Evento privado D/);
  assert.doesNotMatch(result.response, /Correo privado D/);
  assert.doesNotMatch(result.response, /event-private-1/);
  assert.doesNotMatch(result.response, /msg-private-1/);
  assert.doesNotMatch(result.response, /thread-private-1/);
  assert.doesNotMatch(result.response, /Snippet privado/);
  assert.equal(result.confidence, 0.9);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.limitations, []);
  assert.equal(Object.hasOwn(adapterInputs[0].payload, 'messages'), false);
  assert.equal(Object.hasOwn(adapterInputs[1].payload, 'events'), false);
  assert.equal(JSON.stringify(result).includes('event-private-1'), false);
  assert.equal(JSON.stringify(result).includes('msg-private-1'), false);
  assert.equal(JSON.stringify(result).includes('thread-private-1'), false);
  assert.equal(JSON.stringify(result).includes('Snippet privado'), false);
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

test('prioritizes authorized Gmail over noisy Knowledge Store response without exposing message ids', () => {
  let builderInput = null;
  const result = orchestrateExecutiveQuery('Que correos tengo', {
    privateContextMetadata: buildPrivateContext({
      sourceType: 'gmail',
      sourceId: 'gmail-primary',
      purpose: 'executive-briefing',
      authorization: { status: 'granted', provider: 'google-oauth' },
    }),
    expectedClientId: 'client-alpha',
    privateContextRequiredPurpose: 'executive-briefing',
    privatePayload: {
      source: 'gmail',
      messages: [
        {
          id: 'msg-private-1',
          threadId: 'thread-private-1',
          from: 'Remitente A',
          subject: 'Asunto A',
          date: '2026-07-04T09:00:00.000Z',
          snippet: 'Snippet privado A',
        },
        {
          id: 'msg-private-2',
          threadId: 'thread-private-2',
          from: 'Remitente B',
          subject: 'Asunto B',
          date: '2026-07-04T10:00:00.000Z',
          snippet: 'Snippet privado B',
        },
        {
          id: 'msg-private-3',
          threadId: 'thread-private-3',
          from: 'Remitente C',
          subject: 'Asunto C',
          date: '2026-07-04T11:00:00.000Z',
          snippet: 'Snippet privado C',
        },
        {
          id: 'msg-private-4',
          threadId: 'thread-private-4',
          from: 'Remitente D',
          subject: 'Asunto D',
          date: '2026-07-04T12:00:00.000Z',
          snippet: 'Snippet privado D',
        },
      ],
    },
    dependencies: {
      analyzeExecutiveQuery() {
        return {
          intent: 'unknown',
          project: null,
          documentTypes: [],
          keywords: ['correos'],
          filters: {},
          priority: 'normal',
          confidence: 0.45,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Que correos tengo',
          answer: 'No se encontraron Knowledge Objects relevantes para "Que correos tengo" en el Knowledge Store.',
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
            'Only persisted Knowledge Objects are read.',
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
  assert.equal(
    result.response,
    'Correo privado autorizado: tienes 4 correos recientes:\n- Asunto A de Remitente A\n- Asunto B de Remitente B\n- Asunto C de Remitente C y 1 correo(s) mas. Confianza media.',
  );
  assert.match(result.response, /\n- Asunto A de Remitente A/);
  assert.match(result.response, /\n- Asunto B de Remitente B/);
  assert.match(result.response, /\n- Asunto C de Remitente C/);
  assert.doesNotMatch(result.response, /No se encontraron Knowledge Objects/);
  assert.doesNotMatch(result.response, /Knowledge Store/);
  assert.doesNotMatch(result.response, /Asunto D/);
  assert.doesNotMatch(result.response, /msg-private-1/);
  assert.doesNotMatch(result.response, /thread-private-1/);
  assert.doesNotMatch(result.response, /Snippet privado/);
  assert.equal(builderInput.confidence, 0.7);
  assert.equal(result.confidence, 0.7);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.limitations, []);
  assert.deepEqual(builderInput.sources, []);
  assert.deepEqual(builderInput.limitations, []);
  assert.equal(JSON.stringify(result).includes('msg-private-1'), false);
  assert.equal(JSON.stringify(result).includes('thread-private-1'), false);
  assert.equal(JSON.stringify(result).includes('Snippet privado'), false);
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

test('rejects an invalid context inside a private context collection safely', () => {
  assert.throws(
    () => orchestrateExecutiveQuery('Consulta privada combinada', {
      privateContextRequiredPurpose: 'executive-briefing',
      privateContexts: [
        {
          privateContextMetadata: buildPrivateContext({
            sourceType: 'calendar',
            purpose: 'executive-briefing',
          }),
          expectedClientId: 'client-alpha',
          privatePayload: { events: [] },
        },
        {
          privateContextMetadata: buildPrivateContext({
            sourceType: 'gmail',
            purpose: 'executive-briefing',
            authorization: { status: 'pending' },
          }),
          expectedClientId: 'client-alpha',
          privatePayload: { messages: [] },
        },
      ],
      dependencies: {
        simulateExecutiveBrainQuery() {
          throw new Error('Simulator should not run for invalid private contexts.');
        },
      },
    }),
    /authorization must be granted/,
  );
});

test('does not invoke the private context adapter for non-private queries', () => {
  const result = orchestrateExecutiveQuery('Resumen sin contexto privado', {
    dependencies: {
      preparePrivateContextAdapter() {
        throw new Error('Private context adapter should not be called.');
      },
      analyzeExecutiveQuery() {
        return {
          intent: 'summary',
          project: null,
          documentTypes: [],
          keywords: [],
          filters: {},
          priority: 'medium',
          confidence: 0.8,
        };
      },
      simulateExecutiveBrainQuery() {
        return {
          query: 'Resumen sin contexto privado',
          answer: 'Respuesta publica.',
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

  assert.equal(result.privateContextUsed, false);
  assert.equal(result.response, 'Respuesta publica.');
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.limitations, []);
});
