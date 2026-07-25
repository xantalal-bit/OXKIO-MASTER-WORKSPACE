'use strict';

const MAX_TEXT = 200;
const MAX_ITEMS = 5;

const OBSERVED_AREAS = Object.freeze([
  'OXKIO Core',
  'Sistema Nervioso',
  'Executive Brain',
  'Readonly',
  'Preparation',
  'Approval',
  'Execution',
  'Business',
  'Knowledge',
  'Memory',
  'Gmail',
  'Calendar',
  'Biblioteca IA',
  'Comunicador',
  'Web Pública',
  'SEO',
  'Redes',
  'Monetización',
]);

const TECHNICAL_TEXT = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:worker|operationId|interactionId|executionPayload|payloadHash)\b)/i;

const INTELLIGENCE_COMMITTEE_READINESS = Object.freeze({
  status: 'planned',
  externalModelsEnabled: false,
  executionEnabled: false,
});

const ECOSYSTEM_SUPERVISOR_POLICY = Object.freeze({
  role: 'ecosystem-operational-supervisor',
  mode: 'readonly-advisory',
  decisionAuthority: 'human',
  recommendationPriority: 'very_high',
  executionEnabled: false,
});

function safeText(value, limit = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || TECHNICAL_TEXT.test(text)) return '';
  return text.slice(0, limit);
}

function safeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item)).filter(Boolean).slice(0, MAX_ITEMS);
}

function buildProjectLatency(systemStateView) {
  const source = systemStateView && typeof systemStateView === 'object' ? systemStateView : {};
  const latency = {};
  OBSERVED_AREAS.forEach((area) => {
    latency[area] = 'no observado';
  });
  const state = safeText(source.state, 40).toLowerCase();
  if (state === 'running') latency['OXKIO Core'] = 'estable';
  if (state && state !== 'running') latency['OXKIO Core'] = 'en desarrollo';

  const entries = [
    ...(Array.isArray(source.integrationsSummary) ? source.integrationsSummary : []),
    ...(Array.isArray(source.workflowsSummary) ? source.workflowsSummary : []),
  ];
  const areaNames = {
    gmail: 'Gmail',
    calendar: 'Calendar',
    memory: 'Memory',
    knowledge: 'Knowledge',
    business: 'Business',
    'executive brain': 'Executive Brain',
    readonly: 'Readonly',
    preparation: 'Preparation',
    approval: 'Approval',
    execution: 'Execution',
  };
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const name = safeText(entry.name, 80).toLowerCase().replace(/workflow$/, '').trim();
    const area = areaNames[name];
    if (!area) return;
    const status = safeText(entry.status, 40).toLowerCase();
    latency[area] = ['connected', 'available', 'active', 'ready'].includes(status)
      ? 'estable'
      : ['pending', 'queued'].includes(status)
        ? 'pendiente'
        : 'en desarrollo';
  });
  return Object.freeze(latency);
}

function evidenceRisks(input) {
  const risks = [];
  const system = input.systemStateView && typeof input.systemStateView === 'object'
    ? input.systemStateView : {};
  const alerts = Array.isArray(system.alertsSummary) ? system.alertsSummary : [];
  alerts.forEach((alert) => {
    if (!alert || typeof alert !== 'object' || risks.length >= MAX_ITEMS) return;
    const evidence = safeText(alert.message);
    if (!evidence) return;
    risks.push(Object.freeze({
      type: safeText(alert.type, 50) || 'system-alert',
      evidence,
    }));
  });
  return Object.freeze(risks.slice(0, MAX_ITEMS));
}

function relevantReminders(governanceStateView) {
  return Object.freeze(safeList(
    governanceStateView && governanceStateView.reminders,
  ).slice(0, 2));
}

