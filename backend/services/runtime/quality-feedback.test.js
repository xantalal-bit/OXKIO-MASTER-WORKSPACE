'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { QualityIncidentRegistry } = require('./quality-incident-registry');
const { createQualityFeedbackService, ESCALATE_TO_P1_AT } = require('./quality-feedback');
const { listCapabilities, getCapability } = require('../executive-brain/capability-registry');

function createService({ clock = { now: Date.UTC(2026, 8, 26, 10) } } = {}) {
  const registry = new QualityIncidentRegistry();
  const service = createQualityFeedbackService({ registry, now: () => clock.now });
  return { registry, service, clock };
}

function codeOf(fn) {
  try { fn(); } catch (error) { return error.code; }
  return null;
}

test('classification: plain-language categories map to incident types with P2 by default', () => {
  const { registry, service } = createService();
  service.submit({ category: 'wrong' }, { reporterId: 'uid-a' });
  service.submit({ category: 'not_working' }, { reporterId: 'uid-a' });
  service.submit({ category: 'misunderstood' }, { reporterId: 'uid-a' });
  service.submit({ category: 'incorrect_result' }, { reporterId: 'uid-a' });
  service.submit({ category: 'other' }, { reporterId: 'uid-a' });
  const byComponent = Object.fromEntries(registry.list().map((incident) => [incident.component, incident]));
  assert.equal(byComponent['user-feedback.wrong'].type, 'USER_COMPLAINT');
  assert.equal(byComponent['user-feedback.not_working'].type, 'USER_COMPLAINT');
  assert.equal(byComponent['user-feedback.misunderstood'].type, 'WRONG_RESPONSE');
  assert.equal(byComponent['user-feedback.incorrect_result'].type, 'WRONG_RESPONSE');
  assert.equal(byComponent['user-feedback.other'].type, 'USER_COMPLAINT');
  for (const incident of registry.list()) {
    assert.equal(incident.priority, 'P2');
    assert.equal(incident.status, 'OPEN');
  }
});

test('"sí deberías poder hacerlo" is contrasted with the real Capability Registry', () => {
  const { registry, service } = createService();
  const available = listCapabilities().find((capability) => capability.available && !capability.partial);
  const unavailable = listCapabilities().find((capability) => !capability.available);

  service.submit({ category: 'should_be_able', relatedCapability: available.id }, { reporterId: 'uid-a' });
  const mismatch = registry.findByCause({ type: 'CAPABILITY_MISMATCH', component: 'user-feedback.should_be_able', relatedCapability: available.id });
  assert.equal(mismatch.priority, 'P2');
  assert.equal(mismatch.requiresHumanDecision, false);

  service.submit({ category: 'should_be_able', relatedCapability: unavailable.id }, { reporterId: 'uid-a' });
  const gap = registry.findByCause({ type: 'POLICY_GAP', component: 'user-feedback.should_be_able', relatedCapability: unavailable.id });
  assert.equal(gap.requiresHumanDecision, true);
  assert.equal(gap.priority, 'P2');

  service.submit({ category: 'should_be_able' }, { reporterId: 'uid-a' });
  const unverified = registry.findByCause({ type: 'USER_COMPLAINT', component: 'user-feedback.should_be_able' });
  assert.equal(unverified.requiresHumanDecision, true);

  // Chat composition ids are mapped; unknown values are ignored, never stored.
  service.submit({ category: 'should_be_able', relatedCapability: 'calendar-review-readonly' }, { reporterId: 'uid-b' });
  assert.ok(registry.findByCause({ type: 'CAPABILITY_MISMATCH', component: 'user-feedback.should_be_able', relatedCapability: 'calendar.read' }));
  service.submit({ category: 'wrong', relatedCapability: 'rm -rf /' }, { reporterId: 'uid-b' });
  assert.equal(JSON.stringify(registry.list()).includes('rm -rf'), false);
});

