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
 assert.deepEqual(a.priorities.map(p => [p.itemId, p.reason]), [['urgent', 'important_unread'], ['starredPromo', 'starred_unread'], ['starred', 'starred']]);
 assert.deepEqual(a.firstAction, { itemId: 'urgent', reason: 'important_unread' }); assert.deepEqual(a.review, ['unread'], 'unread alone is pending review, not a priority');
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
  // P2 (08/10/2026): review is ids only, never invented, never also a priority, and unread is no priority reason.
  [{ ...good, review: ['invented'] }, 'local_analysis_reference_invalid'],
  [{ ...good, review: ['x'] }, 'local_analysis_reference_invalid'],
  [{ ...good, review: [{ itemId: 'y', note: 'texto libre' }] }, 'local_analysis_reference_invalid'],
  [{ ...good, review: 'y' }, 'local_analysis_shape'],
  [(({ review, ...rest }) => rest)(good), 'local_analysis_shape'],
  [{ ...good, priorities: [{ itemId: 'x', kind: 'mail', reason: 'unread' }], firstAction: { itemId: 'x', reason: 'unread' } }, 'local_analysis_priority_invalid'],
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

// --- P1 (08/10/2026, PR #37 audit): no usable reasoner is never a silent pass ---
// data.analyze used to enter analysis only with an enabled reasoner; without
// one the items passed through and the mission certified its objective.
const MAIL_SIGNALS = [{ text: 'Gestoría — Modelo 303', signals: { type: 'mail', unread: true, important: true, starred: false, category: 'primary', date: NOW } }];
const CALENDAR_SIGNALS = [{ text: 'Reunión con la gestoría', signals: { type: 'calendar', start: localDay(1), allDay: true } }];
const BARE = [{ text: 'Nota sin señales' }];
const spyReasoner = () => { const calls = []; return { enabled: false, calls, reason: async request => { calls.push(request); throw new Error('a disabled reasoner is never called'); } }; };
async function noReasonerCase({ reasoner, source = 'mail', items, privateAnalyzer }) {
 let decisions = 0; const capability = source === 'mail' ? 'gmail.read' : 'calendar.read';
 const r = createSupervisedRuntime({ membershipProvider, ...(reasoner !== undefined ? { reasoner } : {}), ...(privateAnalyzer ? { privateAnalyzer } : {}), conversationDecider: async () => { decisions++; return { action: 'plan', plan: [{ key: 's', capability, dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['s'] }] }; } });
 const h = await r.openSession(membership.userId);
 r.connections.install(h, source, fixtureAdapter(membership, source + '.read', items));
 const text = 'Revisa lo que tengo y dime qué hago primero.';
 const first = await r.start(h, { text, conversationId: 'conv-0001' }); const second = await r.start(h, { text, conversationId: 'conv-0002' });
 return { first, second, decisions: () => decisions };
}
const certifiedLocally = (c, name) => {
 assert.equal(c.first.status, 'COMPLETED', name); assert.equal(c.first.result.localAnalysis.analyzedLocally, true, name); assert.equal(c.first.result.synthesis, undefined, name);
 assert.ok(c.first.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === true), name); assert.ok(c.first.trace.some(t => t.event === 'COGNITION_SKIPPED' && t.reason === 'no_reasoner'), name);
 assert.equal(c.decisions(), 1, name + ': the certified procedure is learned and reused'); assert.equal(c.second.status, 'COMPLETED', name); assert.equal(c.first.executionEnabled, false, name);
};
const notCertified = (c, name) => {
 assert.equal(c.first.status, 'NEEDS_CAPABILITY', name); assert.equal(c.first.diagnosis.class, 'analysis_unavailable', name); assert.equal(c.first.outcome, 'NEEDS_CAPABILITY', name);
 assert.equal(c.first.result.localAnalysis, undefined, name); assert.equal(c.first.result.synthesis, undefined, name);
 assert.ok(c.first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE'), name); assert.ok(!c.first.trace.some(t => t.event === 'TERMINATE'), name);
 assert.equal(c.decisions(), 2, name + ': no workflow was learned, the request is decided again'); assert.equal(c.second.status, 'NEEDS_CAPABILITY', name); assert.equal(c.first.executionEnabled, false, name);
};

test('P1 1/2/3: with no reasoner (null, absent) or a disabled one, mail or agenda signals are analysed locally, verified and certified', async () => {
 for (const [name, reasoner] of [['null', null], ['absent', undefined], ['disabled', { enabled: false, reason: async () => { throw new Error('never'); } }]]) {
  certifiedLocally(await noReasonerCase({ reasoner, source: 'mail', items: MAIL_SIGNALS }), 'gmail, reasoner ' + name);
  const cal = await noReasonerCase({ reasoner, source: 'calendar', items: CALENDAR_SIGNALS }); certifiedLocally(cal, 'calendar, reasoner ' + name);
  assert.deepEqual(cal.first.result.localAnalysis.context.map(v => v.when), ['tomorrow'], name);
 }
 const mail = await noReasonerCase({ reasoner: null, source: 'mail', items: MAIL_SIGNALS });
 assert.equal(verifyLocalAnalysis(mail.first.result.localAnalysis, mail.first.result.items).verified, true);
 assert.equal(mail.first.result.localAnalysis.firstAction.reason, 'important_unread');
});

test('P1 4/5: no usable reasoner and nothing a local analysis can read is a partial result, never COMPLETED or a learned workflow', async () => {
 for (const [name, reasoner] of [['null', null], ['absent', undefined], ['disabled', { enabled: false }]]) notCertified(await noReasonerCase({ reasoner, items: BARE }), 'bare items, reasoner ' + name);
});

test('P1 6: a local analysis produced without a reasoner that fails its verification is treated as not done', async () => {
 const invented = () => ({ analyzedLocally: true, priorities: [{ itemId: 'invented', kind: 'mail', reason: 'important' }], firstAction: { itemId: 'invented', reason: 'important' }, context: [], noise: [], informational: [], notes: [] });
 for (const [name, privateAnalyzer] of [['invented reference', invented], ['analyzer throws', () => { throw new Error('boom'); }], ['nothing returned', () => null]]) {
  for (const reasoner of [null, { enabled: false }]) {
   const c = await noReasonerCase({ reasoner, items: MAIL_SIGNALS, privateAnalyzer }); notCertified(c, name);
   assert.ok(c.first.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === false), name);
  }
 }
});