function phaseClosureStatus(projectStateView, systemStateView) {
  const evidence = projectStateView && projectStateView.closureEvidence;
  const values = evidence && typeof evidence === 'object'
    ? [
      evidence.implementation,
      evidence.integration,
      evidence.tests,
      evidence.manualPilot,
      evidence.audit,
      evidence.documentation,
      evidence.observerAligned,
      evidence.supervisorValidation,
      evidence.stagingPrepared,
      evidence.commit,
      evidence.publication,
    ]
    : [];
  const alerts = systemStateView && Array.isArray(systemStateView.alertsSummary)
    ? systemStateView.alertsSummary
    : [];
  if (alerts.some((alert) => /^(?:blocking|phase-blocked)$/.test(
    safeText(alert && alert.type, 40).toLowerCase(),
  ))) return 'blocked';
  if (values.length === 0 || values.every((value) => value === null || value === undefined)) {
    return 'unknown';
  }
  if (values.every((value) => value === true)) return 'ready_to_close';
  return 'work_remaining';
}

function driftWarnings(projectStateView, systemStateView, alignment) {
  const warnings = safeList(projectStateView && projectStateView.driftEvidence);
  const acceptedAlertTypes = new Set([
    'roadmap-drift',
    'documentation-obsolete',
    'phase-overlap',
    'uncommitted-changes',
    'runtime-mixed',
    'priority-drift',
    'overengineering',
    'duplicate-capability',
    'client-zero-bias',
    'user-experience-risk',
  ]);
  const alerts = systemStateView && Array.isArray(systemStateView.alertsSummary)
    ? systemStateView.alertsSummary
    : [];
  alerts.forEach((alert) => {
    const type = safeText(alert && alert.type, 40).toLowerCase();
    const message = safeText(alert && alert.message);
    if (acceptedAlertTypes.has(type) && message) warnings.push(message);
  });
  if (alignment === 'attention' && warnings.length === 0) {
    warnings.push('Las fuentes vigentes presentan discrepancias de roadmap.');
  }
  return Object.freeze([...new Set(warnings)].slice(0, 3));
}

function experienceWarnings(systemStateView) {
  const alerts = systemStateView && Array.isArray(systemStateView.alertsSummary)
    ? systemStateView.alertsSummary
    : [];
  return Object.freeze(alerts
    .filter((alert) => /^(?:client-zero-bias|user-experience-risk)$/.test(
      safeText(alert && alert.type, 40).toLowerCase(),
    ))
    .map((alert) => safeText(alert && alert.message))
    .filter(Boolean)
    .slice(0, 3));
}

const CLOSURE_EVIDENCE_LABELS = Object.freeze([
  ['implementation', 'Implementación'],
  ['integration', 'Integración'],
  ['tests', 'Pruebas'],
  ['manualPilot', 'Piloto'],
  ['audit', 'Auditoría'],
  ['documentation', 'Documentación canónica'],
  ['observerAligned', 'Observer alineado'],
  ['supervisorValidation', 'Validación del Supervisor'],
  ['stagingPrepared', 'Staging selectivo'],
  ['commit', 'Commit'],
  ['publication', 'Publicación'],
]);

function recommendationConfidence(projectStateView, alignment, closureStatus) {
  const hasAction = Boolean(safeText(projectStateView && projectStateView.nextRecommendedStep));
  const hasContext = Boolean(
    safeText(projectStateView && projectStateView.currentPhase)
      && safeText(projectStateView && projectStateView.currentObjective),
  );
  if (!hasAction || !hasContext || closureStatus === 'unknown') return 'unknown';
  const closureEvidence = projectStateView && projectStateView.closureEvidence;
  const closureValues = CLOSURE_EVIDENCE_LABELS.map(([key]) => (
    closureEvidence && closureEvidence[key]
  ));
  return alignment === 'aligned' && closureValues.every((value) => value === true)
    ? 'high'
    : closureValues.some((value) => value === true)
      ? 'medium'
      : 'unknown';
}

