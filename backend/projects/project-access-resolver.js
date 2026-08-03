'use strict';

const { authorizeMissionCapability } = require('../security/mission-capability-authorizer');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const MISSION_CREATE = 'mission:create';
const ACTIVE = 'ACTIVE';
const KNOWN_ROLES = new Set(['owner', 'admin', 'operator', 'reviewer', 'viewer']);
const SCOPE_KEYS = Object.freeze(['tenantId', 'userId', 'clientId', 'roles']);
const GRANT_KEYS = Object.freeze(['capability', 'tenantId', 'userId', 'clientId']);
const REQUEST_KEYS = Object.freeze(['scope', 'capabilityGrant', 'projectId', 'workspaceId']);
const PROJECT_KEYS = Object.freeze([
  'tenantId', 'clientId', 'projectId', 'status', 'workspaceIds',
]);
const BOOTSTRAP_KEYS = Object.freeze(['enabled', 'tenantId', 'clientId', 'projects']);
const BOOTSTRAP_PROJECT_KEYS = Object.freeze(['projectId', 'workspaceIds']);

class ProjectAccessResolutionError extends Error {
  constructor(code, message = 'Project access resolution failed.') {
    super(message);
    this.name = 'ProjectAccessResolutionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProjectAccessResolutionError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function validateIdentifier(value, code = 'project_access_request_invalid') {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail(code, 'Project access input is invalid.');
  }
  return value;
}

function validateOptionalIdentifier(value, code = 'project_access_request_invalid') {
  if (value === null) return null;
  return validateIdentifier(value, code);
}

function validateScope(scope) {
  if (!hasExactKeys(scope, SCOPE_KEYS)
    || !Array.isArray(scope.roles)
    || scope.roles.length === 0
    || scope.roles.some((role) => typeof role !== 'string' || !KNOWN_ROLES.has(role))
    || new Set(scope.roles).size !== scope.roles.length) {
    fail('project_access_scope_invalid', 'MissionScope is invalid.');
  }
  return Object.freeze({
    tenantId: validateIdentifier(scope.tenantId, 'project_access_scope_invalid'),
    userId: validateIdentifier(scope.userId, 'project_access_scope_invalid'),
    clientId: validateIdentifier(scope.clientId, 'project_access_scope_invalid'),
    roles: Object.freeze([...scope.roles]),
  });
}

function validateGrant(grant, scope) {
  if (!hasExactKeys(grant, GRANT_KEYS)
    || grant.capability !== MISSION_CREATE
    || grant.tenantId !== scope.tenantId
    || grant.userId !== scope.userId
    || grant.clientId !== scope.clientId) {
    fail('project_access_grant_invalid', 'Capability grant is invalid.');
  }
  let currentGrant;
  try {
    currentGrant = authorizeMissionCapability({ scope, capability: MISSION_CREATE });
  } catch (error) {
    fail('project_access_grant_invalid', 'Capability grant is invalid.');
  }
  if (GRANT_KEYS.some((key) => currentGrant[key] !== grant[key])) {
    fail('project_access_grant_invalid', 'Capability grant is invalid.');
  }
  return grant;
}

function validateWorkspaceIds(value, code) {
  if (!Array.isArray(value)
    || value.some((workspaceId) => typeof workspaceId !== 'string'
      || !IDENTIFIER_PATTERN.test(workspaceId))
    || new Set(value).size !== value.length) {
    fail(code, 'Project authority data is invalid.');
  }
  return Object.freeze([...value]);
}

function validateProject(candidate) {
  if (!hasExactKeys(candidate, PROJECT_KEYS)) {
    fail('project_access_data_invalid', 'Project authority data is invalid.');
  }
  const project = {
    tenantId: validateIdentifier(candidate.tenantId, 'project_access_data_invalid'),
    clientId: validateIdentifier(candidate.clientId, 'project_access_data_invalid'),
    projectId: validateIdentifier(candidate.projectId, 'project_access_data_invalid'),
    status: candidate.status,
    workspaceIds: validateWorkspaceIds(candidate.workspaceIds, 'project_access_data_invalid'),
  };
  if (project.status !== ACTIVE) {
    fail('project_access_not_available', 'Project access is unavailable.');
  }
  return Object.freeze(project);
}

