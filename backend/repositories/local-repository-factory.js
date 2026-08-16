'use strict';

const {
  JsonApprovalRepository,
  JsonMemoryRepository,
  JsonOperationRepository,
} = require('./json-repositories');
const { JsonApprovalRepositoryV2 } = require('./json-approval-repository-v2');

function createLocalApprovalRepository(filePath) {
  return new JsonApprovalRepository({ filePath });
}

function createLocalApprovalRepositoryV2(filePath) {
  return new JsonApprovalRepositoryV2({ filePath });
}

function createLocalMemoryRepository(filePath) {
  return new JsonMemoryRepository({ filePath });
}

function createLocalOperationRepository(filePath) {
  return new JsonOperationRepository({ filePath });
}

module.exports = {
  createLocalApprovalRepository,
  createLocalApprovalRepositoryV2,
  createLocalMemoryRepository,
  createLocalOperationRepository,
};
