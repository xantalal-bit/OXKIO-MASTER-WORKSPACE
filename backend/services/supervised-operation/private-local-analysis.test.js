'use strict';
// P1 private local analysis (06/10/2026, third real Cliente Cero mission): the
// person's mail and agenda are CONFIDENTIAL, no reasoning resource may receive
// them, and the plan's data.analyze used to pass the items through and close
// the mission as COMPLETED. Now the analysis runs locally and deterministically
// over the signals the sources already return, is verified, and only then
// certifies the objective. Fixtures only: no model, no OAuth.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { Readable } = require('node:stream'); const { randomBytes } = require('node:crypto');
const { analyzePrivateItems, verifyLocalAnalysis } = require('./local-analysis');
const { createPrivateContextAdapters, cleanSourceText } = require('./resource-adapters');
const { validateItems, createSupervisedRuntime } = require('./mission-runtime');
const { createServerComposition } = require('./server-composition');
const { classifyMailPriority, classifyMailSignals } = require('../private-context/mail-priority');
const { normalizeGmailMessage } = require('../private-context/gmail-private-provider');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const INTERNAL = /\b(?:AVAILABLE_NOW|NEEDS_CONNECTION|NEEDS_INFORMATION|NEEDS_CAPABILITY|UNAVAILABLE|BLOCKED|PRIVACY_BLOCKED|CONFIDENTIAL)\b|\b[a-z]+\.(?:read|search|remember|analyze|propose)\b|item-\d|analyzedLocally|important_unread/;
const INVISIBLE = /[\p{Cf}͏]/u;

// --- Unit: the analysis -----------------------------------------------------
const NOW = '2026-10-06T10:00:00.000Z';
const mail = (id, signals, text = 'Remitente ' + id + ' — Asunto ' + id) => ({ id, text, signals: { type: 'mail', unread: false, important: false, starred: false, category: 'primary', date: '2026-10-06T08:00:00.000Z', ...signals } });
const event = (id, start, allDay = start.length === 10) => ({ id, text: start + ' · Evento ' + id, signals: { type: 'calendar', start, allDay } });

test('1/2/3/4: mail priority reuses the Executive Chat classification; stars count, promotions and social are noise, unread alone is never urgent', () => {
 const items = [mail('promo', { unread: true, important: true, category: 'promotions' }), mail('social', { unread: true, category: 'social' }), mail('unread', { unread: true }),
  mail('starred', { starred: true }), mail('urgent', { unread: true, important: true }), mail('read', {}), mail('starredPromo', { starred: true, unread: true, category: 'promotions' })];
 const a = analyzePrivateItems(items, { now: NOW });
 assert.deepEqual(a.priorities.map(p => [p.itemId, p.reason]), [['urgent', 'important_unread'], ['starredPromo', 'starred_unread'], ['starred', 'starred'], ['unread', 'unread']]);
 assert.deepEqual(a.firstAction, { itemId: 'urgent', reason: 'important_unread' });
 assert.deepEqual([...a.noise].sort(), ['promo', 'social']); assert.deepEqual(a.informational, ['read']);
 // The V2 function itself is unchanged; the extension lives beside it.
 assert.equal(classifyMailPriority({ unread: true }), 'review'); assert.equal(classifyMailPriority({ important: true, unread: true, category: 'promotions' }), 'urgent');
 assert.equal(classifyMailSignals({ unread: true }), 'review', 'unread alone is review, not urgent');
 assert.equal(verifyLocalAnalysis(a, items).verified, true);
});

