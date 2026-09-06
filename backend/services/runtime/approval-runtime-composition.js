'use strict';

const ApprovalQueue = require('../../core/approvalQueue');
const {
  createPostgresApprovalComposition,
} = require('../../repositories/postgres-approval-factory');

const APPROVAL_BACKEND_JSON = 'json';
const APPROVAL_BACKEND_POSTGRES = 'postgres';

function invalidBackend() {
  const error = new Error('Unsupported Approval repository backend.');
  error.code = 'invalid_approval_repository_backend';
  return error;
}

function createApprovalRuntimeComposition({
  backend = APPROVAL_BACKEND_JSON,
  runtimeUrl,
  scope,
  PoolClass,
  createApprovalQueue = (options) => new ApprovalQueue(options),
  createPostgresComposition = createPostgresApprovalComposition,
} = {}) {
  if (backend === APPROVAL_BACKEND_JSON) {
    return Object.freeze({
      backend,
      approvalQueue: createApprovalQueue(),
      async cleanup() {},
    });
  }

  if (backend !== APPROVAL_BACKEND_POSTGRES) {
    throw invalidBackend();
  }

  const postgres = createPostgresComposition({
    runtimeUrl,
    ...(scope ? { scope } : {}),
    ...(PoolClass ? { PoolClass } : {}),
  });

  const approvalQueue = createApprovalQueue({
    repository: postgres.repository,
  });

  let cleaned = false;

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    await postgres.cleanup();
  }

  return Object.freeze({
    backend,
    approvalQueue,
    cleanup,
  });
}

module.exports = {
  APPROVAL_BACKEND_JSON,
  APPROVAL_BACKEND_POSTGRES,
  createApprovalRuntimeComposition,
};
