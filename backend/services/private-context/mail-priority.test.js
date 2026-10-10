'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAIL_PRIORITY_LEVELS, classifyMailPriority, classifyMailSignals, countsAsImportant, isAutomatedSenderAddress } = require('./mail-priority');

test('automated sender: a whole news/newsletter(s)/digest token in the local part or a subdomain; noreply alone is not one', () => {
  for (const from of ['hello@news.railway.app', 'Railway <hello@news.railway.app>', 'newsletters-noreply@linkedin.com', 'messaging-digest-noreply@linkedin.com', 'news@club.example', '"Club" <Newsletter@club.example>', 'a.digest+x@mail.example'])
    assert.equal(isAutomatedSenderAddress(from), true, from);
  for (const from of ['no-reply@servicio.example', 'noreply@banco.example', 'persona@empresa.example', 'newsroom@diario.example', 'ana@news.example', 'ana@bbc-news.example', 'Ana <ana@example.test> news', 'news', '', null, undefined])
    assert.equal(isAutomatedSenderAddress(from), false, String(from));
});

test('automated sender counts as bulk only in updates, social or promotions; a direct message and a star keep precedence', () => {
  assert.equal(classifyMailSignals({ important: true, automatedSender: true, category: 'updates' }), 'informational');
  assert.equal(classifyMailSignals({ important: true, unread: true, automatedSender: true, category: 'updates' }), 'review');
  assert.equal(classifyMailSignals({ important: true, automatedSender: true, category: 'primary' }), 'important');
  assert.equal(classifyMailSignals({ important: true, automatedSender: true, category: null }), 'important');
  assert.equal(classifyMailSignals({ unread: true, automatedSender: true, directMessage: true, category: 'social' }), 'review');
  assert.equal(classifyMailSignals({ important: true, unread: true, automatedSender: true, directMessage: true, category: 'social' }), 'urgent');
  assert.equal(classifyMailSignals({ important: true, starred: true, automatedSender: true, category: 'updates' }), 'important');
  assert.equal(countsAsImportant({ important: true, automatedSender: true, category: 'updates' }), false);
  assert.equal(countsAsImportant({ important: true, category: 'updates' }), true);
});

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