test('5/6/7: agenda by proximity; a timed event still ahead today is a priority, all-day or tomorrow events are context; mail and agenda combine in one order', () => {
 const items = [event('birthday', '2026-10-07'), event('meeting', '2026-10-06T15:00:00Z'), event('allDayToday', '2026-10-06'), event('earlier', '2026-10-06T07:00:00Z'), event('friday', '2026-10-09'), event('past', '2026-10-01'),
  mail('urgent', { unread: true, important: true }), mail('important', { important: true }), mail('note', {}, 'Llamar al gestor')].map(v => v.id === 'note' ? { id: 'note', text: v.text } : v);
 const a = analyzePrivateItems(items, { now: NOW });
 assert.deepEqual(a.priorities.map(p => p.itemId), ['urgent', 'meeting', 'important']);
 // Chronological, an all-day event first within its day.
 assert.deepEqual(a.context.map(c => [c.itemId, c.when]), [['allDayToday', 'today'], ['earlier', 'today'], ['birthday', 'tomorrow'], ['friday', 'upcoming']]);
 assert.ok(!JSON.stringify(a).includes('past'), 'a past event is not cited'); assert.deepEqual(a.notes, ['note']);
 assert.equal(verifyLocalAnalysis(a, items).verified, true);
 // Only tomorrow's birthday: context, never today's first action.
 const only = analyzePrivateItems([event('birthday', '2026-10-07')], { now: NOW });
 assert.equal(only.firstAction, null); assert.deepEqual(only.context, [{ itemId: 'birthday', when: 'tomorrow' }]);
});

test('8/15: no actionable priority is explicit; the verifier rejects invented or misplaced references, free text and a self-declared analysis', () => {
 const items = [mail('promo', { unread: true, category: 'promotions' }), mail('read', {})];
 const a = analyzePrivateItems(items, { now: NOW });
 assert.equal(a.firstAction, null); assert.deepEqual(a.priorities, []); assert.equal(verifyLocalAnalysis(a, items).verified, true);
 const good = analyzePrivateItems([mail('x', { important: true, unread: true }), mail('y', { important: true })], { now: NOW }); const goodItems = [mail('x', {}), mail('y', {})];
 const broken = [
  [{ ...good, priorities: [{ itemId: 'invented', kind: 'mail', reason: 'important' }] }, 'local_analysis_priority_invalid'],
  [{ ...good, firstAction: { itemId: 'y', reason: 'important' } }, 'local_analysis_first_action_invalid'],
  [{ ...good, firstAction: null }, 'local_analysis_first_action_invalid'],
  [{ ...good, summary: 'Tienes una reunión con el ministro' }, 'local_analysis_shape'],
  [{ ...good, priorities: [{ itemId: 'x', kind: 'mail', reason: 'important_unread', note: 'texto libre' }] }, 'local_analysis_priority_invalid'],
  [{ ...good, analyzedLocally: false }, 'local_analysis_missing'],
  [{ ...good, noise: ['x'] }, 'local_analysis_reference_invalid'],
 ];
 for (const [analysis, code] of broken) assert.deepEqual(verifyLocalAnalysis(analysis, goodItems), { verified: false, code });
});

// --- Unit: signals and text hygiene -------------------------------------------
const OBSERVED = 'Echa un vistazo a su red ͏ ͏ ͏ ‌ ͏ ‌ ͏ ‌ final';
test('9/10: invisible format characters observed in the real mission (U+034F, ZWNJ) and other \\p{Cf} are removed; letters, accents and emoji stay', () => {
 assert.equal(cleanSourceText(OBSERVED), 'Echa un vistazo a su red final');
 assert.equal(cleanSourceText('Re​unión­mañana﻿ ✅ José'), 'Reuniónmañana ✅ José');
 assert.equal(cleanSourceText('  Asunto   con\tespacios  '), 'Asunto con espacios');
 assert.doesNotMatch(cleanSourceText(OBSERVED + '‍⁠'), INVISIBLE);
});

