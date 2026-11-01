'use strict';
// Cliente Cero on the private Cloud Run revision (01/11/2026). The revision runs
// V3 without its own reasoning provider (the deploy script forbids
// OXKIO_V3_REASONING_* there), so only deterministic vocabulary is understood:
// - a first-person memory question ("¿Qué código guardé…?") fell to the generic
//   clarification instead of searching the person's memory;
// - an agenda request waiting for Google showed only text, with no way to start
//   the existing «Conectar Google» flow from the chat.
// Synthetic data only; no real OAuth, mail or calendar.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const vm = require('node:vm'); const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { createExecutiveReasoningProvider, buildReasoningCostCatalog } = require('../executive-brain/executive-reasoning-provider');
const { interpretIntention } = require('./intention-interpreter');

const UID = 'fixture-owner-a'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const GENERIC = /^Para avanzar necesito concretar el objetivo/;

async function cloudLike() {
 // Same wiring as server.js with no OXKIO_V3_REASONING_* variables.
 const provider = createExecutiveReasoningProvider({ env: {} });
 assert.notEqual(provider.status, 'ready');
 const composition = createServerComposition({ enabled: true, cohortUids: UID, memoryRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'v3-cloud-chat-')), integrityKey: randomBytes(32), authorizeIdentity: authorize, reasoning: { provider, catalog: buildReasoningCostCatalog(provider), approvedDailyBudgetUsd: 0 } });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid: UID }).identity; composition.handle(req, res).catch(() => { res.writeHead(500); res.end('{}'); }); });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const ask = async (query, conversationId = 'conversation-cloud-1') => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/executive/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, conversationId }) });
  return { status: res.status, data: await res.json() };
 };
 return { ask, close: () => new Promise(r => server.close(r)) };
}

test('first-person memory questions search the person\'s memory without a reasoning provider', async () => {
 const s = await cloudLike();
 try {
  const saved = await s.ask('Recuerda que el código de la prueba sintética es ZZ-SYN-42');
  assert.equal(saved.status, 200); assert.match(saved.data.response, /He guardado/);
  for (const q of ['¿Qué código guardé para la prueba sintética?', '¿Qué apunté sobre la prueba sintética?', '¿Qué tienes guardado de la prueba sintética?', '¿Recuerdas el código de la prueba sintética?']) {
   const r = await s.ask(q, 'conversation-cloud-2');
   assert.equal(r.status, 200, q);
   assert.doesNotMatch(r.data.response, GENERIC, q);
   assert.match(r.data.response, /ZZ-SYN-42/, q);
   assert.equal(r.data.connect, undefined, q);
   assert.equal(r.data.executionEnabled, false);
  }
 } finally { await s.close(); }
});

test('the new first-person cues only add a memory search; they never consent to a memory write', () => {
 for (const q of ['¿Qué código guardé?', '¿Qué apunté ayer?', '¿Qué anoté sobre el viaje?', '¿Qué tienes guardado de mi viaje?']) {
  const i = interpretIntention(q);
  assert.ok(i.capabilities.includes('memory.search'), q);
  assert.ok(!i.capabilities.includes('memory.remember'), q);
 }
});

test('an agenda request waiting for Google offers the existing connection flow, and nothing else does', async () => {
 const s = await cloudLike();
 try {
  const r = await s.ask('¿Qué tengo esta semana en la agenda?', 'conversation-cloud-3');
  assert.equal(r.status, 200);
  assert.equal(r.data.outcome, 'NEEDS_CONNECTION');
  assert.equal(r.data.connect, 'google');
  assert.equal(r.data.executionEnabled, false);
  assert.match(r.data.response, /continúa/);
  const other = await s.ask('Recuerda que la reunión sintética es el martes', 'conversation-cloud-4');
  assert.equal(other.data.connect, undefined);
 } finally { await s.close(); }
});

test('the gateway offers Google only for a connectable agenda or mail gap', () => {
 const src = fs.readFileSync(path.join(__dirname, 'chat-gateway.js'), 'utf8');
 assert.match(src, /const GOOGLE_PROVIDERS = \['calendar','mail'\];/);
 assert.match(src, /state\.status==='NEEDS_CONNECTION'&&\(state\.connectionRequests\|\|\[\]\)\.some\(g=>g&&g\.connectable&&GOOGLE_PROVIDERS\.includes\(g\.provider\)\)\?\{connect:'google'\}:\{\}/);
});

test('the chat button reuses /oauth/google with the Firebase session and only follows Google\'s consent page', () => {
 const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'js', 'executive-chat.js'), 'utf8');
 assert.match(src, /if \(data\.connect === 'google'\) \{\s*appendGoogleConnect\(assistantMessage\);/);
 assert.match(src, /window\.oxkioAuthenticatedFetch\('\/oauth\/google'\)/);
 assert.match(src, /isGoogleConsentUrl\(data\.authUrl\)\) \{\s*window\.location\.href = data\.authUrl;/);
 const fn = src.replace(/\r\n/g, '\n').match(/const GOOGLE_CONSENT_HOST = [^\n]+\n\nfunction isGoogleConsentUrl[\s\S]*?\n}\n/);
 assert.ok(fn, 'isGoogleConsentUrl present');
 const sandbox = { URL }; vm.runInNewContext(fn[0] + 'this.check = isGoogleConsentUrl;', sandbox);
 assert.equal(sandbox.check('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y'), true);
 for (const bad of ['http://accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com.evil.example/auth', 'https://evil.example/?accounts.google.com', 'javascript:alert(1)', '', null, undefined]) assert.equal(sandbox.check(bad), false, String(bad));
});
