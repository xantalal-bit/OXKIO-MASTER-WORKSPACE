'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CONVERSATIONAL_RECOVERY_POLICY,
  ECOSYSTEM_SUPERVISOR_POLICY,
  INTELLIGENCE_COMMITTEE_READINESS,
  OBSERVED_AREAS,
  buildEcosystemObserver,
} = require('./ecosystem-observer');
const SystemStateManager = require('../../core/systemStateManager');
const ProjectManagerService = require('../../projects/projectManagerService');
const { readGovernanceStateView } = require('../../governance/governanceReader');

function fixture(overrides = {}) {
  return {
    systemStateView: {
      state: 'running',
      integrationsSummary: [{ name: 'gmail', status: 'connected' }],
      workflowsSummary: [{ name: 'calendar', status: 'available' }],
      alertsSummary: [],
    },
    projectStateView: {
      project: 'OXKIO',
      blockPhase: '5C.6',
      activeSubphase: '5C.6E.1',
      currentBlock: 'Sistema Nervioso V1',
      currentPhase: '5C.6E.1 — Ecosystem Observer',
      lastMilestone: 'Preparation auditada.',
      currentObjective: 'Incorporar conciencia situacional readonly.',
      roadmapAlignment: 'aligned',
      nextRecommendedStep: 'Completar el piloto manual.',
      nextPlannedPhase: 'Executive Approval & Execution.',
      remainingSteps: ['Completar el piloto manual.'],
      doNotOpenYet: ['Executive Approval & Execution.'],
      driftEvidence: [],
      reuseEvidence: ['Completar el observador existente.'],
      duplicationEvidence: ['Se evitó crear otro supervisor.'],
      sessionAchievements: ['Observer integrado.', 'Pruebas completadas.'],
      consolidatedCapabilities: ['Executive Fusion', 'Gmail Readonly'],
      closureEvidence: {
        implementation: true,
        integration: true,
        tests: true,
        manualPilot: false,
        audit: true,
        documentation: true,
        observerAligned: true,
        supervisorValidation: true,
        stagingPrepared: true,
        commit: false,
        publication: false,
      },
      sessionSummary: 'Observer integrado y probado.',
    },
    governanceStateView: {
      strategicObjective: 'Gobernar el crecimiento del ecosistema.',
      priorities: ['Cliente Cero'],
      reminders: ['Reutilizar las capacidades y fuentes existentes antes de desarrollar componentes nuevos.'],
      learnedLessons: ['Integrar antes de continuar.', 'Evidencia antes que opinión.'],
      strategicRecommendations: ['Preparar el futuro Comité de Inteligencia.'],
    },
    generatedAt: '2026-07-24T10:00:00.000Z',
    ...overrides,
  };
}

