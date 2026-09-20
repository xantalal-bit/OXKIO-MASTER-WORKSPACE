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
    if (!capability.available) {
      assert.equal(typeof capability.unavailableReason, 'string');
      assert.ok(capability.unavailableReason.length > 0, `${capability.id} is unavailable but has no reason`);
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
