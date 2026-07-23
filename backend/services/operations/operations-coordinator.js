'use strict';

const crypto = require('crypto');

const OPERATION_TYPE = 'business-analysis-readonly';
const WORKER_NAME = 'business-hunter-readonly';
const KNOWLEDGE_OPERATION_TYPE = 'knowledge-review-readonly';
const KNOWLEDGE_WORKER_NAME = 'knowledge-readonly';
const MEMORY_OPERATION_TYPE = 'memory-review-readonly';
const MEMORY_WORKER_NAME = 'memory-readonly';
const MODE = 'manual';
const TRIGGER = 'manual';
const MAX_RECENT_OPERATIONS = 5;
const MAX_WARNINGS = 5;
const MAX_ERRORS = 5;
const MAX_TEXT = 240;
const STATUSES = new Set(['pending', 'running', 'completed', 'completed_with_warnings', 'failed']);
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_warnings', 'failed']);
const PHASES = new Set(['queued', 'validating', 'running_worker', 'validating_result', 'logging', 'completed', 'failed']);
const SOURCE_STATUSES = new Set(['real', 'partial', 'unavailable']);
const OPERATION_TYPES = new Set([OPERATION_TYPE, KNOWLEDGE_OPERATION_TYPE, MEMORY_OPERATION_TYPE]);
const FORBIDDEN_KEYS = new Set([
  'token', 'claims', 'dependencies', 'runtime', 'path', 'paths',
  'sandboxPath', 'payload', 'private_key', 'credentials', 'stack',
  'limits', 'modules', 'constructors',
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeClone(value) {
  const copy = clone(value);
  const freeze = (item) => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
    Object.freeze(item);
    Object.values(item).forEach(freeze);
    return item;
  };
  return freeze(copy);
}

function sanitizeText(value, maxLength = MAX_TEXT) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeMessages(values, limit) {
  return Array.isArray(values)
    ? values.slice(0, limit).map((value) => sanitizeText(value)).filter(Boolean)
    : [];
}

function isAuthorizedIdentity(identity) {
  return Boolean(identity
    && typeof identity === 'object'
    && identity.clientId
    && identity.clientId === identity.expectedClientId
    && identity.authorization
    && identity.authorization.status === 'granted');
}

function validateRunInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError('invalid_operation_input', 'Invalid operation request.');
  }
  if (!OPERATION_TYPES.has(input.type) || input.trigger !== TRIGGER) {
    throw createError('unsupported_operation', 'Unsupported operation.');
  }
  if (!isAuthorizedIdentity(input.identity)) {
    throw createError('operation_authorization_denied', 'Operation authorization is required.');
  }
  const allowed = new Set(['type', 'identity', 'trigger']);
  if (Object.keys(input).some((key) => !allowed.has(key) || FORBIDDEN_KEYS.has(key))) {
    throw createError('invalid_operation_input', 'Invalid operation request.');
  }
}

function containsForbiddenData(value, key = '') {
  if (FORBIDDEN_KEYS.has(key)) return true;
  if (typeof value === 'string') {
    return /(?:[A-Za-z]:\\|\/Users\/|\/home\/|-----BEGIN|bearer\s+|private[_-]?key|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\+?\d[\d .()-]{7,}\d\b)/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsForbiddenData(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) => containsForbiddenData(child, childKey));
  }
  return false;
}