test('reports the correct ecosystem state, block, phase and objectives', () => {
  const result = buildEcosystemObserver(fixture());
  assert.deepEqual(result.ecosystemStatus, {
    state: 'stable',
    project: 'OXKIO',
    lastMilestone: 'Preparation auditada.',
    lastCommit: '',
  });
  assert.equal(result.currentBlock, 'Sistema Nervioso V1');
  assert.equal(result.currentPhase, '5C.6E.1 — Ecosystem Observer');
  assert.equal(result.currentObjective, 'Incorporar conciencia situacional readonly.');
  assert.equal(result.strategicObjective, 'Gobernar el crecimiento del ecosistema.');
  assert.equal(result.nextRecommendedStep, 'Completar el piloto manual.');
  assert.equal(result.generatedAt, '2026-07-24T10:00:00.000Z');
  assert.deepEqual(result.blockStatus, { phase: '5C.6', state: 'in_progress' });
  assert.deepEqual(result.subphaseStatus, { phase: '5C.6E.1', state: 'work_remaining' });
  assert.deepEqual(result.releaseStatus, { state: 'pending' });
  assert.deepEqual(result.consolidatedCapabilities, ['Executive Fusion', 'Gmail Readonly']);
  assert.match(result.progressMessage, /^El bloque continúa avanzando correctamente\./);
  assert.match(result.progressMessage, /La subfase actualmente abierta es: 5C\.6E\.1/);
  assert.deepEqual(result.operationalGuidance, {
    phaseClosureStatus: 'work_remaining',
    remainingSteps: ['Completar el piloto manual.'],
    nextBestAction: 'Completar el piloto manual.',
    doNotOpenYet: ['Executive Approval & Execution.'],
    driftWarnings: [],
    reuseWarnings: [
      'Completar el observador existente.',
      'Reutilizar las capacidades y fuentes existentes antes de desarrollar componentes nuevos.',
    ],
    experienceWarnings: [],
    learnedLessons: ['Integrar antes de continuar.', 'Evidencia antes que opinión.'],
    sessionSummary: 'Observer integrado y probado.',
  });
  assert.deepEqual(result.supervisorRecommendation, {
    type: 'operational',
    action: 'Completar el piloto manual.',
    rationale: 'Incorporar conciencia situacional readonly.',
    evidence: [
      '5C.6E.1 — Ecosystem Observer',
      'Incorporar conciencia situacional readonly.',
      'Preparation auditada.',
      'aligned',
      'work_remaining',
    ],
    confidence: 'medium',
    confidenceExplanation: {
      level: 'medium',
      supportingEvidence: [
        'Implementación: completado',
        'Integración: completado',
        'Pruebas: completado',
        'Auditoría: completado',
        'Documentación canónica: completado',
      ],
      missingEvidence: [
        'Piloto: pendiente',
        'Commit: pendiente',
        'Publicación: pendiente',
      ],
    },
    priority: 'very_high',
    advisoryOnly: true,
    humanDecisionRequired: true,
  });
  assert.deepEqual(result.strategicRecommendations, [{
    type: 'strategic',
    action: 'Preparar el futuro Comité de Inteligencia.',
    evidence: ['Gobernar el crecimiento del ecosistema.'],
    confidence: 'medium',
  }]);
  assert.deepEqual(result.sessionHistory, {
    achievements: ['Observer integrado.', 'Pruebas completadas.'],
    nextAction: 'Completar el piloto manual.',
  });
  assert.deepEqual(result.auditAnswers, {
    reused: ['Completar el observador existente.'],
    duplicationAvoided: ['Se evitó crear otro supervisor.'],
    remainingToClose: ['Completar el piloto manual.'],
    nextHighestImpactAction: 'Completar el piloto manual.',
  });
  assert.deepEqual(result.intelligenceCommitteePreparation, {
    status: 'planned',
    externalModelsEnabled: false,
    executionEnabled: false,
    context: 'Observer integrado y probado.',
    evidence: result.supervisorRecommendation.evidence,
    risks: [],
    alternatives: result.operationalGuidance.reuseWarnings,
    confidence: 'medium',
    authority: 'human',
  });
});

test('keeps a published capability stable while the active subphase remains open', () => {
  const input = fixture({
    projectStateView: {
      ...fixture().projectStateView,
      consolidatedCapabilities: [
        'Executive Fusion',
        'C:\\private\\invented-module.js',
        null,
      ],
    },
  });
  const result = buildEcosystemObserver(input);
  assert.equal(result.blockStatus.state, 'in_progress');
  assert.equal(result.subphaseStatus.state, 'work_remaining');
  assert.equal(result.releaseStatus.state, 'pending');
  assert.deepEqual(result.consolidatedCapabilities, ['Executive Fusion']);
  assert.doesNotMatch(result.progressMessage, /invented-module|private/i);
});

test('derives ready, blocked and unknown closure states only from evidence', () => {
  const allComplete = Object.fromEntries(
    Object.keys(fixture().projectStateView.closureEvidence).map((key) => [key, true]),
  );
  assert.equal(buildEcosystemObserver(fixture({
    projectStateView: {
      ...fixture().projectStateView,
      remainingSteps: [],
      doNotOpenYet: [],
      closureEvidence: allComplete,
    },
  })).operationalGuidance.phaseClosureStatus, 'ready_to_close');
  assert.equal(buildEcosystemObserver(fixture({
    systemStateView: {
      ...fixture().systemStateView,
      alertsSummary: [{ type: 'phase-blocked', message: 'Falta una autorización necesaria.' }],
    },
  })).operationalGuidance.phaseClosureStatus, 'blocked');
  assert.equal(buildEcosystemObserver({}).operationalGuidance.phaseClosureStatus, 'unknown');
});

