'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAIL_PRIORITY_LEVELS, classifyMailPriority, classifyMailSignals, countsAsImportant, isAutomatedSenderAddress, selectRelevantMailCandidates } = require('./mail-priority');

// Selector fixtures: newest first, one minute apart, as Gmail lists INBOX.
const at = (minutesAgo) => new Date(Date.UTC(2026, 9, 10, 10, 0) - minutesAgo * 60000).toISOString();
const item = (id, minutesAgo, signals = {}) => ({ id, signals: { type: 'mail', unread: false, important: false, starred: false, bulk: false, automatedSender: false, directMessage: false, category: 'primary', date: at(minutesAgo), ...signals } });
const promo = (id, minutesAgo) => item(id, minutesAgo, { unread: true, bulk: true, category: 'promotions' });
const ids = (list) => list.map((v) => v.id);

test('selection 1/2: five newer promotions never push out a direct message (6th) or a person\'s important mail (7th)', () => {
  const inbox = [promo('p1', 1), promo('p2', 2), promo('p3', 3), promo('p4', 4), promo('p5', 5),
    item('dm', 6, { unread: true, category: 'social', directMessage: true, bulk: true, automatedSender: true }),
    item('imp', 7, { important: true, category: 'updates' })];
  assert.deepEqual(ids(selectRelevantMailCandidates(inbox, { maxItems: 5 })), ['p1', 'p2', 'p3', 'dm', 'imp']);
  // Only room for two: the people win, in reading order.
  assert.deepEqual(ids(selectRelevantMailCandidates(inbox, { maxItems: 2 })), ['dm', 'imp']);
});

test('selection 5: twenty promotions fill at most a sample of three, never the candidates', () => {
  const inbox = Array.from({ length: 20 }, (_, i) => promo('p' + i, i));
  assert.deepEqual(ids(selectRelevantMailCandidates(inbox, { maxItems: 8 })), ['p0', 'p1', 'p2']);
});

test('selection 6: twenty people\'s messages respect maxItems, the most recent first, deterministically', () => {
  const inbox = Array.from({ length: 20 }, (_, i) => item('h' + i, i, { unread: true }));
  const first = selectRelevantMailCandidates(inbox, { maxItems: 8 });
  assert.deepEqual(ids(first), ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']);
  assert.deepEqual(ids(selectRelevantMailCandidates([...inbox], { maxItems: 8 })), ids(first), 'same input, same output');
  // Same date: the reading order decides.
  const tied = ['a', 'b', 'c'].map((id) => item(id, 0, { unread: true }));
  assert.deepEqual(ids(selectRelevantMailCandidates(tied, { maxItems: 2 })), ['a', 'b']);
});

test('selection 7 and order: an old star survives newer promotions; ranks go direct, star, important, unread person, read person, bulk, noise', () => {
  const inbox = [promo('p1', 1), promo('p2', 2), promo('p3', 3), promo('p4', 4),
    item('bulkRead', 5, { important: true, automatedSender: true, category: 'updates' }),
    item('read', 6), item('unread', 7, { unread: true }), item('imp', 8, { important: true }),
    item('star', 19, { starred: true, category: 'promotions' }), item('dm', 20, { unread: true, directMessage: true, category: 'social' })];
  for (const [max, expected] of [[1, ['dm']], [2, ['star', 'dm']], [3, ['imp', 'star', 'dm']], [4, ['unread', 'imp', 'star', 'dm']],
    [5, ['read', 'unread', 'imp', 'star', 'dm']], [6, ['bulkRead', 'read', 'unread', 'imp', 'star', 'dm']], [7, ['p1', 'bulkRead', 'read', 'unread', 'imp', 'star', 'dm']]])
    assert.deepEqual(ids(selectRelevantMailCandidates(inbox, { maxItems: max })), expected, 'maxItems ' + max);
});

test('selection is not prioritization: it never changes signals or classification, and fails safe', () => {
  const railway = item('rw', 1, { important: true, automatedSender: true, category: 'updates' });
  const inbox = [railway, item('u', 2, { unread: true })];
  const before = JSON.stringify(inbox);
  const chosen = selectRelevantMailCandidates(inbox, { maxItems: 8 });
  assert.deepEqual(ids(chosen), ['rw', 'u'], 'Railway is selected when there is room');
  assert.equal(chosen[0], railway, 'the same objects, untouched'); assert.equal(JSON.stringify(inbox), before);
  assert.equal(classifyMailSignals(chosen[0].signals), 'informational', 'selected, still not a priority by important alone');
  assert.deepEqual(selectRelevantMailCandidates(null), []); assert.deepEqual(selectRelevantMailCandidates(inbox, { maxItems: 0 }), []);
  // Malformed entries do not throw; they keep their reading order.
  const odd = [{ id: 'x' }, null];
  assert.deepEqual(selectRelevantMailCandidates(odd, { maxItems: 8 }), [{ id: 'x' }, null]);
});

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
