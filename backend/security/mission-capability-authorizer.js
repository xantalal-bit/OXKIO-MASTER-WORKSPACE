'use strict';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const KNOWN_ROLES = new Set(['owner', 'admin', 'operator', 'reviewer', 'viewer']);
const MISSION_CREATE_ROLES = new Set(['owner', 'admin', 'operator']);
const MISSION_CREATE = 'mission:create';
const INPUT_KEYS = Object.freeze(['scope', 'capability']);
const SCOPE_KEYS = Object.freeze(['tenantId', 'userId', 'clientId', 'roles']);

class MissionCapabilityAuthorizationError extends Error {
  constructor(code, message = 'Mission capability authorization failed.') {
    super(message);
    this.name = 'MissionCapabilityAuthorizationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MissionCapabilityAuthorizationError(code, message);
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

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function validateScope(scope) {
  if (!hasExactKeys(scope, SCOPE_KEYS)
    || !isIdentifier(scope.tenantId)
    || !isIdentifier(scope.userId)
    || !isIdentifier(scope.clientId)
    || !Array.isArray(scope.roles)
    || scope.roles.length === 0
    || scope.roles.some((role) => typeof role !== 'string' || !KNOWN_ROLES.has(role))
    || new Set(scope.roles).size !== scope.roles.length) {
    fail('mission_capability_scope_invalid', 'MissionScope is invalid.');
  }
  return scope;
}

function authorizeMissionCapability(input = {}) {
  if (!hasExactKeys(input, INPUT_KEYS)) {
    fail('mission_capability_request_invalid', 'Mission capability request is invalid.');
  }
  const { scope, capability } = input;
  if (capability !== MISSION_CREATE) {
    fail('mission_capability_unknown', 'Mission capability is not recognized.');
  }
  const missionScope = validateScope(scope);
  if (!missionScope.roles.some((role) => MISSION_CREATE_ROLES.has(role))) {
    fail('mission_capability_denied', 'Mission capability is not authorized.');
  }
  return Object.freeze({
    capability: MISSION_CREATE,
    tenantId: missionScope.tenantId,
    userId: missionScope.userId,
    clientId: missionScope.clientId,
  });
}

module.exports = Object.freeze({
  MissionCapabilityAuthorizationError,
  authorizeMissionCapability,
});
