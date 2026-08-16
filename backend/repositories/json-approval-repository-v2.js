'use strict';

// ApprovalRepositoryV2 — backend JSON de COMPATIBILIDAD LOCAL/DEV.
//
// Este repositorio demuestra: contrato async/item-level, CAS por versión
// (expectedVersion/expectedStatus), lecturas frescas contra el fichero en
// cada operación (sin caché autoritativa en memoria) y persistencia entre
// reinicios de un mismo proceso.
//
// Este repositorio NO demuestra ni debe presentarse como: CAS atómico entre
// procesos, seguridad multiinstancia real, concurrencia de Cloud Run, ni
// "exactly-once". La escritura temp-file+rename evita corrupción por una
// escritura parcial de ESTE proceso, pero dos procesos escribiendo sobre el
// mismo fichero pueden seguir pisándose entre la lectura y la escritura de
// cada uno — eso solo lo demuestra PostgreSQL real, en FASE B.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'executing',
  'executed',
  'execution_failed',
  'expired',
]);

const ERROR_CODES = Object.freeze({
  NOT_FOUND: 'not_found',
  STALE_VERSION: 'stale_version',
  STATUS_CONFLICT: 'status_conflict',
  EXECUTION_ID_MISMATCH: 'execution_id_mismatch',
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertValidFileShape(parsed, filePath) {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.records)) {
    throw new Error(
      `ApprovalRepositoryV2: contenido invalido en ${filePath} (se esperaba {records:[...]}).`,
    );
  }
  parsed.records.forEach((record, index) => {
    if (
      !isPlainObject(record)
      || typeof record.id !== 'string'
      || !record.id
      || !Number.isInteger(record.version)
      || record.version < 1
      || !STATUSES.includes(record.status)
    ) {
      throw new Error(`ApprovalRepositoryV2: registro invalido en ${filePath} (indice ${index}).`);
    }
  });
}

function matchesScope(record, scope) {
  if (!scope || typeof scope.clientId !== 'string' || !scope.clientId) return true;
  return Boolean(record.scope) && record.scope.clientId === scope.clientId;
}

function conflict(code, extra = {}) {
  return { ok: false, code, ...extra };
}

function ok(item) {
  return { ok: true, item: clone(item) };
}

function assertExpectedVersion(expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('ApprovalRepositoryV2: expectedVersion must be a positive integer.');
  }
}

