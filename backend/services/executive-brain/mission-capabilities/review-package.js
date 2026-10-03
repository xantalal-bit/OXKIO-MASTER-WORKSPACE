'use strict';

// XATAI CORE V2.1: the result a human reviews ("LISTO PARA REVISIÓN"). Built
// only from tasks the engine verified (COMPLETED, output bound by digest),
// so it can never show an unverified claim. Facts, inferences and
// recommendations stay labelled; evidence says what is real and what came
// from a fixture. Nothing here sends, approves or executes.

const REVIEW_DECISIONS = Object.freeze(['APROBAR', 'MODIFICAR', 'DESCARTAR']);

function stageData(state, key) {
  const task = state.tasks.find((item) => item.key === key && item.status === 'COMPLETED' && typeof item.output === 'string');
  if (!task) return null;
  try { return JSON.parse(task.output); } catch (error) { return null; }
}

function buildCommercialReview(state, { describeSource = () => null } = {}) {
  const research = stageData(state, 'company-research');
  const analysis = stageData(state, 'analysis');
  const opportunities = stageData(state, 'opportunities');
  const proposal = stageData(state, 'proposal');
  const communication = stageData(state, 'communication');
  const handoff = state.tasks.find((item) => item.key === 'human-review');
  const ready = Boolean(analysis && opportunities && proposal && communication)
    && state.engine.state === 'NEEDS_APPROVAL' && handoff && handoff.status === 'NEEDS_APPROVAL';

  const facts = analysis ? analysis.facts : [];
  const sourceRefs = [...new Set(facts.map((fact) => fact.sourceRef))];
  // Tasks that stopped the mission (not the ones merely waiting behind them).
  const blocking = state.tasks.filter((item) => !['COMPLETED', 'SKIPPED', 'PLANNED'].includes(item.status) && item.key !== 'human-review')
    .map((item) => {
      const attempts = (state.attempts && state.attempts[item.taskId]) || [];
      const last = attempts[attempts.length - 1];
      return { task: item.key, status: item.status, reason: item.gate.reason, lastFailure: last ? last.failureCode || last.failureKind : null };
    });

  // One concrete question when OXKIO cannot resolve the block by itself.
  const researchBlock = blocking.find((item) => item.task === 'company-research');
  const questionForHuman = researchBlock
    ? `No he podido leer la web oficial indicada (${researchBlock.lastFailure || researchBlock.reason}). ¿Es correcta la dirección?`
    : null;

  return Object.freeze({
    status: ready ? 'LISTO PARA REVISIÓN' : 'NO LISTO',
    blocking,
    questionForHuman,
    company: research ? research.company : null,
    summary: communication ? communication.executiveSummary : null,
    dossier: facts.map((fact) => ({ label: 'FACT', statement: fact.statement, excerpt: fact.excerpt, source: fact.sourceUrl })),
    flaggedContent: analysis ? analysis.flaggedFactIds : [],
    contradictions: analysis ? analysis.contradictions : [],
    opportunities: {
      observed: (opportunities ? opportunities.opportunities : []).filter((item) => item.level === 'OBSERVED'),
      inferred: (opportunities ? opportunities.opportunities : []).filter((item) => item.level === 'INFERENCE'),
    },
    proposal,
    draft: communication ? { ...communication.email, sent: false } : null,
    otherDrafts: communication ? {
      shortMessage: communication.shortMessage, followUp: communication.followUp, salesBriefing: communication.salesBriefing,
    } : null,
    evidence: sourceRefs.map((ref) => ({ ref, ...(describeSource(ref) || { origin: 'unknown' }) })),
    // Skipped optional sources are already declared by the analysis agent.
    uncertainties: opportunities ? opportunities.uncertainties : [],
    skippedSources: state.tasks.filter((item) => item.status === 'SKIPPED').map((item) => ({ task: item.key, reason: item.gate.reason })),
    proposedAction: proposal ? proposal.nextAction : null,
    recommendation: proposal ? proposal.recommendation : null,
    decisions: REVIEW_DECISIONS,
    verification: state.verification ? state.verification.verdict : null,
    estimatedCostUsd: state.estimatedSpentUsd,
    actualCostUsd: state.actualSpentUsd,
    executionEnabled: false,
  });
}

module.exports = { REVIEW_DECISIONS, buildCommercialReview };
