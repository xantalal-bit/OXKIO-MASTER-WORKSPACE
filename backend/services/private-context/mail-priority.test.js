'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAIL_PRIORITY_LEVELS, classifyMailPriority, classifyMailSignals, countsAsImportant } = require('./mail-priority');

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
  assert.equal(classifyMailSignals(null), 'informational');
  assert.equal(countsAsImportant(undefined), false);
});

test('V3 signals: a direct message is never noise outside promotions; important alone does not lift bulk mail', () => {
  assert.equal(classifyMailSignals({ unread: true, category: 'social', directMessage: true, bulk: true }), 'review');
  assert.equal(classifyMailSignals({ unread: true, category: 'social' }), 'noise');
  assert.equal(classifyMailSignals({ unread: true, category: 'promotions', directMessage: true }), 'noise');
  assert.equal(classifyMailSignals({ unread: true, important: true, category: 'social', directMessage: true, bulk: true }), 'urgent');
  assert.equal(classifyMailSignals({ important: true, bulk: true, category: 'updates' }), 'informational');
  assert.equal(classifyMailSignals({ important: true, unread: true, bulk: true, category: 'updates' }), 'review');
  assert.equal(classifyMailSignals({ important: true, starred: true, bulk: true, category: 'updates' }), 'important');
  assert.equal(classifyMailSignals({ important: true, unread: true, category: 'primary' }), 'urgent');
  assert.equal(classifyMailSignals({ unread: true }), 'review');
  // Executive Chat's V2 classification is unchanged: it never reads these signals.
  assert.equal(classifyMailPriority({ important: true, unread: true, bulk: true }), 'urgent');
});