function validateWorkerResult(result, ids, expected = { type: OPERATION_TYPE, worker: WORKER_NAME }) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw createError('invalid_worker_result', 'Worker returned an invalid result.');
  }
  if (result.operationId !== ids.operationId || result.interactionId !== ids.interactionId) {
    throw createError('invalid_worker_result', 'Worker returned mismatched operation identifiers.');
  }
  if (result.worker !== expected.worker || result.mode !== MODE || !TERMINAL_STATUSES.has(result.status)) {
    throw createError('invalid_worker_result', 'Worker returned an invalid contract.');
  }
  if (!SOURCE_STATUSES.has(result.sourceStatus)) {
    throw createError('invalid_worker_result', 'Worker returned an invalid source status.');
  }
  const businessValid = expected.type === OPERATION_TYPE
    && Array.isArray(result.opportunities) && result.opportunities.length <= 10;
  const knowledgeValid = expected.type === KNOWLEDGE_OPERATION_TYPE
    && Number.isInteger(result.itemsCount) && result.itemsCount >= 0 && result.itemsCount <= 10
    && Array.isArray(result.topics) && result.topics.length <= 5
    && Array.isArray(result.warnings) && result.warnings.length <= MAX_WARNINGS;
  const memoryValid = expected.type === MEMORY_OPERATION_TYPE
    && Number.isInteger(result.itemsCount) && result.itemsCount >= 0 && result.itemsCount <= 10
    && Array.isArray(result.topics) && result.topics.length <= 5
    && Array.isArray(result.recommendations) && result.recommendations.length <= 3
    && Array.isArray(result.warnings) && result.warnings.length <= MAX_WARNINGS;
  if ((!businessValid && !knowledgeValid && !memoryValid)
    || !Array.isArray(result.recommendations) || result.recommendations.length > 5
    || !Array.isArray(result.errors) || result.errors.length > MAX_ERRORS) {
    throw createError('invalid_worker_result', 'Worker result limits were exceeded.');
  }
  if (result.sourceStatus === 'unavailable'
    && ((businessValid && result.opportunities.length > 0)
      || (knowledgeValid && result.itemsCount > 0)
      || (memoryValid && result.itemsCount > 0))) {
    throw createError('invalid_worker_result', 'Unavailable sources cannot produce opportunities.');
  }
  if (containsForbiddenData(result)) {
    throw createError('unsafe_worker_result', 'Worker returned unsafe data.');
  }
  const started = Date.parse(result.startedAt);
  const completed = Date.parse(result.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    throw createError('invalid_worker_result', 'Worker returned invalid timestamps.');
  }
}