test('P1 8: a disabled reasoner receives nothing; the local path sends no content anywhere', async () => {
 const reasoner = spyReasoner(); const c = await noReasonerCase({ reasoner, items: MAIL_SIGNALS });
 certifiedLocally(c, 'disabled spy'); assert.equal(reasoner.calls.length, 0); assert.equal(c.first.actualCostUsd, null); assert.equal(c.first.cost.chargedUsd, 0);
});

// --- P1 closure (08/10/2026, second PR #37 audit): every data.analyze, not the last output ---
// Work reproduced gmail.read -> data.analyze -> memory.search: the barrier saw
// only outputs.at(-1) (memory.search) and the unanalysed mail certified.
const step = (key, capability, dependsOn = []) => ({ key, capability, dependsOn });
// A reasoner whose synthesis quotes its sources verbatim: verified, zero cost.
const synthesizing = () => { const calls = []; return { enabled: true, calls, reason: async ({ request, accept }) => {
 calls.push(request); const content = { findings: request.context.sources.map(s => ({ claim: s.text, quote: s.text, sourceIds: [s.id] })), comparison: '', conclusion: 'Revisar primero lo citado.' };
 assert.equal(accept(content), true); return { content, resource: 'fixture', region: 'eu', privacyClass: 'INTERNAL', usage: { inputTokens: 0, outputTokens: 0 }, chargedUsd: 0, evidence: {}, attempts: [] }; } }; };