test('uses evidenced drift, duplication and reuse guidance within strict limits', () => {
  const result = buildEcosystemObserver(fixture({
    systemStateView: {
      ...fixture().systemStateView,
      alertsSummary: [
        { type: 'documentation-obsolete', message: 'El roadmap publicado está desactualizado.' },
        { type: 'duplicate-capability', message: 'Ya existe un observador parcial.' },
      ],
    },
  }));
  assert.deepEqual(result.operationalGuidance.driftWarnings, [
    'El roadmap publicado está desactualizado.',
    'Ya existe un observador parcial.',
  ]);
  assert.ok(result.operationalGuidance.reuseWarnings.includes('Ya existe un observador parcial.'));
  assert.ok(result.operationalGuidance.remainingSteps.length <= 5);
  assert.ok(result.operationalGuidance.driftWarnings.length <= 3);
  assert.ok(result.operationalGuidance.reuseWarnings.length <= 3);
});

test('warns about Cliente Cero bias only when technical evidence exists', () => {
  const withoutEvidence = buildEcosystemObserver(fixture());
  assert.deepEqual(withoutEvidence.operationalGuidance.experienceWarnings, []);
  const withEvidence = buildEcosystemObserver(fixture({
    systemStateView: {
      ...fixture().systemStateView,
      alertsSummary: [{
        type: 'client-zero-bias',
        message: 'La decisión beneficia administración pero perjudica al usuario final.',
      }],
    },
  }));
  assert.deepEqual(withEvidence.operationalGuidance.experienceWarnings, [
    'La decisión beneficia administración pero perjudica al usuario final.',
  ]);
});

test('an alignment discrepancy creates attention without inventing tasks', () => {
  const input = fixture({
    projectStateView: {
      ...fixture().projectStateView,
      roadmapAlignment: 'attention',
      remainingSteps: [],
      nextRecommendedStep: '',
      driftEvidence: [],
    },
  });
  const guidance = buildEcosystemObserver(input).operationalGuidance;
  assert.deepEqual(guidance.remainingSteps, []);
  assert.equal(guidance.nextBestAction, '');
  assert.deepEqual(guidance.driftWarnings, [
    'Las fuentes vigentes presentan discrepancias de roadmap.',
  ]);
});

test('uses reasoned latency levels without percentages and covers every declared area', () => {
  const result = buildEcosystemObserver(fixture());
  assert.deepEqual(Object.keys(result.projectLatency), [...OBSERVED_AREAS]);
  assert.equal(result.projectLatency['OXKIO Core'], 'estable');
  assert.equal(result.projectLatency.Gmail, 'estable');
  assert.equal(result.projectLatency.Calendar, 'estable');
  assert.equal(result.projectLatency.Execution, 'no observado');
  assert.doesNotMatch(JSON.stringify(result.projectLatency), /%|\d+\.\d+/);
});

test('reports roadmap alignment only from explicit sanitized evidence', () => {
  assert.equal(buildEcosystemObserver(fixture()).roadmapAlignment, 'aligned');
  assert.equal(buildEcosystemObserver(fixture({
    projectStateView: { ...fixture().projectStateView, roadmapAlignment: 'attention' },
  })).roadmapAlignment, 'attention');
  assert.equal(buildEcosystemObserver(fixture({
    projectStateView: { ...fixture().projectStateView, roadmapAlignment: 'deviated' },
  })).ecosystemStatus.state, 'attention');
  assert.equal(buildEcosystemObserver({}).roadmapAlignment, 'unknown');
});