function createError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createOperationsCoordinator({ businessHunterService, knowledgeReadonlyService, memoryReadonlyService, executionLogger, randomUUID = crypto.randomUUID } = {}) {
  if (!businessHunterService || typeof businessHunterService.runBusinessHunterReadonly !== 'function') {
    throw new Error('Business Hunter readonly adapter is required.');
  }
  if (!knowledgeReadonlyService || typeof knowledgeReadonlyService.runKnowledgeReadonly !== 'function') {
    throw new Error('Knowledge readonly adapter is required.');
  }
  if (!memoryReadonlyService || typeof memoryReadonlyService.runMemoryReadonly !== 'function') {
    throw new Error('Memory readonly adapter is required.');
  }

  const adapters = new Map([
    [OPERATION_TYPE, Object.freeze({ worker: WORKER_NAME, queuedSummary: 'Análisis comercial en preparación.', failureCode: 'business_hunter_operation_failed', run: (context) => businessHunterService.runBusinessHunterReadonly(context) })],
    [KNOWLEDGE_OPERATION_TYPE, Object.freeze({ worker: KNOWLEDGE_WORKER_NAME, queuedSummary: 'Revisión de conocimiento en preparación.', failureCode: 'knowledge_review_failed', run: (context) => knowledgeReadonlyService.runKnowledgeReadonly(context) })],
    [MEMORY_OPERATION_TYPE, Object.freeze({ worker: MEMORY_WORKER_NAME, queuedSummary: 'Revisión de memoria en preparación.', failureCode: 'memory_review_failed', run: (context) => memoryReadonlyService.runMemoryReadonly(context) })],
  ]);
  let activeOperation = null;
  let recentOperations = [];

  function snapshot(record) {
    return record ? freezeClone(record) : null;
  }

  function setActive(record) {
    activeOperation = snapshot(record);
  }

  function storeTerminal(record) {
    recentOperations = [snapshot(record), ...recentOperations].slice(0, MAX_RECENT_OPERATIONS);
  }

  function baseRecord(operationId, interactionId, startedAt, type, adapter) {
    return {
      operationId,
      interactionId,
      type,
      worker: adapter.worker,
      mode: MODE,
      status: 'pending',
      phase: 'queued',
      startedAt,
      completedAt: null,
      durationMs: null,
      sourceStatus: 'unavailable',
      resultSummary: adapter.queuedSummary,
      warnings: [],
      errors: [],
      proposalId: null,
      approvalId: null,
      executionEnabled: false,
      result: null,
    };
  }

  function buildTerminal(base, result) {
    const warnings = result.status === 'completed_with_warnings'
      ? sanitizeMessages(result.recommendations, MAX_WARNINGS)
      : [];
    return {
      ...base,
      status: result.status,
      phase: 'completed',
      completedAt: result.completedAt,
      durationMs: Number.isFinite(result.durationMs) ? Math.max(0, result.durationMs) : 0,
      sourceStatus: result.sourceStatus,
      resultSummary: sanitizeText(result.summary),
      warnings,
      errors: sanitizeMessages(result.errors, MAX_ERRORS),
      result: freezeClone([KNOWLEDGE_OPERATION_TYPE, MEMORY_OPERATION_TYPE].includes(base.type) ? {
        summary: sanitizeText(result.summary), itemsCount: result.itemsCount,
        topics: result.topics, recommendations: result.recommendations,
      } : {
        summary: sanitizeText(result.summary), opportunities: result.opportunities,
        recommendations: result.recommendations,
      }),
    };
  }

  function buildFailure(base, error) {
    const completedAt = new Date().toISOString();
    return {
      ...base,
      status: 'failed',
      phase: 'failed',
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(base.startedAt)),
      sourceStatus: 'unavailable',
      resultSummary: base.type === KNOWLEDGE_OPERATION_TYPE
        ? 'No se pudo completar la revisión de conocimiento.'
        : base.type === MEMORY_OPERATION_TYPE
          ? 'No se pudo completar la revisión de memoria.'
        : 'No se pudo completar el análisis comercial.',
      warnings: [],
      errors: [error && ['business_hunter_timeout', 'knowledge_review_timeout', 'memory_review_timeout'].includes(error.code)
        ? 'La operación tardó más de lo permitido y se detuvo de forma segura.'
        : 'No se pudo completar la operación.'],
      result: null,
    };
  }

  function logTerminal(record) {
    if (executionLogger && typeof executionLogger.logOperation === 'function') {
      executionLogger.logOperation(record);
    }
  }

  async function runOperation(type, identity) {
    validateRunInput({ type, identity, trigger: TRIGGER });
    if (activeOperation) throw createError('operation_in_progress', 'An operation is already running.');

    const operationId = randomUUID();
    const interactionId = randomUUID();
    const startedAt = new Date().toISOString();
    const adapter = adapters.get(type);
    const base = baseRecord(operationId, interactionId, startedAt, type, adapter);
    setActive({ ...base, status: 'running', phase: 'validating' });
    try {
      setActive({ ...base, status: 'running', phase: 'running_worker' });
      const result = await adapter.run({ operationId, interactionId, identity });
      setActive({ ...base, status: 'running', phase: 'validating_result' });
      validateWorkerResult(result, { operationId, interactionId }, { type, worker: adapter.worker });
      const terminal = buildTerminal(base, result);
      setActive({ ...terminal, status: 'running', phase: 'logging' });
      logTerminal(terminal);
      storeTerminal(terminal);
      return snapshot(terminal);
    } catch (error) {
      const failed = buildFailure(base, error);
      logTerminal(failed);
      storeTerminal(failed);
      throw createError(error && error.code ? error.code : adapter.failureCode, failed.errors[0]);
    } finally {
      activeOperation = null;
    }
  }

  function runBusinessAnalysis({ identity } = {}) { return runOperation(OPERATION_TYPE, identity); }
  function runKnowledgeReview({ identity } = {}) { return runOperation(KNOWLEDGE_OPERATION_TYPE, identity); }
  function runMemoryReview({ identity } = {}) { return runOperation(MEMORY_OPERATION_TYPE, identity); }

  function getStatus() {
    return freezeClone({
      activeOperation,
      recentOperations,
      executionEnabled: false,
    });
  }

  function getRecentOperations({ limit = MAX_RECENT_OPERATIONS } = {}) {
    const safeLimit = Number.isInteger(limit) ? Math.max(0, Math.min(MAX_RECENT_OPERATIONS, limit)) : MAX_RECENT_OPERATIONS;
    return freezeClone(recentOperations.slice(0, safeLimit));
  }

  return Object.freeze({ runBusinessAnalysis, runKnowledgeReview, runMemoryReview, getStatus, getRecentOperations });
}

module.exports = {
  validateRunInput,
  validateWorkerResult,
  createOperationsCoordinator,
};