function confidenceExplanation(projectStateView, alignment, confidence) {
  const closureEvidence = projectStateView && projectStateView.closureEvidence;
  const supportingEvidence = [];
  const missingEvidence = [];
  CLOSURE_EVIDENCE_LABELS.forEach(([key, label]) => {
    const value = closureEvidence && closureEvidence[key];
    if (value === true) supportingEvidence.push(`${label}: completado`);
    if (value === false) missingEvidence.push(`${label}: pendiente`);
  });
  if (alignment === 'aligned') supportingEvidence.push('Roadmap: alineado');
  if (alignment === 'attention' || alignment === 'deviated' || alignment === 'at-risk') {
    missingEvidence.push('Roadmap: requiere atención');
  }
  if (alignment === 'unknown') missingEvidence.push('Roadmap: evidencia insuficiente');
  return Object.freeze({
    level: confidence,
    supportingEvidence: Object.freeze(supportingEvidence.slice(0, 5)),
    missingEvidence: Object.freeze(missingEvidence.slice(0, 5)),
  });
}

function buildSupervisorRecommendation(projectStateView, alignment, guidance) {
  const action = safeText(projectStateView.nextRecommendedStep);
  const evidence = [
    safeText(projectStateView.currentPhase),
    safeText(projectStateView.currentObjective),
    safeText(projectStateView.lastMilestone),
    alignment === 'unknown' ? '' : alignment,
    guidance.phaseClosureStatus === 'unknown' ? '' : guidance.phaseClosureStatus,
  ].filter(Boolean).slice(0, MAX_ITEMS);
  const rationale = guidance.driftWarnings[0]
    || safeText(projectStateView.currentObjective);
  const confidence = recommendationConfidence(
    projectStateView,
    alignment,
    guidance.phaseClosureStatus,
  );

  return Object.freeze({
    type: 'operational',
    action,
    rationale,
    evidence: Object.freeze(evidence),
    confidence,
    confidenceExplanation: confidenceExplanation(projectStateView, alignment, confidence),
    priority: action ? 'very_high' : 'unknown',
    advisoryOnly: true,
    humanDecisionRequired: true,
  });
}

function buildStrategicRecommendations(governanceStateView) {
  const strategicObjective = safeText(governanceStateView && governanceStateView.strategicObjective);
  const recommendations = safeList(
    governanceStateView && governanceStateView.strategicRecommendations,
  ).slice(0, 3);
  return Object.freeze(recommendations.map((action) => Object.freeze({
    type: 'strategic',
    action,
    evidence: Object.freeze(strategicObjective ? [strategicObjective] : []),
    confidence: strategicObjective ? 'medium' : 'unknown',
  })));
}

function buildSessionHistory(projectStateView, nextBestAction) {
  return Object.freeze({
    achievements: Object.freeze(safeList(projectStateView && projectStateView.sessionAchievements)),
    nextAction: safeText(nextBestAction),
  });
}

function buildAuditAnswers(projectStateView, guidance) {
  return Object.freeze({
    reused: Object.freeze(safeList(projectStateView && projectStateView.reuseEvidence)),
    duplicationAvoided: Object.freeze(
      safeList(projectStateView && projectStateView.duplicationEvidence),
    ),
    remainingToClose: guidance.remainingSteps,
    nextHighestImpactAction: safeText(guidance.nextBestAction),
  });
}

function releaseStateFor(projectStateView) {
  const evidence = projectStateView && projectStateView.closureEvidence;
  if (!evidence || typeof evidence !== 'object') return 'unknown';
  if (evidence.publication === true) return 'published';
  if (evidence.publication === false) return 'pending';
  return 'unknown';
}

function blockStateFor(blockPhase, subphaseState, releaseState) {
  if (!blockPhase || subphaseState === 'unknown') return 'unknown';
  if (subphaseState === 'work_remaining' || subphaseState === 'blocked') return 'in_progress';
  if (subphaseState === 'ready_to_close' && releaseState === 'published') return 'closed';
  if (subphaseState === 'ready_to_close') return 'ready_to_close';
  return 'unknown';
}

function buildProgressMessage(
  phaseClosureStatusValue,
  consolidatedCapabilities,
  activeSubphase,
  remainingSteps,
) {
  if (phaseClosureStatusValue !== 'work_remaining') return '';
  const parts = ['El bloque continúa avanzando correctamente.'];
  if (consolidatedCapabilities.length > 0) {
    parts.push(
      `Las siguientes capacidades ya forman parte estable del ecosistema: ${consolidatedCapabilities.join(', ')}.`,
    );
  }
  if (activeSubphase) parts.push(`La subfase actualmente abierta es: ${activeSubphase}.`);
  if (remainingSteps.length > 0) parts.push(`Solo falta: ${remainingSteps.join('; ')}.`);
  return parts.join(' ');
}

