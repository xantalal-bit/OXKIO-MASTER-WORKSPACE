'use strict';

const CONTRACTS = Object.freeze({
  ApprovalRepository: Object.freeze(['loadSnapshot', 'saveSnapshot']),
  MemoryRepository: Object.freeze(['loadSnapshot', 'saveSnapshot']),
  OperationRepository: Object.freeze(['loadSnapshot', 'saveSnapshot']),
  AuditRepository: Object.freeze(['append', 'list']),
  OAuthTokenRepository: Object.freeze(['loadForSubject', 'saveForSubject', 'deleteForSubject']),
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
