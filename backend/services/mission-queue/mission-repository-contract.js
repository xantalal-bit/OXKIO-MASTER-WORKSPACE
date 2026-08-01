'use strict';

const {
  MISSION_STATES,
  PRIORITIES,
  validateIdentifier,
  validateSyntheticScope,
} = require('./mission-contract');

const MISSION_REPOSITORY_METHODS = Object.freeze([
  'create',
  'get',
  'list',
  'saveIfVersion',
]);

const FORBIDDEN_REPOSITORY_METHODS = Object.freeze([
  'delete',
  'hardDelete',
  'globalList',
  'findAcrossTenants',
]);

const MISSION_FILTERS = Object.freeze([
  'projectId',
  'workspaceId',
  'status',
  'priority',
]);

class MissionRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MissionRepositoryError';
    this.code = code;
  }
}

function repositoryFail(code, message) {
  throw new MissionRepositoryError(code, message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertMissionRepository(repository) {
  if (!isPlainObject(repository)) {
    repositoryFail('invalid_mission_repository', 'MissionRepository implementation is required.');
  }
  MISSION_REPOSITORY_METHODS.forEach((method) => {
    if (typeof repository[method] !== 'function') {
      repositoryFail('invalid_mission_repository', `MissionRepository.${method} is required.`);
    }
  });
  FORBIDDEN_REPOSITORY_METHODS.forEach((method) => {
    if (typeof repository[method] === 'function') {
      repositoryFail('unsafe_mission_repository', `MissionRepository.${method} is not allowed in V1.`);
    }
  });
  return repository;
}

function normalizeRepositoryScope(scope) {
  return validateSyntheticScope(scope);
}

function normalizeIdempotencyKey(value) {
  return validateIdentifier(value, 'idempotencyKey');
}

function normalizeExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    repositoryFail('invalid_expected_version', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function normalizeMissionFilters(filters = {}) {
  if (!isPlainObject(filters)) {
    repositoryFail('invalid_mission_filters', 'Mission filters must be an object.');
  }
  const unsupported = Object.keys(filters).filter((key) => !MISSION_FILTERS.includes(key));
  if (unsupported.length > 0) {
    repositoryFail('unsupported_mission_filter', 'Only scoped V1 Mission filters are allowed.');
  }

  const normalized = {};
  if (Object.hasOwn(filters, 'projectId')) {
    normalized.projectId = validateIdentifier(filters.projectId, 'projectId');
  }
  if (Object.hasOwn(filters, 'workspaceId')) {
    normalized.workspaceId = filters.workspaceId === null
      ? null
      : validateIdentifier(filters.workspaceId, 'workspaceId');
  }
  if (Object.hasOwn(filters, 'status')) {
    if (!Object.values(MISSION_STATES).includes(filters.status)) {
      repositoryFail('invalid_mission_filter_status', 'Unsupported Mission status filter.');
    }
    normalized.status = filters.status;
  }
  if (Object.hasOwn(filters, 'priority')) {
    if (!PRIORITIES.includes(filters.priority)) {
      repositoryFail('invalid_mission_filter_priority', 'Unsupported Mission priority filter.');
    }
    normalized.priority = filters.priority;
  }
  return Object.freeze(normalized);
}

module.exports = {
  FORBIDDEN_REPOSITORY_METHODS,
  MISSION_FILTERS,
  MISSION_REPOSITORY_METHODS,
  MissionRepositoryError,
  assertMissionRepository,
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeMissionFilters,
  normalizeRepositoryScope,
  repositoryFail,
};