class JsonApprovalRepositoryV2 {
  constructor({ filePath } = {}) {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('JsonApprovalRepositoryV2 requires an explicit filePath.');
    }
    this.filePath = filePath;
    this.persistence = 'local_only';
  }

  _readAll() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { records: [] };
      throw error; // fail closed: cualquier otro error de I/O se propaga, nunca se silencia
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // fail closed: un fichero corrupto NUNCA se trata como "vacio"
      throw new Error(`ApprovalRepositoryV2: JSON ilegible en ${this.filePath}: ${error.message}`);
    }
    assertValidFileShape(parsed, this.filePath);
    return parsed;
  }

  _writeAll(state) {
    const dir = path.dirname(this.filePath);
    const tmpPath = path.join(
      dir,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    try {
      fs.renameSync(tmpPath, this.filePath);
    } catch (error) {
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
      throw error;
    }
  }

  _transition(id, { expectedVersion, expectedStatus, mutate }) {
    assertExpectedVersion(expectedVersion);
    if (typeof expectedStatus !== 'string' || !STATUSES.includes(expectedStatus)) {
      throw new Error('ApprovalRepositoryV2: expectedStatus must be a known status.');
    }

    const state = this._readAll();
    const index = state.records.findIndex((candidate) => candidate.id === id);
    if (index === -1) return conflict(ERROR_CODES.NOT_FOUND);

    const current = state.records[index];
    if (current.version !== expectedVersion) return conflict(ERROR_CODES.STALE_VERSION);
    if (current.status !== expectedStatus) {
      return conflict(ERROR_CODES.STATUS_CONFLICT, { currentStatus: current.status });
    }

    const patch = mutate(current);
    if (patch && patch.ok === false) return patch;

    const next = {
      ...current,
      ...patch,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    state.records[index] = next;
    this._writeAll(state);
    return ok(next);
  }

  async create(record, scope = null) {
    const state = this._readAll();
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      version: 1,
      status: 'pending',
      scope: scope ? clone(scope) : null,
      record: clone(record),
      approvedBy: null,
      approvedAt: null,
      rejectedAt: null,
      resolvedAt: null,
      executionId: null,
      executionStartedAt: null,
      executionLeaseExpiresAt: null,
      executionCompletedAt: null,
      executionFailedAt: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    state.records.push(item);
    this._writeAll(state);
    return ok(item);
  }

  async getById(id, scope = null) {
    const state = this._readAll();
    const item = state.records.find((candidate) => candidate.id === id);
    if (!item || !matchesScope(item, scope)) return conflict(ERROR_CODES.NOT_FOUND);
    return ok(item);
  }

  async listPending(scope = null) {
    const state = this._readAll();
    return clone(state.records.filter((item) => item.status === 'pending' && matchesScope(item, scope)));
  }

  async listHistory(scope = null) {
    const state = this._readAll();
    return clone(state.records.filter((item) => item.status !== 'pending' && matchesScope(item, scope)));
  }

  async approve(id, { expectedVersion, expectedStatus = 'pending', approvedBy = null } = {}) {
    return this._transition(id, {
      expectedVersion,
      expectedStatus,
      mutate: () => {
        const now = new Date().toISOString();
        return { status: 'approved', approvedBy: clone(approvedBy), approvedAt: now, resolvedAt: now };
      },
    });
  }

  async reject(id, { expectedVersion, expectedStatus = 'pending' } = {}) {
    return this._transition(id, {
      expectedVersion,
      expectedStatus,
      mutate: () => {
        const now = new Date().toISOString();
        return { status: 'rejected', rejectedAt: now, resolvedAt: now };
      },
    });
  }

  async claimExecution(id, { expectedVersion, expectedStatus, executionId, leaseTtlMs } = {}) {
    if (typeof executionId !== 'string' || !executionId) {
      throw new Error('ApprovalRepositoryV2.claimExecution requires an executionId.');
    }
    if (!Number.isInteger(leaseTtlMs) || leaseTtlMs <= 0) {
      throw new Error('ApprovalRepositoryV2.claimExecution requires a positive leaseTtlMs.');
    }
    return this._transition(id, {
      expectedVersion,
      expectedStatus,
      mutate: () => {
        const now = Date.now();
        return {
          status: 'executing',
          executionId,
          executionStartedAt: new Date(now).toISOString(),
          executionLeaseExpiresAt: new Date(now + leaseTtlMs).toISOString(),
          executionCompletedAt: null,
          executionFailedAt: null,
          result: null,
          error: null,
        };
      },
    });
  }

  async completeExecution(id, { expectedVersion, executionId, result = null } = {}) {
    return this._transition(id, {
      expectedVersion,
      expectedStatus: 'executing',
      mutate: (current) => {
        if (current.executionId !== executionId) return conflict(ERROR_CODES.EXECUTION_ID_MISMATCH);
        return {
          status: 'executed',
          result: clone(result),
          executionCompletedAt: new Date().toISOString(),
          executionLeaseExpiresAt: null,
        };
      },
    });
  }

  async failExecution(id, { expectedVersion, executionId, error = null } = {}) {
    return this._transition(id, {
      expectedVersion,
      expectedStatus: 'executing',
      mutate: (current) => {
        if (current.executionId !== executionId) return conflict(ERROR_CODES.EXECUTION_ID_MISMATCH);
        return {
          status: 'execution_failed',
          error: clone(error),
          executionFailedAt: new Date().toISOString(),
          executionLeaseExpiresAt: null,
        };
      },
    });
  }

  async expire(id, { expectedVersion, expectedStatus } = {}) {
    return this._transition(id, {
      expectedVersion,
      expectedStatus,
      mutate: () => ({ status: 'expired', resolvedAt: new Date().toISOString() }),
    });
  }

  // Solo CONSULTA (FASE A1): localiza ejecuciones con lease vencido. NO decide
  // ni ejecuta reintentos por si sola — eso es politica de negocio de un turno
  // posterior (job de recuperacion o ApprovalQueue en FASE A2).
  async reclaimExpiredExecutions(scope = null, now = Date.now()) {
    const state = this._readAll();
    const reference = now instanceof Date ? now.getTime() : Number(now);
    return clone(state.records.filter((item) => (
      item.status === 'executing'
      && matchesScope(item, scope)
      && typeof item.executionLeaseExpiresAt === 'string'
      && Date.parse(item.executionLeaseExpiresAt) <= reference
    )));
  }
}

module.exports = {
  JsonApprovalRepositoryV2,
  APPROVAL_REPOSITORY_V2_STATUSES: STATUSES,
  APPROVAL_REPOSITORY_V2_ERROR_CODES: ERROR_CODES,
};
