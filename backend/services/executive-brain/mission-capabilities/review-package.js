'use strict';

const { FACT_LABELS, exactCopyError } = require('./semantic-canon');

// XATAI CORE V2.1: the result a human reviews ("LISTO PARA REVISIÓN"). Built
// only from tasks the engine verified (COMPLETED, output bound by digest),
// so it can never show an unverified claim. Facts, inferences and
// recommendations stay labelled; evidence says what is real and what came
// from a fixture. Nothing here sends, approves or executes.

const REVIEW_DECISIONS = Object.freeze(['APROBAR', 'MODIFICAR', 'DESCARTAR']);
const FAILURE_TEXT = Object.freeze({
  network_error: 'no responde', timeout: 'no responde a tiempo', dns_failed: 'el dominio no existe o no resuelve',
  robots_unavailable: 'no responde (ni siquiera su robots.txt)', robots_disallowed: 'su robots.txt no permite leerla',
  off_site_redirect: 'redirige fuera del dominio oficial', off_site_url: 'la dirección está fuera del dominio oficial',
  private_address: 'apunta a una red privada', url_not_allowed: 'la dirección no es una web pública HTTPS válida',
  unsupported_content_type: 'no devuelve una página web', too_large: 'la página es demasiado grande',
});

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
  // Integrity of the inputs: every opportunity the proposal carries must be
  // an exact copy (all traced fields present and equal) of a verified one.
  const origins = new Map((opportunities ? opportunities.opportunities : []).map((item) => [item.id, item]));
  const integrityErrors = (proposal ? proposal.opportunities : [])
    .map((item) => exactCopyError(item, origins.get(item.opportunityId))).filter(Boolean);
  // Facts: the statement must be exactly what the canon writes for its label
  // and excerpt, and the same fact id must be identical in every stage.
  const seenFacts = new Map();
  for (const data of [research, analysis, opportunities, proposal, communication]) {
    for (const fact of (data && Array.isArray(data.facts) ? data.facts : [])) {
      const spec = FACT_LABELS[fact.label];
      if (!spec || fact.kind !== 'FACT' || spec.category !== fact.category || spec.render(fact.excerpt) !== fact.statement) {
        integrityErrors.push('altered_fact');
        continue;
      }
      const previous = seenFacts.get(fact.id);
      if (previous && previous !== JSON.stringify(fact)) integrityErrors.push('altered_fact');
      seenFacts.set(fact.id, JSON.stringify(fact));
    }
  }
  const ready = integrityErrors.length === 0 && Boolean(analysis && opportunities && proposal && communication)
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
  const code = researchBlock ? researchBlock.lastFailure || researchBlock.reason : null;
  const questionForHuman = researchBlock
    ? `No he podido leer la web oficial indicada: ${FAILURE_TEXT[code] || (String(code).startsWith('http_') ? 'responde con un error HTTP' : 'no se ha podido leer')} (${code}). ¿Es correcta la dirección?`
    : null;

  return Object.freeze({
    status: ready ? 'LISTO PARA REVISIÓN' : 'NO LISTO',
    blocking: integrityErrors.length > 0 ? [...blocking, { task: 'proposal', status: 'INTEGRITY', reason: integrityErrors[0], lastFailure: null }] : blocking,
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
    // Contact decision first: with no backed opportunity there is no draft
    // and nothing that could be sent.
    contact: !communication
      ? { decision: 'NO CONTACTAR TODAVÍA', reason: 'La misión no ha llegado a la fase de comunicación.' }
      : (communication.contactDecision === 'REVIEW_AND_CONTACT'
        ? { decision: 'CONTACTO PROPUESTO PARA REVISIÓN', reason: null }
        : { decision: 'NO CONTACTAR TODAVÍA', reason: communication.internalBriefing ? communication.internalBriefing.reason : null }),
    draft: communication && communication.contactDecision === 'REVIEW_AND_CONTACT' && communication.email
      ? { ...communication.email, sent: false } : null,
    otherDrafts: communication && communication.contactDecision === 'REVIEW_AND_CONTACT' ? {
      shortMessage: communication.shortMessage, followUp: communication.followUp, salesBriefing: communication.salesBriefing,
    } : null,
    internalBriefing: communication ? communication.internalBriefing || null : null,
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