const A = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa' };
const raw = (id, labels, from, subject, snippet = 'Vista previa' + ' ͏'.repeat(20)) => ({ id, threadId: 't-' + id, labelIds: labels, snippet, payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Date', value: 'Mon, 06 Oct 2026 09:00:00 +0200' }] } });
test('11/19: Gmail flags survive the production double normalization and reach the V3 items as a closed allowlist; the sender is named, never addressed', async () => {
 // V2 shared normalization: additive fields, idempotent on its own output.
 const once = normalizeGmailMessage(raw('m1', ['INBOX', 'UNREAD', 'IMPORTANT', 'STARRED', 'CATEGORY_PERSONAL'], '"Ana Ruiz" <ana@example.test>', 'Contrato'));
 const twice = normalizeGmailMessage(once);
 assert.deepEqual([once.unread, once.important, once.starred, once.category], [true, true, true, 'primary']); assert.deepEqual(twice, once);
 const readers = { gmailReader: async () => ({ privatePayload: { messages: [twice, { ...twice, category: 'invented', extra: 'x' }] } }), calendarReader: async () => ({ privatePayload: { events: [{ id: 'e', title: 'ELENA - Cumpleaños ‌', start: '2026-10-07', allDay: true, location: null, organizer: 'x@example.test' }] } }) };
 const adapters = createPrivateContextAdapters({ scope: A, readers, origin: 'fixture' });
 const mails = validateItems(await adapters.mail.read({ scope: A, limits: {} }), A, 'GMAIL', 'fixture');
 const events = validateItems(await adapters.calendar.read({ scope: A, limits: {} }), A, 'CALENDAR', 'fixture');
 assert.equal(mails[0].text, 'Ana Ruiz — Contrato — Vista previa'); assert.doesNotMatch(mails[0].text, /@|͏/);
 assert.deepEqual(mails[0].signals, { type: 'mail', unread: true, important: true, starred: true, category: 'primary', date: '2026-10-06T07:00:00.000Z' });
 assert.equal(mails[1].signals.category, null, 'an unknown category is dropped'); assert.equal('extra' in mails[1].signals, false);
 assert.deepEqual(events[0].signals, { type: 'calendar', start: '2026-10-07', allDay: true }); assert.equal(events[0].text, '2026-10-07 · ELENA - Cumpleaños');
 // Signals belong to their own source only.
 assert.equal(validateItems({ ...A, items: [{ text: 'x', signals: { type: 'mail', unread: true } }] }, A, 'PUBLIC_WEB', 'fixture')[0].signals, undefined);
 assert.equal(validateItems({ ...A, items: [{ text: 'x', signals: { type: 'calendar', start: 'mañana' } }] }, A, 'CALENDAR', 'fixture')[0].signals.start, null);
});

// --- End to end: the real mission's shape ---------------------------------------
const UID = 'fixture-cliente-cero'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
const ORDER = 'Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.';
const PRIVATE = /Gestoría|Modelo 303|Cumpleaños|LinkedIn|PayPal|Amazon|Learning/;
const localDay = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// Same shape as the real 20:02 mission: a birthday tomorrow and recent inbox mail;
// here one of them is a real pending matter, the rest notifications and offers.
const REAL_INBOX = [
 raw('li1', ['INBOX', 'UNREAD', 'CATEGORY_SOCIAL'], '"Juan Ejemplo a través de LinkedIn" <invitations@linkedin.example>', 'Juan ha aceptado tu invitación'),
 raw('lh', ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], 'Learning Ejemplo <news@learning.example>', 'Si buscas esto, mejor piénsatelo'),
 raw('pp', ['INBOX', 'CATEGORY_UPDATES'], 'PayPal Ejemplo <service@paypal.example>', 'Cambios en nuestros términos'),
 raw('am', ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PROMOTIONS'], '"Amazon Ejemplo" <ofertas@amazon.example>', 'Fiesta de Ofertas Prime'),
 raw('li2', ['INBOX', 'UNREAD', 'CATEGORY_SOCIAL'], '"Gabriel Ejemplo a través de LinkedIn" <messages@linkedin.example>', 'Gabriel acaba de enviarte un mensaje'),
 raw('ge', ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'], 'Gestoría Ejemplo <gestoria@example.test>', 'Modelo 303: falta tu confirmación'),
].map(normalizeGmailMessage);
function decider() { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); return { status: 'ok', content: { action: 'plan', plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'c', capability: 'calendar.read', dependsOn: [] }, { key: 'g', capability: 'gmail.read', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['m', 'c', 'g'] }] }, usage: { inputTokens: 700, outputTokens: 250 } }; } }; }
async function setup(inbox, events) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-local-analysis-')); const p = decider();
 // The production reader path: buildGmailPrivateContext output (already normalized) into the V3 adapters.
 const readers = { gmailReader: async () => ({ privatePayload: { messages: inbox.map(normalizeGmailMessage) } }), calendarReader: async () => ({ privatePayload: { events } }) };
 const server = createServerComposition({ enabled: true, cohortUids: UID, integrityKey: randomBytes(32), memoryRoot: root, authorizeIdentity: authorize, privateContextReaders: () => readers, reasoning: { providers: [p], privacyPolicy: POLICY, requestPrivacyFloor: 'INTERNAL', approvedDailyBudgetUsd: 0.9 } });
 const ask = async (query, conversationId = 'conversation-local-1') => { const req = Readable.from([JSON.stringify({ query, includeDetails: true, conversationId })]); req.oxkioIdentity = authorize({ uid: UID }).identity; let status, body; await server.handle(req, { writeHead(s) { status = s; }, end(b) { body = b; } }); return { status, data: JSON.parse(body) }; };
 return { p, ask, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('contrast with the real mission: tomorrow\'s birthday is context, promotions never lead, the actionable mail comes first; analysed locally, verified, certified', async () => {
 const s = await setup(REAL_INBOX, [{ id: 'e1', title: 'ELENA - Cumpleaños', start: localDay(1), end: localDay(2), allDay: true, location: null }]);
 try {
  const r = await s.ask(ORDER); const d = r.data.details; const lines = r.data.response.split('\n');
  assert.equal(d.status, 'COMPLETED'); assert.equal(d.result.localAnalysis.analyzedLocally, true); assert.equal(d.result.cognitionSkipped, 'privacy');
  assert.ok(d.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === true));
  assert.deepEqual(lines.slice(0, 3), [
   'Hoy no tienes eventos en la agenda.',
   'Mañana: ELENA - Cumpleaños.',
   'Primero revisaría el correo de Gestoría Ejemplo («Modelo 303: falta tu confirmación»), porque está marcado como importante y todavía no lo has leído.',
  ]);
  assert.ok(lines.includes('Otros 4 mensajes recientes parecen notificaciones o promociones; no los pondría por delante.'));
  assert.ok(lines.includes('Un correo reciente ya leído no muestra señales de urgencia.'));
  assert.equal(lines.at(-1), 'Lo he analizado aquí, sin enviar tus datos fuera de OXKIO. No he realizado envíos ni cambios externos.');
  assert.doesNotMatch(r.data.response, /Amazon|Después/, 'an important-looking promotion never leads');
  assert.doesNotMatch(r.data.response, INVISIBLE); assert.doesNotMatch(r.data.response, /@/); assert.doesNotMatch(r.data.response, INTERNAL);
  // 12/13: the only call was the decision; no private content ever reached the provider.
  assert.equal(s.p.calls.length, 1); assert.ok(!s.p.calls.some(c => PRIVATE.test(JSON.stringify(c))));
  assert.equal(r.data.executionEnabled, false);
  // 18: a verified analysis certifies normally; the procedure is learned and reused.
  const again = await s.ask(ORDER, 'conversation-local-2'); assert.equal(again.data.details.status, 'COMPLETED'); assert.equal(s.p.calls.length, 1);
 } finally { s.close(); }
});

