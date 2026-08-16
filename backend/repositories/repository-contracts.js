'use strict';

const CONTRACTS = Object.freeze({
  ApprovalRepository: Object.freeze(['loadSnapshot', 'saveSnapshot']),
  MemoryRepository: Object.freeze(['loadSnapshot', 'saveSnapshot']),
  OperationRepository: Object.freeze(['loadSnapshot', 'saveSnapshot']),
  AuditRepository: Object.freeze(['append', 'list']),
  OAuthTokenRepository: Object.freeze(['loadForSubject', 'saveForSubject', 'deleteForSubject']),
  // V2: item-level, async, CAS por versión. Coexiste con ApprovalRepository (snapshot,
  // V1) sin sustituirlo. ApprovalQueue sigue usando V1 hasta que una autorización
  // separada (FASE A2) decida convertirla a async y consumir este contrato.
  ApprovalRepositoryV2: Object.freeze([
    'create',
    'getById',
    'listPending',
    'listHistory',
    'approve',
    'reject',
    'claimExecution',
    'completeExecution',
    'failExecution',
    'expire',
    'reclaimExpiredExecutions',
  ]),
});

function assertRepository(repository, contractName) {
  const methods = CONTRACTS[contractName];
  if (!methods) throw new Error(`Unknown repository contract: ${contractName}`);
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    throw new Error(`${contractName} contract is not satisfied.`);
  }
  return repository;
}

module.exports = { CONTRACTS, assertRepository };