test('feedback never changes policy or capabilities, never repairs and never executes', () => {
  const { registry, service } = createService();
  const before = JSON.stringify(listCapabilities());
  const unavailable = listCapabilities().find((capability) => !capability.available);
  service.submit({ category: 'should_be_able', relatedCapability: unavailable.id, shortSummary: 'Deberías poder hacerlo ya.' }, { reporterId: 'uid-a' });
  assert.equal(JSON.stringify(listCapabilities()), before);
  assert.equal(getCapability(unavailable.id).available, false);
  for (const incident of registry.list()) {
    assert.equal(incident.status, 'OPEN');
    assert.equal(incident.resolvedBy, null);
  }
  const source = fs.readFileSync(path.join(__dirname, 'quality-feedback.js'), 'utf8');
  const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(requires, ['../executive-brain/capability-registry', 'crypto']);
  for (const forbidden of ['resolve(', 'markWontFix', 'executionEnabled', 'approvalQueue', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('recurrence: 10 users = 1 incident x10; one user repeating the same cause counts once per day', () => {
  const { registry, service, clock } = createService();
  for (let user = 0; user < 10; user += 1) service.submit({ category: 'wrong' }, { reporterId: `uid-${user}` });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].occurrenceCount, 10);

  const single = createService();
  for (let repeat = 0; repeat < 5; repeat += 1) {
    assert.equal(single.service.submit({ category: 'wrong' }, { reporterId: 'uid-a' }).accepted, true);
  }
  assert.equal(single.registry.list()[0].occurrenceCount, 1);
  single.clock.now += 25 * 60 * 60 * 1000;
  single.service.submit({ category: 'wrong' }, { reporterId: 'uid-a' });
  assert.equal(single.registry.list()[0].occurrenceCount, 2);
  assert.ok(clock.now > 0);
});

test('priority: P2 by default, P1 only after several distinct reports, never P0', () => {
  const { registry, service } = createService();
  for (let user = 0; user < ESCALATE_TO_P1_AT - 1; user += 1) service.submit({ category: 'incorrect_result' }, { reporterId: `uid-${user}` });
  assert.equal(registry.list()[0].priority, 'P2');
  service.submit({ category: 'incorrect_result' }, { reporterId: 'uid-escalate' });
  assert.equal(registry.list()[0].priority, 'P1');
  for (let user = 0; user < 30; user += 1) service.submit({ category: 'incorrect_result' }, { reporterId: `uid-more-${user}` });
  assert.equal(registry.list()[0].priority, 'P1');
  assert.equal(registry.list().some((incident) => incident.priority === 'P0'), false);
});

test('sanitization: only category, capability and a short safe summary are accepted', () => {
  const { registry, service } = createService();
  assert.equal(codeOf(() => service.submit({ category: 'hack' }, { reporterId: 'uid-a' })), 'QUALITY_FEEDBACK_INVALID_CATEGORY');
  assert.equal(codeOf(() => service.submit({ category: 'wrong', query: 'mi consulta' }, { reporterId: 'uid-a' })), 'QUALITY_FEEDBACK_UNEXPECTED_FIELD');
  assert.equal(codeOf(() => service.submit({ category: 'wrong', conversation: [] }, { reporterId: 'uid-a' })), 'QUALITY_FEEDBACK_UNEXPECTED_FIELD');
  assert.equal(codeOf(() => service.submit({ category: 'wrong', priority: 'P0' }, { reporterId: 'uid-a' })), 'QUALITY_FEEDBACK_UNEXPECTED_FIELD');
  assert.equal(codeOf(() => service.submit({ category: 'wrong', shortSummary: 'Escríbeme a juan.ficticio@example.com' }, { reporterId: 'uid-a' })), 'QUALITY_SENSITIVE_TEXT');
  assert.equal(codeOf(() => service.submit({ category: 'wrong', shortSummary: 'x'.repeat(161) }, { reporterId: 'uid-b' })), 'QUALITY_INVALID_TEXT');
  assert.equal(codeOf(() => service.submit({ category: 'wrong' }, {})), 'QUALITY_FEEDBACK_REPORTER_REQUIRED');
  assert.equal(registry.list().length, 0);

  service.submit({ category: 'wrong', shortSummary: 'La hora de la reunión no era correcta.' }, { reporterId: 'uid-c' });
  assert.equal(registry.list()[0].summary, 'La hora de la reunión no era correcta.');
});

test('isolation: incidents never carry the reporter id; a flood from one reporter is rate-limited', () => {
  const { registry, service } = createService();
  service.submit({ category: 'wrong' }, { reporterId: 'firebase-uid-FAMILIAR-123' });
  service.submit({ category: 'other' }, { reporterId: 'firebase-uid-FAMILIAR-456' });
  const text = JSON.stringify([registry.list(), registry.summary()]);
  assert.equal(text.includes('FAMILIAR'), false);
  assert.equal(text.includes('firebase-uid'), false);

  const flood = createService();
  let limited = null;
  for (let index = 0; index < 25 && !limited; index += 1) {
    limited = codeOf(() => flood.service.submit({ category: 'other' }, { reporterId: 'uid-flood' }));
  }
  assert.equal(limited, 'QUALITY_FEEDBACK_RATE_LIMITED');
  assert.equal(codeOf(() => flood.service.submit({ category: 'other' }, { reporterId: 'uid-other' })), null);
});
