'use strict';

const path = require('path');
const { createLocalOperationRepository } = require('../repositories/local-repository-factory');
const { assertRepository } = require('../repositories/repository-contracts');

const DATA_FILE = path.join(__dirname, 'executionLog.json');
const MAX_LIST_LIMIT = 100;
const OPERATION_FIELDS = Object.freeze([
  'operationId', 'interactionId', 'type', 'worker', 'mode', 'status',
  'sourceStatus', 'startedAt', 'completedAt', 'durationMs', 'resultSummary',
  'warningCount', 'errorCount', 'executionEnabled',
]);
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_warnings', 'failed']);
const SOURCE_STATUSES = new Set(['real', 'partial', 'unavailable']);
const ALLOWED_OPERATIONS = new Set([
  'business-analysis-readonly:business-hunter-readonly',
  'knowledge-review-readonly:knowledge-readonly',
  'memory-review-readonly:memory-readonly',
  'gmail-review-readonly:gmail-readonly',
  'calendar-review-readonly:calendar-readonly',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeText(value, maxLength = 240) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function containsSensitiveText(value) {
  return /(?:[A-Za-z]:\\|\/Users\/|\/home\/|-----BEGIN|bearer\s+|private[_-]?key|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\+?\d[\d .()-]{7,}\d\b)/i.test(String(value || ''));
}

function publicLog(log) {
  if (log && log.kind === 'operation') {
    return Object.fromEntries(
      ['id', 'createdAt', 'kind', ...OPERATION_FIELDS]
        .filter((field) => Object.prototype.hasOwnProperty.call(log, field))
        .map((field) => [field, log[field]]),
    );
  }
  return {
    id: safeText(log && log.id, 80) || null,
    createdAt: safeText(log && log.createdAt, 40) || null,
    kind: 'legacy',
  };
}

class ExecutionLogger {
  constructor({ dataFile = DATA_FILE, repository } = {}) {
    this.dataFile = dataFile;
    this.repository = assertRepository(
      repository || createLocalOperationRepository(dataFile),
      'OperationRepository',
    );
    this.logs = [];
    this.load();
  }

  hasExecuted(approvalId) {
    return this.logs.some((log) => log.approvalId === approvalId);
  }

  add(entry) {
    const log = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.logs.push(log);
    this.save();
    return clone(log);
  }

  logOperation(record) {
    if (!record || typeof record !== 'object'
      || !TERMINAL_STATUSES.has(record.status)
      || !SOURCE_STATUSES.has(record.sourceStatus)
      || record.executionEnabled !== false) {
      throw new Error('Invalid terminal operation record.');
    }

    const operation = {
      operationId: safeText(record.operationId, 80),
      interactionId: safeText(record.interactionId, 80),
      type: safeText(record.type, 80),
      worker: safeText(record.worker, 80),
      mode: safeText(record.mode, 40),
      status: record.status,
      sourceStatus: record.sourceStatus,
      startedAt: safeText(record.startedAt, 40),
      completedAt: safeText(record.completedAt, 40),
      durationMs: Number.isFinite(record.durationMs) ? Math.max(0, record.durationMs) : null,
      resultSummary: safeText(record.resultSummary),
      warningCount: Array.isArray(record.warnings) ? Math.min(5, record.warnings.length) : 0,
      errorCount: Array.isArray(record.errors) ? Math.min(5, record.errors.length) : 0,
      executionEnabled: false,
    };

    if (!operation.operationId || !operation.interactionId
      || !ALLOWED_OPERATIONS.has(`${operation.type}:${operation.worker}`)
      || operation.mode !== 'manual') {
      throw new Error('Invalid operation logger contract.');
    }
    if (containsSensitiveText(operation.resultSummary)) {
      throw new Error('Unsafe operation logger record.');
    }

    const log = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      kind: 'operation',
      ...operation,
    };
    this.logs.push(log);
    this.save();
    return clone(log);
  }

  list({ limit = MAX_LIST_LIMIT } = {}) {
    const safeLimit = Number.isInteger(limit) ? Math.max(0, Math.min(MAX_LIST_LIMIT, limit)) : MAX_LIST_LIMIT;
    if (safeLimit === 0) return [];
    return clone(this.logs.slice(-safeLimit).reverse().map(publicLog));
  }

  getStatus() {
    return { total: this.logs.length };
  }

  save() {
    this.repository.saveSnapshot({ logs: this.logs });
  }

  load() {
    const data = this.repository.loadSnapshot();
    this.logs = Array.isArray(data.logs) ? data.logs : [];
  }
}

module.exports = ExecutionLogger;
module.exports.OPERATION_FIELDS = OPERATION_FIELDS;