test('reports only evidenced risks from the closed risk vocabulary', () => {
  const result = buildEcosystemObserver(fixture({
    systemStateView: {
      ...fixture().systemStateView,
      alertsSummary: [
        { type: 'technical-debt', message: 'Falta cubrir el contrato móvil.' },
        { type: 'empty' },
      ],
    },
  }));
  assert.deepEqual(result.activeRisks, [
    { type: 'technical-debt', evidence: 'Falta cubrir el contrato móvil.' },
  ]);
  assert.deepEqual(buildEcosystemObserver(fixture()).activeRisks, []);
});

test('shows a relevant consolidated reminder briefly and without repetition', () => {
  const result = buildEcosystemObserver(fixture({
    governanceStateView: {
      ...fixture().governanceStateView,
      reminders: ['Reutilizar antes de desarrollar.'],
    },
  }));
  assert.deepEqual(result.reminders, ['Reutilizar antes de desarrollar.']);
});

test('is deterministic, immutable and does not mutate input', () => {
  const input = fixture({
    governanceStateView: {
      ...fixture().governanceStateView,
      reminders: ['Mantener readonly.'],
    },
  });
  const before = JSON.stringify(input);
  const first = buildEcosystemObserver(input);
  const second = buildEcosystemObserver(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.ecosystemStatus), true);
  assert.equal(Object.isFrozen(first.projectLatency), true);
  assert.equal(Object.isFrozen(first.activeRisks), true);
  assert.equal(Object.isFrozen(first.reminders), true);
  assert.equal(Object.isFrozen(first.operationalGuidance), true);
  assert.equal(Object.isFrozen(first.operationalGuidance.remainingSteps), true);
  assert.equal(Object.isFrozen(first.operationalGuidance.driftWarnings), true);
  assert.equal(Object.isFrozen(first.operationalGuidance.reuseWarnings), true);
  assert.equal(Object.isFrozen(first.operationalGuidance.experienceWarnings), true);
  assert.equal(Object.isFrozen(first.operationalGuidance.learnedLessons), true);
  assert.equal(Object.isFrozen(first.supervisorRecommendation), true);
  assert.equal(Object.isFrozen(first.supervisorRecommendation.evidence), true);
  assert.equal(Object.isFrozen(first.supervisorRecommendation.confidenceExplanation), true);
  assert.equal(
    Object.isFrozen(first.supervisorRecommendation.confidenceExplanation.supportingEvidence),
    true,
  );
  assert.equal(Object.isFrozen(first.strategicRecommendations), true);
  assert.equal(Object.isFrozen(first.sessionHistory), true);
  assert.equal(Object.isFrozen(first.auditAnswers), true);
  assert.equal(Object.isFrozen(first.blockStatus), true);
  assert.equal(Object.isFrozen(first.subphaseStatus), true);
  assert.equal(Object.isFrozen(first.releaseStatus), true);
  assert.equal(Object.isFrozen(first.consolidatedCapabilities), true);
  assert.equal(Object.isFrozen(first.intelligenceCommitteePreparation), true);
});

test('prepares the future intelligence committee without enabling models or execution', () => {
  assert.deepEqual(INTELLIGENCE_COMMITTEE_READINESS, {
    status: 'planned',
    externalModelsEnabled: false,
    executionEnabled: false,
  });
  assert.equal(Object.isFrozen(INTELLIGENCE_COMMITTEE_READINESS), true);
});

test('defines one readonly advisory supervisor with final human authority', () => {
  assert.deepEqual(ECOSYSTEM_SUPERVISOR_POLICY, {
    role: 'ecosystem-operational-supervisor',
    mode: 'readonly-advisory',
    decisionAuthority: 'human',
    recommendationPriority: 'very_high',
    executionEnabled: false,
  });
  assert.equal(Object.isFrozen(ECOSYSTEM_SUPERVISOR_POLICY), true);
  assert.equal(buildEcosystemObserver(fixture()).supervisorPolicy, ECOSYSTEM_SUPERVISOR_POLICY);
});

