'use strict';

const crypto = require('crypto');
const { createExecutiveRuntime } = require('../runtime/executive-runtime-factory');
const { runBusinessHunterConnector } = require('../knowledge/connectors/business-hunter-connector');
const ProposalEngine = require('../../core/proposalEngine');

const WORKER_NAME = 'business-hunter-readonly';
const OPERATION_MODE = 'manual';
const DEFAULT_TIMEOUT_MS = 7000;
const MAX_OPPORTUNITIES = 10;
const MAX_RECOMMENDATIONS = 5;

function createEmptyState() {
  return {
    currentOperation: null,
    lastOperation: null,
    lastResult: null,
    lastError: null,
  };
}

function normalizeText(value, maxLength = 240) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function clonePlainValue(value) {
  if (Array.isArray(value)) {
    return value.map(clonePlainValue);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((copy, [key, item]) => {
      copy[key] = clonePlainValue(item);
      return copy;
    }, {});
  }

  return value;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

function safeUuid() {
  return crypto.randomUUID();
}

function safeDurationMs(startedAt, completedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return Math.max(0, end - start);
}

function sanitizeIssueMessage(error) {
  if (error && error.code === 'business_hunter_timeout') {
    return 'Business Hunter readonly cycle timed out.';
  }

  return 'Business Hunter readonly failed.';
}

function sanitizeOpportunity(opportunity, index) {
  if (!opportunity || typeof opportunity !== 'object') {
    return null;
  }

  const id = normalizeText(opportunity.id || opportunity.identityId || `opportunity-${index + 1}`, 120);
  const title = normalizeText(opportunity.title || opportunity.type || 'Oportunidad', 120) || 'Oportunidad';
  const summary = normalizeText(opportunity.summary || opportunity.description || 'Elemento relevante detectado en Business Hunter.', 220);
  const source = normalizeText(opportunity.source || 'knowledge-pipeline', 80) || 'knowledge-pipeline';
  const confidence = Number.isFinite(Number(opportunity.confidence))
    ? Number(opportunity.confidence)
    : null;
  const evidenceCount = Number.isFinite(Number(opportunity.evidenceCount))
    ? Math.max(0, Math.min(10, Number(opportunity.evidenceCount)))
    : 0;

  return freezeDeep({
    id,
    kind: opportunity.kind === 'documentary_evidence'
      ? 'documentary_evidence'
      : 'commercial_opportunity',
    title,
    summary,
    confidence,
    evidenceCount,
    source,
  });
}

function sanitizeOperationLog(operation) {
  if (!operation || typeof operation !== 'object') {
    return null;
  }

  return freezeDeep(clonePlainValue({
    operationId: operation.operationId,
    interactionId: operation.interactionId,
    worker: operation.worker,
    mode: operation.mode,
    status: operation.status,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    durationMs: operation.durationMs,
    sourceStatus: operation.sourceStatus,
    summary: operation.summary,
    opportunities: operation.opportunities,
    opportunitiesCount: Array.isArray(operation.opportunities) ? operation.opportunities.length : 0,
    recommendations: operation.recommendations,
    proposalCreated: operation.proposalCreated,
    approvalId: operation.approvalId,
    errors: operation.errors,
  }));
}

function buildSourceStatus(findings, opportunities) {
  if (!findings || findings.found !== true) {
    return 'unavailable';
  }

  const pipeline = findings.pipeline && typeof findings.pipeline === 'object'
    ? findings.pipeline
    : null;
  const knowledgeObjects = pipeline && Array.isArray(pipeline.knowledgeObjects)
    ? pipeline.knowledgeObjects
    : [];

  if (knowledgeObjects.length > 0) {
    return 'real';
  }

  return Array.isArray(opportunities) && opportunities.length > 0 ? 'real' : 'partial';
}

function buildSummary(sourceStatus, opportunities) {
  if (sourceStatus === 'unavailable') {
    return 'Business Hunter no está disponible en el inventario local.';
  }

  if (sourceStatus === 'partial') {
    return 'Business Hunter está identificado, pero la evidencia local todavía es parcial.';
  }

  const count = Array.isArray(opportunities) ? opportunities.length : 0;

  return count > 0
    ? `Business Hunter local ha devuelto ${count} evidencia${count === 1 ? '' : 's'} documental${count === 1 ? '' : 'es'} sanitizada${count === 1 ? '' : 's'}; no son leads comerciales.`
    : 'Business Hunter está disponible, pero no ha devuelto evidencia comercial estructurada.';
}

function buildRecommendations(sourceStatus, opportunities) {
  const recommendations = [];

  if (sourceStatus === 'real' && Array.isArray(opportunities) && opportunities.length > 0) {
    recommendations.push('Revisar la evidencia documental sanitizada antes de cualquier análisis comercial posterior.');
    recommendations.push('No tratar la evidencia documental como empresas o leads ni contactar a terceros.');
  } else if (sourceStatus === 'partial') {
    recommendations.push('Completar el inventario local de Business Hunter antes de profundizar.');
  } else {
    recommendations.push('Localizar o registrar la carpeta oficial de Business Hunter en el inventario local.');
  }

  return freezeDeep(recommendations.slice(0, MAX_RECOMMENDATIONS).map((entry) => normalizeText(entry, 240)));
}

function buildOpportunities(findings) {
  const pipeline = findings && findings.pipeline && typeof findings.pipeline === 'object'
    ? findings.pipeline
    : null;
  const knowledgeObjects = pipeline && Array.isArray(pipeline.knowledgeObjects)
    ? pipeline.knowledgeObjects
    : [];
  const opportunities = [];

  knowledgeObjects.slice(0, MAX_OPPORTUNITIES).forEach((knowledgeObject, index) => {
    const classification = knowledgeObject
      && knowledgeObject.metadata
      && knowledgeObject.metadata.documentTypeClassification
      ? knowledgeObject.metadata.documentTypeClassification
      : {};
    const structure = knowledgeObject
      && knowledgeObject.metadata
      && knowledgeObject.metadata.documentStructure
      ? knowledgeObject.metadata.documentStructure
      : {};
    const headings = Array.isArray(structure.headings) ? structure.headings.length : 0;

    opportunities.push({
      id: normalizeText(
        knowledgeObject && (knowledgeObject.id || knowledgeObject.identity && knowledgeObject.identity.id)
          ? (knowledgeObject.id || knowledgeObject.identity.id)
          : `knowledge-object-${index + 1}`,
        120,
      ),
      kind: 'documentary_evidence',
      title: normalizeText(
        `Evidencia documental: ${classification.type || 'documento relevante'}`,
        120,
      ) || 'Evidencia documental',
      summary: normalizeText(
        `${classification.type || 'Documento'} identificado en el inventario local; no representa una empresa ni un lead comercial.`,
        220,
      ),
      confidence: Number.isFinite(Number(classification.confidence))
        ? Number(classification.confidence)
        : null,
      evidenceCount: headings,
      source: 'knowledge-pipeline',
    });
  });

  return opportunities;
}

function buildOperationResult(operation, findings) {
  const sanitizedOpportunities = freezeDeep(
    buildOpportunities(findings)
      .slice(0, MAX_OPPORTUNITIES)
      .map(sanitizeOpportunity)
      .filter(Boolean),
  );
  const sourceStatus = buildSourceStatus(findings, sanitizedOpportunities);
  const summary = buildSummary(sourceStatus, sanitizedOpportunities);
  const recommendations = buildRecommendations(sourceStatus, sanitizedOpportunities);
  const completedAt = new Date().toISOString();
  const durationMs = safeDurationMs(operation.startedAt, completedAt);
  const status = sourceStatus === 'real'
    ? 'completed'
    : 'completed_with_warnings';

  return sanitizeOperationLog({
    ...operation,
    completedAt,
    durationMs,
    status,
    sourceStatus,
    summary,
    opportunities: sanitizedOpportunities,
    recommendations,
    proposalCreated: false,
    approvalId: null,
    errors: freezeDeep([]),
  });
}

function createTimeoutError(timeoutMs) {
  const error = new Error(`Business Hunter readonly cycle timed out after ${timeoutMs}ms.`);
  error.code = 'business_hunter_timeout';
  return error;
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function buildProposalPreview(result, dependencies = {}) {
  const proposalEngine = dependencies.proposalEngine || new ProposalEngine();

  if (!proposalEngine || typeof proposalEngine.generate !== 'function') {
    return null;
  }

  try {
    const proposal = proposalEngine.generate({
      message: 'Business Hunter readonly summary.',
      analysis: {
        intent: 'business',
        urgency: 'normal',
        requiresApproval: true,
      },
      decision: {
        recommendation: result.summary,
        requiresApproval: true,
      },
    });

    if (!proposal || proposal.type !== 'general') {
      return null;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function createBusinessHunterReadonlyService(dependencies = {}) {
  let state = createEmptyState();
  let lock = false;

  async function runBusinessHunterReadonly(options = {}) {
    if (lock) {
      const error = new Error('Business Hunter readonly cycle already running.');
      error.code = 'business_hunter_operation_in_progress';
      throw error;
    }

    lock = true;
    const startedAt = new Date().toISOString();
    const operation = freezeDeep({
      operationId: safeUuid(),
      interactionId: safeUuid(),
      worker: WORKER_NAME,
      mode: OPERATION_MODE,
      status: 'running',
      startedAt,
      completedAt: null,
      durationMs: null,
      sourceStatus: 'unavailable',
      summary: 'Business Hunter readonly cycle started.',
      opportunities: freezeDeep([]),
      recommendations: freezeDeep([]),
      proposalCreated: false,
      approvalId: null,
      errors: freezeDeep([]),
    });
    let runtime = null;

    state = {
      ...state,
      currentOperation: operation,
      lastError: null,
    };

    try {
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
      const createRuntime = dependencies.createExecutiveRuntime || createExecutiveRuntime;
      const connector = dependencies.runBusinessHunterConnector || runBusinessHunterConnector;

      runtime = createRuntime({ mode: 'sandbox' });

      const findings = await withTimeout(
        Promise.resolve().then(() => connector({
          assetName: 'Business Hunter',
          root: options.root,
          searchRoots: options.searchRoots,
          persist: false,
        })),
        timeoutMs,
      );

      const result = buildOperationResult(operation, findings || {});
      const proposalPreview = buildProposalPreview(result, dependencies);
      const finalResult = proposalPreview
        ? sanitizeOperationLog({
          ...result,
          proposalCreated: true,
        })
        : result;

      state = {
        currentOperation: null,
        lastOperation: finalResult,
        lastResult: finalResult,
        lastError: null,
      };

      return finalResult;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const failedOperation = sanitizeOperationLog({
        ...operation,
        completedAt,
        durationMs: safeDurationMs(startedAt, completedAt),
        status: error && error.code === 'business_hunter_timeout'
          ? 'failed'
          : 'failed',
        sourceStatus: 'unavailable',
        summary: 'Business Hunter readonly cycle failed.',
        opportunities: freezeDeep([]),
        recommendations: freezeDeep(['Revisar el inventario local antes de reintentar.']),
        proposalCreated: false,
        approvalId: null,
        errors: freezeDeep([sanitizeIssueMessage(error)]),
      });

      state = {
        currentOperation: null,
        lastOperation: failedOperation,
        lastResult: null,
        lastError: freezeDeep({
          code: error && error.code ? String(error.code) : 'business_hunter_failed',
          message: sanitizeIssueMessage(error),
          operationId: operation.operationId,
          interactionId: operation.interactionId,
        }),
      };

      throw Object.assign(new Error(state.lastError.message), {
        code: state.lastError.code,
      });
    } finally {
      lock = false;
      if (runtime && typeof runtime.cleanup === 'function') {
        try {
          runtime.cleanup();
        } catch (cleanupError) {
          // Ignore cleanup failures in readonly mode.
        }
      }
    }
  }

  function getStatus() {
    const current = state.currentOperation ? clonePlainValue(state.currentOperation) : null;
    const lastOperation = state.lastOperation ? clonePlainValue(state.lastOperation) : null;
    const lastResult = state.lastResult ? clonePlainValue(state.lastResult) : null;
    const lastError = state.lastError ? clonePlainValue(state.lastError) : null;

    return freezeDeep({
      worker: WORKER_NAME,
      mode: OPERATION_MODE,
      executionEnabled: false,
      running: lock,
      currentOperation: current,
      lastOperation,
      lastResult,
      lastError,
    });
  }

  return {
    runBusinessHunterReadonly,
    getStatus,
  };
}

const businessHunterReadonlyService = createBusinessHunterReadonlyService();

module.exports = {
  WORKER_NAME,
  OPERATION_MODE,
  DEFAULT_TIMEOUT_MS,
  MAX_OPPORTUNITIES,
  createBusinessHunterReadonlyService,
  businessHunterReadonlyService,
};
