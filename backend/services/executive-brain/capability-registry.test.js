'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MODES, listCapabilities, getCapability, listAvailable, listUnavailable } = require('./capability-registry');

test('every capability declares the required contract fields', () => {
  for (const capability of listCapabilities()) {
    assert.equal(typeof capability.id, 'string');
    assert.equal(typeof capability.name, 'string');
    assert.equal(typeof capability.description, 'string');
    assert.ok(MODES.includes(capability.mode), `${capability.id} has an invalid mode`);
    assert.equal(typeof capability.risk, 'string');
    assert.equal(typeof capability.requiresApproval, 'boolean');
    assert.equal(typeof capability.available, 'boolean');
    assert.equal(typeof capability.partial, 'boolean', `${capability.id} must declare partial`);
    assert.ok(
      capability.source === null || typeof capability.source === 'string',
      `${capability.id} source must be a file path or null`,
    );
    assert.ok(Array.isArray(capability.dependencies), `${capability.id} dependencies must be an array`);
    if (!capability.available || capability.partial) {
      assert.equal(typeof capability.unavailableReason, 'string');
      assert.ok(capability.unavailableReason.length > 0, `${capability.id} is unavailable or partial but has no reason`);
    }
    if (capability.available) {
      assert.ok(capability.source, `${capability.id} is available but declares no source file`);
    }
  }
});