async function planCase({ reasoner = null, plans, mail = BARE, calendar = BARE, storage = null }) {
 let decisions = 0; const queue = [...plans];
 const r = createSupervisedRuntime({ membershipProvider, reasoner, conversationDecider: async () => { decisions++; return { action: 'plan', plan: queue.length > 1 ? queue.shift() : queue[0] }; } });
 const h = await r.openSession(membership.userId);
 r.connections.install(h, 'mail', fixtureAdapter(membership, 'mail.read', mail)); r.connections.install(h, 'calendar', fixtureAdapter(membership, 'calendar.read', calendar));
 if (storage) r.connections.install(h, 'storage', fixtureAdapter(membership, 'documents.read', storage));
 const text = 'Revisa mi correo y dime qué hago primero.';
 const first = await r.start(h, { text, conversationId: 'conv-0001' }); const second = await r.start(h, { text, conversationId: 'conv-0002' });
 return { first, second, decisions: () => decisions, r, h };
}
const consulted = s => s.trace.filter(t => t.event === 'CONSULT').map(t => t.capability);
const uncertified = (c, name) => {
 assert.equal(c.first.status, 'NEEDS_CAPABILITY', name); assert.equal(c.first.outcome, 'NEEDS_CAPABILITY', name); assert.equal(c.first.diagnosis.class, 'analysis_unavailable', name);
 assert.ok(!c.first.trace.some(t => t.event === 'TERMINATE'), name + ': no TERMINATE'); assert.ok(c.first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE'), name);
 // The unanalysed output is the partial result: evidence kept, no analysis invented.
 assert.equal(c.first.result.capability, 'data.analyze', name); assert.equal(c.first.result.synthesis, undefined, name); assert.equal(c.first.result.localAnalysis, undefined, name); assert.ok(c.first.result.items.length, name);
 assert.equal(c.decisions(), 2, name + ': no workflow learned, the request is decided again'); assert.equal(c.second.status, 'NEEDS_CAPABILITY', name); assert.equal(c.first.executionEnabled, false, name);
};
const certified = (c, name) => {
 assert.equal(c.first.status, 'COMPLETED', name); assert.ok(c.first.trace.some(t => t.event === 'TERMINATE'), name); assert.ok(!c.first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE'), name);
 assert.equal(c.decisions(), 1, name + ': the certified procedure is learned and reused'); assert.equal(c.second.status, 'COMPLETED', name); assert.equal(c.first.executionEnabled, false, name);
};

test('P1 Work case: gmail.read -> data.analyze -> memory.search with no usable reasoner and no signals never certifies', async () => {
 for (const reasoner of [null, { enabled: false }]) {
  const c = await planCase({ reasoner, plans: [[step('g', 'gmail.read'), step('a', 'data.analyze', ['g']), step('m', 'memory.search', ['a'])]] });
  assert.deepEqual(consulted(c.first), ['gmail.read', 'data.analyze', 'memory.search'], 'the later task ran: the unanalysed step is not the last output');
  uncertified(c, 'work case'); assert.equal(c.first.diagnosis.reason, 'unavailable');
  assert.ok(c.first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE' && t.unanalyzed === 1 && t.last === false));
  assert.deepEqual(c.first.result.items.map(v => v.text), ['Nota sin señales']);
 }
});

test('P1 1/5/6/7: an unanalysed data.analyze anywhere in the plan, followed by any task or last, certifies nothing and learns nothing', async () => {
 for (const [name, plan] of [
  ['then calendar.read', [step('g', 'gmail.read'), step('a', 'data.analyze', ['g']), step('c', 'calendar.read', ['a'])]],
  ['then independent memory.search', [step('g', 'gmail.read'), step('a', 'data.analyze', ['g']), step('m', 'memory.search')]],
  ['last (existing safe behaviour)', [step('g', 'gmail.read'), step('a', 'data.analyze', ['g'])]],
 ]) uncertified(await planCase({ plans: [plan], calendar: CALENDAR_SIGNALS }), name);
});

test('P1 2/3: a verified synthesis or a verified local analysis followed by another task completes normally', async () => {
 const plan = [step('g', 'gmail.read'), step('a', 'data.analyze', ['g']), step('m', 'memory.search', ['a'])];
 const reasoner = synthesizing(); const viaSynthesis = await planCase({ reasoner, plans: [plan] });
 certified(viaSynthesis, 'synthesis'); assert.equal(reasoner.calls.length, 2, 'the replayed procedure analyses again: one call per run, fixture only');
 const local = await planCase({ plans: [plan], mail: MAIL_SIGNALS }); certified(local, 'local analysis');
 assert.ok(local.first.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === true));
});

test('P1 4: several analyses certify only when every one of them was performed', async () => {
 const plan = [step('g', 'gmail.read'), step('a1', 'data.analyze', ['g']), step('c', 'calendar.read'), step('a2', 'data.analyze', ['c']), step('m', 'memory.search', ['a1', 'a2'])];
 certified(await planCase({ plans: [plan], mail: MAIL_SIGNALS, calendar: CALENDAR_SIGNALS }), 'all verified');
 const mailOnly = await planCase({ plans: [plan], mail: MAIL_SIGNALS, calendar: BARE }); uncertified(mailOnly, 'agenda analysis missing');
 assert.ok(mailOnly.first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE' && t.unanalyzed === 1));
 const calendarOnly = await planCase({ plans: [plan], mail: BARE, calendar: CALENDAR_SIGNALS }); uncertified(calendarOnly, 'mail analysis missing');
 const neither = await planCase({ plans: [plan] }); uncertified(neither, 'none'); assert.ok(neither.first.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE' && t.unanalyzed === 2));
});

test('P1 1: the invoice plan (mail -> analysis -> storage proposal) with an unanalysed mail hands nothing to approval', async () => {
 const c = await planCase({ plans: [[step('g', 'gmail.read'), step('a', 'data.analyze', ['g']), step('p', 'storage.propose', ['g', 'a'])]], mail: [{ text: 'Factura agua' }], storage: [] });
 assert.deepEqual(consulted(c.first), ['gmail.read', 'data.analyze', 'storage.propose']);
 uncertified(c, 'invoice proposal'); assert.equal(c.first.approvalId, null);
});

// --- P2 (08/10/2026, fourth real mission): unread alone is pending review, never the first action ---
// An unread Google Play notification (category updates, not important, not
// starred) became the first action only because it was unread.
const firstOf = (...items) => { const a = analyzePrivateItems(items, { now: NOW }); assert.equal(verifyLocalAnalysis(a, items).verified, true); return a; };
const todayAhead = id => event(id, '2026-10-06T15:00:00Z');

test('P2 1-5: unread alone is review; important or starred unread lead; promotions and social stay noise', () => {
 const updates = firstOf(mail('play', { unread: true, category: 'updates' }));
 assert.equal(updates.firstAction, null); assert.deepEqual(updates.priorities, []); assert.deepEqual(updates.review, ['play']);
 assert.deepEqual(firstOf(mail('i', { unread: true, important: true })).firstAction, { itemId: 'i', reason: 'important_unread' });
 assert.deepEqual(firstOf(mail('s', { unread: true, starred: true })).firstAction, { itemId: 's', reason: 'starred_unread' });
 for (const category of ['promotions', 'social']) {
  const a = firstOf(mail('n', { unread: true, category }));
  assert.equal(a.firstAction, null, category); assert.deepEqual(a.noise, ['n'], category); assert.deepEqual(a.review, [], category);
 }
});

test('P2 6-8: with only unread mail there is no first action; a pending event today or an important read mail comes before it', () => {
 assert.equal(firstOf(mail('u', { unread: true })).firstAction, null);
 const withEvent = firstOf(mail('u', { unread: true }), todayAhead('meeting'));
 assert.deepEqual(withEvent.firstAction, { itemId: 'meeting', reason: 'today_event' }); assert.deepEqual(withEvent.review, ['u']);
 const withImportant = firstOf(mail('u', { unread: true }), mail('imp', { important: true }));
 assert.deepEqual(withImportant.firstAction, { itemId: 'imp', reason: 'important' }); assert.deepEqual(withImportant.priorities.map(p => p.itemId), ['imp']); assert.deepEqual(withImportant.review, ['u']);
 // The strong levels keep their order: unread important or starred mail, today's event, then read important or starred mail
 // (within a level the most recent first, unchanged).
 const order = firstOf(mail('st', { starred: true }), mail('im', { important: true }), todayAhead('ev'), mail('su', { starred: true, unread: true }), mail('iu', { important: true, unread: true }), mail('u', { unread: true }));
 assert.deepEqual(order.priorities.slice(0, 2).map(p => p.reason).sort(), ['important_unread', 'starred_unread']); assert.equal(order.priorities[2].reason, 'today_event'); assert.deepEqual(order.priorities.slice(3).map(p => p.reason).sort(), ['important', 'starred']); assert.deepEqual(order.review, ['u']);
});

test('P2 9: the fourth real mission reproduced: the unread Google Play update is pending review, no first action, still a verified and certified analysis', async () => {
 const inbox = [
  raw('gp', ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'], 'Google Play <googleplay-noreply@google.example>', 'Tus Play Points te esperan en PC ☀️'),
  raw('p1', ['INBOX', 'IMPORTANT', 'CATEGORY_PROMOTIONS'], 'Tienda Ejemplo <ofertas@tienda.example>', 'Rebajas de otoño'),
  raw('p2', ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], 'Club Ejemplo <news@club.example>', 'Nuevas ventajas para ti'),
  raw('r1', ['INBOX', 'CATEGORY_PERSONAL'], 'Ana Ejemplo <ana@example.test>', 'Gracias por lo de ayer'),
  raw('r2', ['INBOX', 'CATEGORY_UPDATES'], 'Banco Ejemplo <avisos@banco.example>', 'Tu extracto está disponible'),
 ].map(normalizeGmailMessage);
 const s = await setup(inbox, []);
 try {
  const r = await s.ask(ORDER); const d = r.data.details; const a = d.result.localAnalysis; const textOf = id => d.result.items.find(v => v.id === id).text;
  assert.equal(d.status, 'COMPLETED', 'the analysis exists and is verified'); assert.ok(d.trace.some(t => t.event === 'LOCAL_ANALYSIS' && t.verified === true && t.firstAction === false));
  assert.ok(d.trace.some(t => t.event === 'TERMINATE')); assert.ok(!d.trace.some(t => t.event === 'ANALYSIS_UNAVAILABLE'));
  assert.equal(a.firstAction, null); assert.deepEqual(a.priorities, []);
  assert.equal(a.review.length, 1); assert.match(textOf(a.review[0]), /^Google Play — Tus Play Points te esperan en PC ☀️/);
  assert.equal(a.noise.length, 2); assert.equal(a.informational.length, 2); assert.deepEqual(a.context, []);
  assert.deepEqual(r.data.response.split('\n'), [
   'Hoy no tienes eventos en la agenda.',
   'No veo nada en lo que he consultado que pida actuar primero hoy.',
   'Tienes sin leer, pendiente de revisar, el correo de Google Play («Tus Play Points te esperan en PC ☀️»); no veo en él señales que pidan atenderlo primero.',
   'Otros 2 mensajes recientes parecen notificaciones o promociones; no los pondría por delante.',
   '2 correos recientes ya leídos no muestran señales de urgencia.',
   'Lo he analizado aquí, sin enviar tus datos fuera de OXKIO. No he realizado envíos ni cambios externos.',
  ]);
  assert.doesNotMatch(r.data.response, /Primero|Si quieres empezar/); assert.doesNotMatch(r.data.response, INTERNAL); assert.doesNotMatch(r.data.response, /@/);
  assert.equal(s.p.calls.length, 1, 'only the decision; no private content reached a provider'); assert.ok(!s.p.calls.some(c => /Play Points|Rebajas|extracto/.test(JSON.stringify(c))));
  assert.equal(r.data.executionEnabled, false);
 } finally { s.close(); }
});