function buildIntelligenceCommitteePreparation(
  projectStateView,
  governanceStateView,
  risks,
  guidance,
  recommendation,
) {
  const riskEvidence = [
    ...risks.map((risk) => safeText(risk && risk.evidence)),
    ...guidance.driftWarnings,
    ...guidance.experienceWarnings,
  ].filter(Boolean).slice(0, MAX_ITEMS);
  return Object.freeze({
    ...INTELLIGENCE_COMMITTEE_READINESS,
    context: safeText(projectStateView.sessionSummary)
      || safeText(projectStateView.currentObjective),
    evidence: recommendation.evidence,
    risks: Object.freeze(riskEvidence),
    alternatives: Object.freeze(guidance.reuseWarnings.slice(0, 3)),
    confidence: recommendation.confidence,
    authority: 'human',
  });
}

function reuseWarnings(projectStateView, governanceStateView, systemStateView) {
  const warnings = safeList(projectStateView && projectStateView.reuseEvidence);
  const reminders = safeList(governanceStateView && governanceStateView.reminders)
    .filter((item) => /reutiliz|complet|fusion|existente|duplic/i.test(item));
  const alerts = systemStateView && Array.isArray(systemStateView.alertsSummary)
    ? systemStateView.alertsSummary
    : [];
  alerts.forEach((alert) => {
    const type = safeText(alert && alert.type, 40).toLowerCase();
    const message = safeText(alert && alert.message);
    if (type === 'duplicate-capability' && message) warnings.push(message);
  });
  return Object.freeze([...new Set([...warnings, ...reminders])].slice(0, 3));
}

function buildOperationalGuidance(projectStateView, governanceStateView, systemStateView, alignment) {
  const closureStatus = phaseClosureStatus(projectStateView, systemStateView);
  const remainingSteps = Object.freeze(safeList(projectStateView.remainingSteps));
  const nextBestAction = safeText(projectStateView.nextRecommendedStep);
  const explicitDoNotOpen = safeList(projectStateView.doNotOpenYet);
  const nextPhase = safeText(projectStateView.nextPlannedPhase);
  const doNotOpenYet = closureStatus === 'ready_to_close'
    ? []
    : explicitDoNotOpen.length > 0
      ? explicitDoNotOpen
      : nextPhase
        ? [nextPhase]
        : [];

  return Object.freeze({
    phaseClosureStatus: closureStatus,
    remainingSteps,
    nextBestAction,
    doNotOpenYet: Object.freeze(doNotOpenYet.slice(0, MAX_ITEMS)),
    driftWarnings: driftWarnings(projectStateView, systemStateView, alignment),
    reuseWarnings: reuseWarnings(projectStateView, governanceStateView, systemStateView),
    experienceWarnings: experienceWarnings(systemStateView),
    learnedLessons: Object.freeze(
      (Array.isArray(governanceStateView && governanceStateView.learnedLessons)
        ? governanceStateView.learnedLessons
        : [])
        .map((lesson) => safeText(lesson))
        .filter(Boolean)
        .slice(0, 10),
    ),
    sessionSummary: safeText(projectStateView.sessionSummary),
  });
}

function alignmentFor(projectStateView) {
  const value = safeText(projectStateView.roadmapAlignment, 40).toLowerCase();
  if (value === 'aligned') return 'aligned';
  if (value === 'attention') return 'attention';
  if (value === 'deviated') return 'deviated';
  if (value === 'at-risk') return 'at-risk';
  return 'unknown';
}

function ecosystemStatusFor(systemStateView, alignment, risks) {
  const state = safeText(systemStateView.state, 30).toLowerCase();
  if (alignment === 'attention' || alignment === 'deviated' || risks.length > 0) return 'attention';
  if (state === 'running' && alignment !== 'at-risk') return 'stable';
  if (state || alignment === 'at-risk') return 'watch';
  return 'unknown';
}

