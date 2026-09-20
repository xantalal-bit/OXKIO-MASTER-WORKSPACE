'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAIL_PRIORITY_LEVELS, classifyMailPriority } = require('./mail-priority');

test('exposes exactly the five documented priority levels', () => {
  assert.deepEqual(MAIL_PRIORITY_LEVELS, ['urgent', 'important', 'review', 'informational', 'noise']);
});

test('classifies using only the unread/important signals Gmail context already exposes', () => {
  assert.equal(classifyMailPriority({ important: true, unread: true }), 'urgent');
  assert.equal(classifyMailPriority({ important: true, unread: false }), 'important');
  assert.equal(classifyMailPriority({ important: false, unread: true }), 'review');
  assert.equal(classifyMailPriority({ important: false, unread: false }), 'informational');
});

test('never throws on missing or malformed input', () => {
  assert.equal(classifyMailPriority(null), 'informational');
  assert.equal(classifyMailPriority(undefined), 'informational');
  assert.equal(classifyMailPriority({}), 'informational');
});
