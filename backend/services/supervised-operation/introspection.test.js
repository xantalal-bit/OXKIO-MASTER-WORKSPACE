'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { createPrivateContextAdapters } = require('./resource-adapters');
const { createSupervisedRuntime } = require('./mission-runtime');
const UID = 'cliente-cero-controlled';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const identity = authorize({ uid: UID }).identity;
const questions = [
 'OXKIO, dime qué capacidades tienes disponibles ahora mismo para ayudarme y cuáles necesitan conexión, capacidad adicional o autorización.',
 'Quiero que analices tu propio estado operativo actual. Dime qué puedes hacer ahora mismo conmigo como Cliente Cero, qué recursos y conexiones tienes realmente disponibles, cuáles no están disponibles y por qué. No ejecutes acciones externas ni inventes capacidades.',
 '¿Qué puedes hacer?', '¿Qué capacidades tienes?', '¿Qué tienes conectado?', '¿Qué necesitas para enviar un correo?', 'Analiza tu estado operativo.',
];
async function setup(options = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-introspection-'));
 const server = createServerComposition({ enabled: true, cohortUids: UID, integrityKey: randomBytes(32), memoryRoot: root, authorizeIdentity: authorize, ...options });
 async function request(query, who = identity) {
  const req = Readable.from([JSON.stringify({ query, includeDetails: true })]); req.oxkioIdentity = who;
  let status, headers, body;
  await server.handle(req, { writeHead(s, h) { status = s; headers = h; }, end(b) { body = b; } });
  return { status, headers, data: body ? JSON.parse(body) : null };
 }
 return { request, server, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('real V3 handler exposes the existing per-owner catalogue for every incident question, without planner or tool calls', async () => {
 let calls = 0;
 const s = await setup({ reasoning: { provider: { status: 'ready', reason: async () => { calls++; throw Error('must not run'); } }, approvedDailyBudgetUsd: 0 } });
 try {
  for (const question of questions) {
   const r = await s.request(question);
   assert.equal(r.status, 200); assert.equal(r.headers['X-OXKIO-Handler'], 'supervised-operation');
   assert.equal(r.data.outcome, 'CAN_EXECUTE'); assert.equal(r.data.details.reason, 'operational_state');
   assert.equal(r.data.missionId, null); assert.equal(r.data.executionEnabled, false);
   const rows = r.data.details.capabilities;
   assert.equal(rows.find(v => v.id === 'memory.search').status, 'AVAILABLE');
   assert.equal(rows.find(v => v.id === 'gmail.read').status, 'NEEDS_CONNECTION');
   assert.equal(rows.find(v => v.id === 'drive.read').status, 'NOT_IMPLEMENTED');
   assert.equal(rows.find(v => v.id === 'external.write').status, 'HUMAN_GATE');
   assert.match(r.data.response, /Disponible:/); assert.match(r.data.response, /No implementado:/);
   assert.match(r.data.response, /deshabilitada/);
  }
  assert.equal(calls, 0);
 } finally { s.cleanup(); }
});
test('the controlled authenticated Cliente Cero HTTP boundary preserves all six outcomes and actual memory execution', async () => {
 const s = await setup();
 try {
  for (const [query, outcome] of [['¿Qué capacidades tienes?', 'CAN_EXECUTE'], ['Resuelve xyzzy', 'NEEDS_INFORMATION'], ['Revisa mi correo', 'NEEDS_CONNECTION'], ['Lee Google Drive', 'NEEDS_CAPABILITY'], ['Envía un correo', 'NEEDS_APPROVAL'], ['Paga una factura', 'BLOCKED']]) {
   const r = await s.request(query); assert.equal(r.status, 200); assert.equal(r.data.outcome, outcome, query); assert.equal(r.data.executionEnabled, false);
  }
  const saved = await s.request('Recuerda que esta es la prueba controlada de Cliente Cero V3');
  assert.equal(saved.data.details.status, 'COMPLETED'); assert.match(saved.data.response, /guardado/);
  const retrieved = await s.request('Recupera memoria'); assert.match(retrieved.data.response, /prueba controlada/);
  assert.equal((await s.request('¿Qué capacidades tienes?', null)).status, 401);
  assert.equal((await s.request('¿Qué capacidades tienes?', { ...identity, uid: 'foreign-uid' })).status, 403);
 } finally { s.cleanup(); }
});
test('an installed but unread private adapter is not advertised AVAILABLE; Google invalid_grant remains expired on the next chat', async () => {
 let reads = 0;
 const reader = async () => { reads++; throw Object.assign(new Error('redacted'), { code: 400, response: { data: { error: 'invalid_grant' } } }); };
 const s = await setup({ privateContextReaders: () => ({ gmailReader: reader, calendarReader: reader }) });
 try {
  let r = await s.request('¿Qué tienes conectado?');
  assert.equal(reads, 0);
  assert.equal(r.data.details.capabilities.find(v => v.id === 'gmail.read').status, 'NEEDS_CONNECTION');
  assert.equal(r.data.details.capabilities.find(v => v.id === 'gmail.read').connection, 'NOT_VERIFIED');
  r = await s.request('Revisa mi correo'); assert.equal(r.data.outcome, 'NEEDS_CONNECTION'); assert.equal(reads, 1);
  r = await s.request('¿Qué tienes conectado?');
  assert.equal(r.data.details.capabilities.find(v => v.id === 'gmail.read').connection, 'EXPIRED'); assert.equal(reads, 1);
 } finally { s.cleanup(); }
});
test('successful scoped private read updates the same catalogue, while other owners remain disconnected', async () => {
 const A = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa', roles: ['owner'], status: 'ACTIVE' };
 const B = { ...A, tenantId: 'tenant-bbb', clientId: 'client-bbb', userId: 'user-bbb' };
 const r = createSupervisedRuntime({ membershipProvider: { findMemberships: async ({ authenticatedUserId }) => [A, B].filter(x => x.userId === authenticatedUserId) } });
 const a = await r.openSession(A.userId), b = await r.openSession(B.userId);
 const adapters = createPrivateContextAdapters({ scope: A, origin: 'fixture', readers: { gmailReader: async () => ({ privatePayload: { messages: [{ subject: 'controlled source' }] } }), calendarReader: async () => ({ privatePayload: { events: [] } }) } });
 r.connections.install(a, 'mail', adapters.mail);
 assert.equal(r.onboarding(a).capabilities.find(v => v.id === 'gmail.read').status, 'NEEDS_CONNECTION');
 const result = await r.start(a, { text: 'Revisa correo', conversationId: 'conv-0001' }); assert.equal(result.status, 'COMPLETED');
 assert.equal(r.onboarding(a).capabilities.find(v => v.id === 'gmail.read').status, 'AVAILABLE');
 assert.equal(r.onboarding(b).capabilities.find(v => v.id === 'gmail.read').status, 'NEEDS_CONNECTION');
});
