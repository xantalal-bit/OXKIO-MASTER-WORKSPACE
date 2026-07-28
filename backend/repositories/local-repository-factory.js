'use strict';

const {
  JsonApprovalRepository,
  JsonMemoryRepository,
  JsonOperationRepository,
} = require('./json-repositories');

function createLocalApprovalRepository(filePath) {
  return new JsonApprovalRepository({ filePath });
}

function createLocalMemoryRepository(filePath) {
  return new JsonMemoryRepository({ filePath });
}

function createLocalOperationRepository(filePath) {
  return new JsonOperationRepository({ filePath });
}

module.exports = {
  createLocalApprovalRepository,
  createLocalMemoryRepository,
  createLocalOperationRepository,
};