test('exposes the canonical session-only conversational recovery policy', () => {
  assert.deepEqual(CONVERSATIONAL_RECOVERY_POLICY, {
    source: 'executive-chat',
    retainedState: 'original-request-in-session',
    automaticSubmission: false,
    reuseFailedPreparation: false,
    executionEnabled: false,
  });
  assert.equal(Object.isFrozen(CONVERSATIONAL_RECOVERY_POLICY), true);
  assert.equal(
    buildEcosystemObserver(fixture()).conversationalRecoveryPolicy,
    CONVERSATIONAL_RECOVERY_POLICY,
  );
});

test('SystemStateManager supplies only the sanitized technical state view', () => {
  const manager = new SystemStateManager();
  manager.updateIntegration('gmail', 'connected', { token: 'secret' });
  manager.updateWorkflow('emailWorkflow', 'available', { payload: 'secret' });
  manager.addAlert('technical-debt', 'Revisar contrato.', { path: 'secret' });
  const view = manager.getPublicView();

  assert.deepEqual(Object.keys(view), [
    'state', 'integrationsSummary', 'workflowsSummary', 'alertsSummary',
  ]);
  assert.deepEqual(view.integrationsSummary, [{ name: 'gmail', status: 'connected' }]);
  assert.deepEqual(view.workflowsSummary, [{ name: 'emailWorkflow', status: 'available' }]);
  assert.deepEqual(view.alertsSummary, [{ type: 'technical-debt', message: 'Revisar contrato.' }]);
  assert.doesNotMatch(JSON.stringify(view), /secret|token|payload|updatedAt|id/);
  assert.equal(Object.isFrozen(view), true);
});

test('ProjectManagerService supplies project phase and roadmap without paths', () => {
  const view = ProjectManagerService.getProjectStateView('OXKIO');
  assert.deepEqual(Object.keys(view), [
    'project', 'blockPhase', 'activeSubphase', 'currentBlock', 'currentPhase', 'currentObjective',
    'roadmapAlignment', 'nextRecommendedStep', 'lastMilestone',
    'nextPlannedPhase', 'remainingSteps', 'doNotOpenYet', 'driftEvidence',
    'reuseEvidence', 'duplicationEvidence', 'sessionAchievements',
    'consolidatedCapabilities',
    'closureEvidence', 'sessionSummary',
  ]);
  assert.equal(view.project, 'OXKIO');
  assert.equal(view.blockPhase, '5C.7');
  assert.equal(view.activeSubphase, 'ninguna; apertura preparada y pendiente de autorización humana');
  assert.equal(view.currentBlock, 'Runtime Permanente e Infraestructura');
  assert.equal(view.currentPhase, '5C.7 — Runtime Permanente 24/7, preparada sin implementación');
  assert.equal(
    view.currentObjective,
    'Obtener autorización humana para abrir 5C.7 según su documento canónico de apertura.',
  );
  assert.notEqual(view.currentObjective, view.nextRecommendedStep);
  assert.equal(
    view.nextRecommendedStep,
    'Revisar la propuesta canónica de apertura de 5C.7.',
  );
  assert.equal(view.lastMilestone, '5C.6D.1 — Gmail Draft supervisado.');
  assert.equal(view.roadmapAlignment, 'attention');
  assert.equal(view.closureEvidence.manualPilot, true);
  assert.equal(view.closureEvidence.integration, true);
  assert.equal(view.closureEvidence.supervisorValidation, true);
  assert.equal(view.closureEvidence.commit, true);
  assert.equal(view.closureEvidence.publication, true);
  assert.deepEqual(view.remainingSteps, [
    'Revisar la propuesta canónica de apertura de 5C.7.',
    'Esperar autorización humana separada antes de implementar 5C.7.',
  ]);
  assert.ok(view.remainingSteps.length <= 5);
  assert.deepEqual(view.doNotOpenYet, [
    'Envío de Gmail.',
    'Calendar Execution.',
    'Automatizaciones y activación de otros agentes.',
  ]);
  assert.ok(view.duplicationEvidence.some((item) => /otro supervisor/i.test(item)));
  assert.equal(view.sessionAchievements.length, 5);
  assert.deepEqual(view.consolidatedCapabilities.slice(0, 3), [
    'Dashboard Intelligence',
    'Executive Summary',
    'Business Readonly',
  ]);
  assert.match(
    JSON.stringify(view.consolidatedCapabilities),
    /Gmail Draft supervisado bajo SAFE_DRAFT_ONLY/i,
  );
  assert.doesNotMatch(JSON.stringify(view), /[A-Za-z]:\\|path|ruta/i);

  const observer = buildEcosystemObserver({
    projectStateView: view,
    systemStateView: { health: 'stable', alertsSummary: [] },
    governanceStateView: {},
  });
  assert.equal(observer.operationalGuidance.phaseClosureStatus, 'ready_to_close');
  assert.deepEqual(observer.blockStatus, { phase: '5C.7', state: 'closed' });
  assert.deepEqual(observer.releaseStatus, { state: 'published' });
  assert.equal(
    observer.supervisorRecommendation.action,
    'Revisar la propuesta canónica de apertura de 5C.7.',
  );
  assert.equal(
    observer.operationalGuidance.nextBestAction,
    'Revisar la propuesta canónica de apertura de 5C.7.',
  );
  assert.equal(observer.progressMessage, '');
  assert.match(JSON.stringify(view.consolidatedCapabilities), /Gmail Draft supervisado/i);
});