test('capability ids are unique', () => {
  const ids = listCapabilities().map((capability) => capability.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('getCapability finds a known id and returns null for an unknown one', () => {
  assert.equal(getCapability('gmail.read').available, true);
  assert.equal(getCapability('not-a-real-capability'), null);
});

test('listAvailable and listUnavailable partition the full registry', () => {
  const total = listCapabilities().length;
  assert.equal(listAvailable().length + listUnavailable().length, total);
  assert.ok(listAvailable().every((capability) => capability.available === true));
  assert.ok(listUnavailable().every((capability) => capability.available === false));
});

test('gmail.send is registered as disabled for a real, verifiable safety reason', () => {
  const send = getCapability('gmail.send');
  assert.equal(send.available, false);
  assert.match(send.unavailableReason, /allowRealSend/);
});

// FULL RUNTIME REVEAL FASE 4: gmail.prioritize was reported unavailable
// ("todavia no esta conectada al chat") but context-intent-router.js
// (PRIORITIZE_QUERIES) and executive-orchestrator.js (buildPrioritizationAnswer)
// have called mail-priority.js in production since V0.5 FASE 6 — the registry
// must say so, or "que puedes hacer" lies to the user about a real capability.
test('gmail.prioritize is registered as connected (V0.5 wired it into the chat)', () => {
  const prioritize = getCapability('gmail.prioritize');
  assert.equal(prioritize.available, true);
  assert.equal(prioritize.partial, true);
  assert.match(prioritize.unavailableReason, /PRIORITIZE_QUERIES|conversacion/i);
});

// OXKIO CANONICAL RUNTIME CONSOLIDATION (22/09/2026): governance.read is now
// connected (sanitizeGovernanceContext() in executive-chat.js), narrower
// than the full ecosystem-observer.js output — same partial=true pattern as
// gmail.prioritize/dashboard.read above, not a disconnection anymore.
test('governance.read is registered as connected but narrower than the full ecosystem observer', () => {
  const governance = getCapability('governance.read');
  assert.equal(governance.available, true);
  assert.equal(governance.partial, true);
  assert.doesNotMatch(governance.unavailableReason, /no esta conectad/i);
  assert.match(governance.unavailableReason, /aprobacion|seguridad/i);
  assert.match(governance.source, /ecosystem-observer/);
});

// FASE 6: registered honestly — logic exists, runtime disabled, persistence
// not provisioned — never simply "does not exist" (Mission Queue is real,
// tested, and has zero production callers today; see mission-service.js).
test('mission.* capabilities are registered honestly, not as nonexistent', () => {
  for (const id of ['mission.create', 'mission.track', 'mission.resume', 'mission.close']) {
    const capability = getCapability(id);
    assert.ok(capability, `${id} must be registered`);
    assert.equal(capability.available, false);
    assert.doesNotMatch(capability.unavailableReason, /no existe/i);
    assert.match(capability.unavailableReason, /logica|estado/i);
    assert.match(capability.unavailableReason, /runtime/i);
    assert.match(capability.source, /mission-queue/);
  }
});

// V0.6.1 PROBLEMA 5: "Que no puedes hacer todavia?" must never surface
// internal identifiers (function calls, file paths) — those are for the
// registry/developers (`source`/`dependencies`), never the chat text.
const CODE_IDENTIFIER_PATTERN = /[a-zA-Z_][a-zA-Z0-9_]*\(\)|\.js\b|\bGET \/api\//;
test('no unavailableReason exposes internal function or file names to the user', () => {
  for (const capability of listCapabilities()) {
    if (!capability.unavailableReason) continue;
    assert.doesNotMatch(
      capability.unavailableReason,
      CODE_IDENTIFIER_PATTERN,
      `${capability.id}.unavailableReason leaks an internal identifier: "${capability.unavailableReason}"`,
    );
  }
});

// XATAI CORE V1: governance profile derived from the same entries.
const {
  CAPABILITY_STATUS, capabilityStatus, describeCapability, listCapabilityProfiles,
} = require('./capability-registry');
const { LEVELS } = require('../runtime/cost-policy');

test('every capability has a complete governance profile', () => {
  const profiles = listCapabilityProfiles();
  assert.equal(profiles.length, listCapabilities().length);
  for (const profile of profiles) {
    assert.ok(Object.values(CAPABILITY_STATUS).includes(profile.status), `${profile.id} status`);
    assert.ok(Object.values(LEVELS).includes(profile.costClass), `${profile.id} costClass`);
    assert.equal(typeof profile.requiresApproval, 'boolean');
    assert.equal(typeof profile.requiresExternalConnection, 'boolean', `${profile.id} external connection`);
    assert.ok(Array.isArray(profile.tools));
    assert.equal(typeof profile.risk, 'string');
    assert.ok(Object.isFrozen(profile));
  }
});

test('status is derived, never stored twice: available/partial/blocked/not implemented', () => {
  assert.equal(describeCapability('gmail.read').status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(describeCapability('gmail.prioritize').status, CAPABILITY_STATUS.PARTIAL);
  // Real code, deliberately disabled or not provisioned.
  assert.equal(describeCapability('gmail.send').status, CAPABILITY_STATUS.BLOCKED);
  assert.equal(describeCapability('mission.create').status, CAPABILITY_STATUS.BLOCKED);
  // No code behind it yet.
  assert.equal(describeCapability('calendar.create').status, CAPABILITY_STATUS.NOT_IMPLEMENTED);
  assert.equal(describeCapability('unknown.capability'), null);
  for (const capability of listCapabilities()) {
    assert.equal(describeCapability(capability.id).status, capabilityStatus(capability));
  }
});

test('gmail.draft is priced as a small model with an external connection and human approval', () => {
  const draft = describeCapability('gmail.draft');
  assert.equal(draft.costClass, LEVELS.SMALL_MODEL);
  assert.equal(draft.requiresExternalConnection, true);
  assert.equal(draft.requiresApproval, true);
});

test('XATAI CORE V2: internal capabilities resolve in describeCapability but never reach user-facing lists', () => {
  const { listInternalCapabilityIds } = require('./capability-registry');
  const userFacing = new Set(listCapabilities().map((capability) => capability.id));
  for (const id of listInternalCapabilityIds()) {
    assert.equal(userFacing.has(id), false, id);
    assert.equal(getCapability(id), null, id);
    assert.ok(describeCapability(id), id);
  }
  assert.equal(describeCapability('verification.review').status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(describeCapability('mission.plan').status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(describeCapability('research.company').status, CAPABILITY_STATUS.PARTIAL);
  assert.equal(describeCapability('research.web').status, CAPABILITY_STATUS.PARTIAL);
  for (const id of ['data.analyze', 'opportunity.analyze', 'proposal.compose', 'communication.compose', 'commercial.handoff']) {
    assert.equal(describeCapability(id).status, CAPABILITY_STATUS.AVAILABLE, id);
  }
  assert.equal(describeCapability('commercial.handoff').requiresApproval, true);
  for (const id of ['web.search', 'repository.analyze', 'code.propose_patch', 'tests.run']) {
    assert.equal(describeCapability(id).status, CAPABILITY_STATUS.NOT_IMPLEMENTED, id);
  }
  assert.equal(describeCapability('tests.run').requiresApproval, true);
  assert.equal(describeCapability('unknown.capability'), null);
});