function createProjectAccessResolver({ provider } = {}) {
  if (!provider || typeof provider.findProjects !== 'function') {
    fail('project_access_provider_invalid', 'Project authority provider is unavailable.');
  }

  async function resolveProjectAccess(input = {}) {
    if (!hasExactKeys(input, REQUEST_KEYS)) {
      fail('project_access_request_invalid', 'Project access request is invalid.');
    }
    const scope = validateScope(input.scope);
    validateGrant(input.capabilityGrant, scope);
    const projectId = validateIdentifier(input.projectId);
    const workspaceId = validateOptionalIdentifier(input.workspaceId);
    let candidates;
    try {
      candidates = await provider.findProjects({
        tenantId: scope.tenantId,
        clientId: scope.clientId,
        projectId,
      });
    } catch (error) {
      fail('project_access_provider_unavailable', 'Project authority provider is unavailable.');
    }
    if (!Array.isArray(candidates)) {
      fail('project_access_data_invalid', 'Project authority data is invalid.');
    }
    const projects = candidates.map(validateProject);
    const applicable = projects.filter((project) => (
      project.tenantId === scope.tenantId
      && project.clientId === scope.clientId
      && project.projectId === projectId
    ));
    if (applicable.length === 0) {
      fail('project_access_not_available', 'Project access is unavailable.');
    }
    if (applicable.length !== 1) {
      fail('project_access_ambiguous', 'Project access cannot be resolved unambiguously.');
    }
    const project = applicable[0];
    if (workspaceId !== null && !project.workspaceIds.includes(workspaceId)) {
      fail('project_access_not_available', 'Project access is unavailable.');
    }
    return Object.freeze({ projectId, workspaceId });
  }

  return Object.freeze({ resolveProjectAccess });
}

function createClientZeroProjectBootstrapProvider(configuration = {}) {
  if (!isPlainObject(configuration)) {
    fail('project_bootstrap_configuration_invalid', 'Project bootstrap configuration is invalid.');
  }
  const keys = Object.keys(configuration);
  if (keys.length === 0
    || (keys.length === 1 && configuration.enabled === false)) {
    return Object.freeze({ findProjects: async () => [] });
  }
  if (!hasExactKeys(configuration, BOOTSTRAP_KEYS) || configuration.enabled !== true) {
    fail('project_bootstrap_configuration_invalid', 'Project bootstrap configuration is invalid.');
  }

  let tenantId;
  let clientId;
  let projects;
  try {
    tenantId = validateIdentifier(configuration.tenantId, 'project_bootstrap_configuration_invalid');
    clientId = validateIdentifier(configuration.clientId, 'project_bootstrap_configuration_invalid');
    if (!Array.isArray(configuration.projects)) {
      fail('project_bootstrap_configuration_invalid');
    }
    projects = configuration.projects.map((candidate) => {
      if (!hasExactKeys(candidate, BOOTSTRAP_PROJECT_KEYS)) {
        fail('project_bootstrap_configuration_invalid');
      }
      return Object.freeze({
        tenantId,
        clientId,
        projectId: validateIdentifier(
          candidate.projectId,
          'project_bootstrap_configuration_invalid',
        ),
        status: ACTIVE,
        workspaceIds: validateWorkspaceIds(
          candidate.workspaceIds,
          'project_bootstrap_configuration_invalid',
        ),
      });
    });
    if (new Set(projects.map((project) => project.projectId)).size !== projects.length) {
      fail('project_bootstrap_configuration_invalid');
    }
    const allWorkspaceIds = projects.flatMap((project) => project.workspaceIds);
    if (new Set(allWorkspaceIds).size !== allWorkspaceIds.length) {
      fail('project_bootstrap_configuration_invalid');
    }
  } catch (error) {
    fail('project_bootstrap_configuration_invalid', 'Project bootstrap configuration is invalid.');
  }

  const projectSnapshot = Object.freeze([...projects]);
  return Object.freeze({
    findProjects: async (query = {}) => {
      if (!hasExactKeys(query, ['tenantId', 'clientId', 'projectId'])) return [];
      return Object.freeze(projectSnapshot.filter((project) => (
        project.tenantId === query.tenantId
        && project.clientId === query.clientId
        && project.projectId === query.projectId
      )));
    },
  });
}

module.exports = Object.freeze({
  ProjectAccessResolutionError,
  createClientZeroProjectBootstrapProvider,
  createProjectAccessResolver,
});