test('ProjectManagerService marks conflicting canonical evidence as attention', () => {
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function readFileSyncWithStaleRoadmap(filePath, ...args) {
    const content = originalReadFileSync.call(fs, filePath, ...args);
    if (!String(filePath).endsWith(`${path.sep}orchestration${path.sep}ROADMAP.md`)) {
      return content;
    }
    return String(content).replace(
      'Siguiente paso recomendado: Repetir el piloto manual autenticado de Gmail Draft con Cliente Cero: aprobar dentro de la ventana, crear exactamente un borrador y verificar que no se envía.',
      'Siguiente paso recomendado: Abrir una fase no vigente.',
    );
  };

  try {
    assert.equal(ProjectManagerService.getProjectStateView('OXKIO').roadmapAlignment, 'attention');
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('canonical orchestration sources retain stale entries only as substituted history', () => {
  const roadmap = fs.readFileSync(path.join(__dirname, '../../../orchestration/ROADMAP.md'), 'utf8');
  const tasks = fs.readFileSync(path.join(__dirname, '../../../orchestration/TASKS.md'), 'utf8');
  const governanceRoadmap = fs.readFileSync(
    path.join(__dirname, '../../../XANTALAL/00_GOVERNANCE/MASTER-ROADMAP-XANTALAL.md'),
    'utf8',
  );
  const supervisorRules = fs.readFileSync(
    path.join(__dirname, '../../../XANTALAL/00_GOVERNANCE/SUPERVISOR-RULES-REGISTRY-V1.md'),
    'utf8',
  );
  assert.match(roadmap, /Historial sustituido/);
  assert.match(roadmap, /Fase 1 - Orquestación local/);
  assert.match(tasks, /Historial sustituido/);
  assert.match(tasks, /Crear Centro de Mando de Proyectos en Oxkio/);
  assert.match(governanceRoadmap, /Las auditorías futuras podrán comparar opiniones sanitizadas/);
  assert.match(governanceRoadmap, /Ninguna IA tendrá autoridad única/);
  assert.match(supervisorRules, /Ecosystem Observer es la proyeccion asesora readonly/);
  assert.match(supervisorRules, /SupervisorAgent conserva la coordinacion/);
  assert.match(supervisorRules, /OxkioSupervisor conserva el control humano/);
  assert.match(
    supervisorRules,
    /Una subfase abierta no implica que todo el bloque permanezca abierto/,
  );
  assert.match(supervisorRules, /Continuidad operativa y reutilizacion de evidencias/);
  assert.match(supervisorRules, /Recuperar el ultimo estado consistente conocido/);
  assert.match(supervisorRules, /Continuar antes que reiniciar/);
  assert.match(supervisorRules, /cambios en el codigo que invaliden las pruebas/);
});

test('Governance supplies only strategic objective, priority labels and brief reminders', () => {
  const view = readGovernanceStateView();
  assert.deepEqual(Object.keys(view), [
    'strategicObjective', 'priorities', 'reminders', 'learnedLessons',
    'continuityPolicy', 'canonicalReentryPolicy', 'strategicRecommendations',
  ]);
  assert.doesNotMatch(JSON.stringify(view), /sourcePath|documentsStatus|owner|description|DECISION-\d+/);
  assert.ok(view.priorities.length <= 5);
  assert.ok(view.reminders.length <= 2);
  assert.match(view.strategicObjective, /Director Ejecutivo IA readonly/);
  assert.match(view.continuityPolicy, /recuperar el ultimo estado consistente/i);
  assert.match(view.canonicalReentryPolicy, /historial de ChatGPT/i);
  assert.deepEqual(view.learnedLessons, [
    'Integrar antes de continuar.',
    'Reutilizar antes de crear.',
    'Evidencia antes que opinion.',
    'No depender de una unica IA.',
    'Auditar antes de cerrar.',
    'Actualizar primero las fuentes canonicas.',
    'No dejar capacidades desconectadas del ecosistema.',
  ]);
  assert.deepEqual(view.strategicRecommendations, [
    'Preparar el futuro Comité de Inteligencia sin habilitar modelos externos ni ejecución.',
  ]);
});

test('missing owner views fail closed without invented values', () => {
  const result = buildEcosystemObserver({ generatedAt: '2026-07-24T10:00:00.000Z' });
  assert.equal(result.ecosystemStatus.state, 'unknown');
  assert.equal(result.ecosystemStatus.project, '');
  assert.equal(result.currentBlock, '');
  assert.equal(result.currentPhase, '');
  assert.equal(result.currentObjective, '');
  assert.equal(result.strategicObjective, '');
  assert.equal(result.nextRecommendedStep, '');
  assert.deepEqual(result.activeRisks, []);
  assert.deepEqual(result.reminders, []);
  assert.deepEqual(result.operationalGuidance.remainingSteps, []);
  assert.equal(result.operationalGuidance.nextBestAction, '');
  assert.deepEqual(result.operationalGuidance.doNotOpenYet, []);
  assert.equal(result.supervisorRecommendation.confidence, 'unknown');
  assert.equal(result.supervisorRecommendation.advisoryOnly, true);
  assert.equal(result.intelligenceCommitteePreparation.executionEnabled, false);
  assert.deepEqual(result.strategicRecommendations, []);
  assert.deepEqual(result.sessionHistory.achievements, []);
  assert.deepEqual(result.auditAnswers.duplicationAvoided, []);
  assert.deepEqual(result.blockStatus, { phase: '', state: 'unknown' });
  assert.deepEqual(result.subphaseStatus, { phase: '', state: 'unknown' });
  assert.deepEqual(result.releaseStatus, { state: 'unknown' });
  assert.deepEqual(result.consolidatedCapabilities, []);
  assert.equal(result.progressMessage, '');
});

test('has no providers, stores, persistence, endpoints, scheduling or execution capabilities', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ecosystem-observer.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"][^'"]+['"]\)/);
  assert.doesNotMatch(source, /gmail-provider|calendar-provider|memory-engine|knowledge-store|googleapis|firebase|approvalQueue/i);
  assert.doesNotMatch(source, /fetch\(|https?:|writeFile|save|persist|setInterval|setTimeout|scheduler/);
  assert.doesNotMatch(source, /require\([^)]*(?:OperationsCoordinator|ExecutiveOrchestrator)/);
  assert.doesNotMatch(source, /\bexecute\s*\(|\brun[A-Z]\w*\s*\(/);
  assert.doesNotMatch(source, /Ecosystem Observer y fusión con fuentes propietarias|Cerrar el piloto y la auditoría/);
});