function buildEcosystemObserver(input = {}) {
  const systemStateView = input.systemStateView && typeof input.systemStateView === 'object'
    ? input.systemStateView : {};
  const projectStateView = input.projectStateView && typeof input.projectStateView === 'object'
    ? input.projectStateView : {};
  const governanceStateView = input.governanceStateView && typeof input.governanceStateView === 'object'
    ? input.governanceStateView : {};
  const risks = evidenceRisks(input);
  const alignment = alignmentFor(projectStateView);
  const generatedAt = typeof input.generatedAt === 'string' && Number.isFinite(Date.parse(input.generatedAt))
    ? new Date(input.generatedAt).toISOString()
    : null;
  const status = ecosystemStatusFor(systemStateView, alignment, risks);
  const operationalGuidance = buildOperationalGuidance(
    projectStateView,
    governanceStateView,
    systemStateView,
    alignment,
  );
  const supervisorRecommendation = buildSupervisorRecommendation(
    projectStateView,
    alignment,
    operationalGuidance,
  );
  const strategicRecommendations = buildStrategicRecommendations(governanceStateView);
  const sessionHistory = buildSessionHistory(
    projectStateView,
    supervisorRecommendation.action,
  );
  const auditAnswers = buildAuditAnswers(projectStateView, operationalGuidance);
  const blockPhase = safeText(projectStateView.blockPhase, 40);
  const activeSubphase = safeText(projectStateView.activeSubphase, 40);
  const releaseState = releaseStateFor(projectStateView);
  const consolidatedCapabilities = Object.freeze(
    (Array.isArray(projectStateView.consolidatedCapabilities)
      ? projectStateView.consolidatedCapabilities
      : [])
      .map((capability) => safeText(capability, 100))
      .filter(Boolean)
      .slice(0, 20),
  );
  const blockStatus = Object.freeze({
    phase: blockPhase,
    state: blockStateFor(
      blockPhase,
      operationalGuidance.phaseClosureStatus,
      releaseState,
    ),
  });
  const subphaseStatus = Object.freeze({
    phase: activeSubphase,
    state: operationalGuidance.phaseClosureStatus,
  });
  const releaseStatus = Object.freeze({ state: releaseState });
  const progressMessage = buildProgressMessage(
    operationalGuidance.phaseClosureStatus,
    consolidatedCapabilities,
    activeSubphase,
    operationalGuidance.remainingSteps,
  );
  const intelligenceCommitteePreparation = buildIntelligenceCommitteePreparation(
    projectStateView,
    governanceStateView,
    risks,
    operationalGuidance,
    supervisorRecommendation,
  );

  return Object.freeze({
    supervisorPolicy: ECOSYSTEM_SUPERVISOR_POLICY,
    ecosystemStatus: Object.freeze({
      state: status,
      project: safeText(projectStateView.project),
      lastMilestone: safeText(projectStateView.lastMilestone),
      lastCommit: '',
    }),
    currentBlock: safeText(projectStateView.currentBlock),
    currentPhase: safeText(projectStateView.currentPhase),
    currentObjective: safeText(projectStateView.currentObjective),
    strategicObjective: safeText(governanceStateView.strategicObjective),
    roadmapAlignment: alignment,
    projectLatency: buildProjectLatency(systemStateView),
    activeRisks: risks,
    nextRecommendedStep: safeText(projectStateView.nextRecommendedStep),
    reminders: relevantReminders(governanceStateView),
    operationalGuidance,
    supervisorRecommendation,
    strategicRecommendations,
    sessionHistory,
    auditAnswers,
    blockStatus,
    subphaseStatus,
    releaseStatus,
    consolidatedCapabilities,
    progressMessage,
    intelligenceCommitteePreparation,
    generatedAt,
  });
}

module.exports = {
  ECOSYSTEM_SUPERVISOR_POLICY,
  INTELLIGENCE_COMMITTEE_READINESS,
  OBSERVED_AREAS,
  buildEcosystemObserver,
};