test('8: when nothing is actionable OXKIO says so instead of inventing a priority', async () => {
 const s = await setup(REAL_INBOX.filter(m => m.id !== 'ge'), [{ id: 'e1', title: 'ELENA - Cumpleaños', start: localDay(1), allDay: true }]);
 try {
  const r = await s.ask(ORDER);
  assert.equal(r.data.details.status, 'COMPLETED'); assert.equal(r.data.details.result.localAnalysis.firstAction, null);
  assert.match(r.data.response, /^Hoy no tienes eventos en la agenda\.\nMañana: ELENA - Cumpleaños\.\nNo veo nada en lo que he consultado que pida actuar primero hoy\.\n/);
  assert.doesNotMatch(r.data.response, /Primero|Si quieres empezar/);
 } finally { s.close(); }
});

// --- Runtime: no verified analysis, no certified objective ------------------------
const membership = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa', roles: ['owner'], status: 'ACTIVE' };
const membershipProvider = { findMemberships: async ({ authenticatedUserId }) => [membership].filter(v => v.userId === authenticatedUserId) };
const blocked = failure => ({ enabled: true, reason: async () => { throw Object.assign(new Error('blocked'), { code: 'reasoning_resource_unavailable', attempts: [{ resource: 'fixture', failure }] }); } });
const fixtureAdapter = (scope, permission, items) => ({ ...scope, origin: 'fixture', scopes: [permission], read: async () => ({ ...scope, items }) });
async function runtimeCase({ privateAnalyzer, failure = 'PRIVACY_BLOCKED' }) {
 let decisions = 0;
 const r = createSupervisedRuntime({ membershipProvider, reasoner: blocked(failure), ...(privateAnalyzer ? { privateAnalyzer } : {}), conversationDecider: async () => { decisions++; return { action: 'plan', plan: [{ key: 'g', capability: 'gmail.read', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['g'] }] }; } });
 const h = await r.openSession(membership.userId);
 r.connections.install(h, 'mail', fixtureAdapter(membership, 'mail.read', [{ text: 'Gestoría — Modelo 303', signals: { type: 'mail', unread: true, important: true, starred: false, category: 'primary', date: NOW } }]));
 const text = 'Revisa lo que tengo y dime qué es urgente.';
 const first = await r.start(h, { text, conversationId: 'conv-0001' }); const second = await r.start(h, { text, conversationId: 'conv-0002' });
 return { first, second, decisions: () => decisions, r };
}
test('16/17/20: a local analysis that fails or cannot be verified, or an analysis no resource performed, never certifies the objective or teaches a workflow', async () => {
 for (const [name, options] of [
  ['invented reference', { privateAnalyzer: () => ({ analyzedLocally: true, priorities: [{ itemId: 'invented', kind: 'mail', reason: 'important' }], firstAction: { itemId: 'invented', reason: 'important' }, context: [], noise: [], informational: [], notes: [] }) }],
  ['analyzer throws', { privateAnalyzer: () => { throw new Error('boom'); } }],
  ['provider failed (not privacy): no local analysis', { failure: 'INVALID_OUTPUT' }],
 ]) {
  const { first, second, decisions } = await runtimeCase(options);
  assert.equal(first.status, 'NEEDS_CAPABILITY', name); assert.equal(first.diagnosis.class, 'analysis_unavailable', name); assert.equal(first.result.localAnalysis, undefined, name);
  assert.ok(first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE'), name); assert.ok(!first.trace.some(t => t.event === 'TERMINATE'), name);
  if (options.privateAnalyzer) assert.ok(first.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === false), name);
  assert.equal(decisions(), 2, name + ': no workflow was learned, the request is decided again'); assert.equal(second.status, 'NEEDS_CAPABILITY', name);
  assert.equal(first.executionEnabled, false, name);
 }
 // 14/18: the real analyzer is marked as local and certifies normally.
 const ok = await runtimeCase({});
 assert.equal(ok.first.status, 'COMPLETED'); assert.equal(ok.first.result.localAnalysis.analyzedLocally, true); assert.equal(ok.decisions(), 1, 'a certified procedure is reused');
 assert.ok(ok.first.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === true && t.firstAction === true));
});
