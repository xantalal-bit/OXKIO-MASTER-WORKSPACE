'use strict';
// P0 privacidad (01/11/2026): el contenido de Gmail y Calendar (datos de terceros:
// remitentes, asuntos, extractos, títulos y lugares de eventos) sirve para responder
// en la petición que lo necesita, pero no debe quedar guardado en el almacén sellado
// de tareas, conversaciones ni resultados intermedios. Solo datos sintéticos.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { Readable } = require('node:stream'); const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { normalizeGmailMessage } = require('../private-context/gmail-private-provider');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');

const UID = 'fixture-cliente-cero'; const OTHER = 'fixture-otra-persona';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: [UID, OTHER].join(',') });
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
// Marcadores sintéticos únicos: si aparecen en disco, se ha persistido contenido de terceros.
const THIRD = ['ZZREMITENTE', 'ZZASUNTOSALUD', 'ZZEXTRACTO', 'ZZEVENTO', 'ZZLUGAR'];
const THIRD_RE = new RegExp(THIRD.join('|'));
const localDay = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const at = h => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const raw = (id, labels, from, subject, snippet) => ({ id, threadId: 't-' + id, labelIds: labels, snippet, payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Date', value: new Date().toUTCString() }] } });
const INBOX = [raw('m1', ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'], 'ZZREMITENTE Persona <zzremitente@example.test>', 'ZZASUNTOSALUD resultados de su cita médica', 'ZZEXTRACTO adjunto el informe del análisis')].map(normalizeGmailMessage);
const EVENTS = [{ id: 'e1', title: 'ZZEVENTO reunión con el especialista', start: at(23), end: at(23), allDay: false, location: 'ZZLUGAR consulta 3' },
 { id: 'e2', title: 'ZZEVENTO cumpleaños', start: localDay(1), end: localDay(2), allDay: true, location: null }];
function decider(plan) { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); return { status: 'ok', content: { action: 'plan', plan }, usage: { inputTokens: 700, outputTokens: 250 } }; } }; }
const PLAN = [{ key: 'c', capability: 'calendar.read', dependsOn: [] }, { key: 'g', capability: 'gmail.read', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['c', 'g'] }];

function setup({ root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-minimize-')), key = randomBytes(32), readers, plan = PLAN } = {}) {
 const p = decider(plan); const logs = [];
 const rd = readers || { gmailReader: async () => ({ privatePayload: { messages: INBOX } }), calendarReader: async () => ({ privatePayload: { events: EVENTS } }) };
 const server = createServerComposition({ enabled: true, cohortUids: [UID, OTHER].join(','), integrityKey: key, memoryRoot: root, authorizeIdentity: authorize, privateContextReaders: () => rd, reasoning: { providers: [p], privacyPolicy: POLICY, requestPrivacyFloor: 'INTERNAL', approvedDailyBudgetUsd: 0.9 } });
 const ask = async (query, { conversationId = 'conversation-min-1', uid = UID, action } = {}) => {
  const req = Readable.from([JSON.stringify({ query, includeDetails: true, conversationId, ...(action ? { action } : {}) })]); req.oxkioIdentity = authorize({ uid }).identity;
  let status, body; await server.handle(req, { writeHead(s) { status = s; }, end(b) { body = b; } }); return { status, data: JSON.parse(body) };
 };
 return { p, ask, root, key, server, logs };
}
// Todo lo que queda en disco (almacén sellado local, mismo contrato que PostgreSQL).
function persisted(root) {
 const out = [];
 (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(fs.readFileSync(f, 'utf8')); } })(root);
 return out.join('\n');
}
async function quiet(fn) { const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info }; const lines = [];
 for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
 try { return { value: await fn(), lines }; } finally { Object.assign(console, orig); } }
const ORDER = 'Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.';

test('A/B/G/I: la respuesta usa agenda y correo, pero nada de su contenido queda en disco, ni en logs, ni sale al proveedor', async () => {
 const s = setup();
 try {
  const { value: r, lines } = await quiet(() => s.ask(ORDER));
  assert.equal(r.status, 200, r.data.code); assert.equal(r.data.details.status, 'COMPLETED');
  assert.match(r.data.response, /ZZEVENTO|ZZREMITENTE/, 'la respuesta de esta petición sí usa el contexto privado');
  assert.doesNotMatch(persisted(s.root), THIRD_RE, 'ningún asunto, extracto, remitente, evento o lugar de terceros persiste');
  assert.ok(!lines.some(l => THIRD_RE.test(l)), 'ni en los logs');
  assert.ok(!s.p.calls.some(c => THIRD_RE.test(JSON.stringify(c))), 'ni en llamadas al proveedor externo');
 } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

module.exports = { setup, persisted, quiet, THIRD_RE, ORDER, INBOX, EVENTS, UID, OTHER, PLAN };

// Lector de Gmail que caduca una vez (como un refresh token rechazado) y luego funciona.
function expiringReaders() {
 let gmailCalls = 0;
 return { gmailReader: async () => { gmailCalls++; if (gmailCalls === 1) throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' }); return { privatePayload: { messages: INBOX } }; },
  calendarReader: async () => ({ privatePayload: { events: EVENTS } }) };
}

test('C/E: una tarea que espera la conexión conserva sellado lo ya leído para reanudar sin releer; tras reiniciar y reconectar, «continúa» la completa y entonces se minimiza', async () => {
 const first = setup({ readers: expiringReaders() });
 try {
  const waiting = await first.ask(ORDER);
  assert.equal(waiting.data.details.status, 'NEEDS_CONNECTION');
  assert.match(persisted(first.root), /ZZEVENTO/, 'mientras puede reanudarse, la lectura queda sellada (garantía de reanudar sin releer)');
  // Reinicio: nueva composición sobre el mismo almacén sellado y la misma clave.
  const second = setup({ root: first.root, key: first.key });
  const resumed = await second.ask('continúa');
  assert.equal(resumed.status, 200, resumed.data.code);
  assert.equal(resumed.data.details.status, 'COMPLETED');
  assert.match(resumed.data.response, /ZZEVENTO/, 'la respuesta usa la agenda sellada, sin releerla');
  assert.doesNotMatch(persisted(first.root), THIRD_RE, 'al cerrarse la tarea, nada del correo ni de la agenda queda guardado');
 } finally { fs.rmSync(first.root, { recursive: true, force: true }); }
});

test('D/E/F: la memoria explícita se guarda y se recupera tras reiniciar; otra persona no la ve', async () => {
 const plan = [{ key: 'r', capability: 'memory.remember', dependsOn: [] }];
 const s = setup({ plan });
 try {
  const saved = await s.ask('Recuerda que el código de prueba es ZZMEMO-7.', { conversationId: 'conversation-mem-1' });
  assert.equal(saved.status, 200, saved.data.code);
  assert.match(persisted(s.root), /ZZMEMO-7/, 'lo que la persona pide recordar sí persiste');
  const after = setup({ root: s.root, key: s.key, plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }] });
  const mine = await after.ask('¿Recuerdas el código de prueba?', { conversationId: 'conversation-mem-2' });
  assert.match(mine.data.response, /ZZMEMO-7/);
  const other = await after.ask('¿Recuerdas el código de prueba?', { conversationId: 'conversation-mem-3', uid: OTHER });
  assert.doesNotMatch(JSON.stringify(other.data), /ZZMEMO-7/, 'separación estricta por usuario');
 } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('H: una propuesta de organización a partir del correo (sin adaptador de almacenamiento en producción) espera conexión sin guardar el correo ni tocar la cola de aprobación', async () => {
 const inbox = [raw('f1', ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], 'ZZREMITENTE Proveedor <zzprov@example.test>', 'Factura ZZASUNTOSALUD de octubre', 'ZZEXTRACTO importe pendiente')].map(normalizeGmailMessage);
 const s = setup({ readers: { gmailReader: async () => ({ privatePayload: { messages: inbox } }), calendarReader: async () => ({ privatePayload: { events: [] } }) },
  plan: [{ key: 'g', capability: 'gmail.read', dependsOn: [] }, { key: 'p', capability: 'storage.propose', dependsOn: ['g'] }] });
 try {
  const r = await s.ask('Organiza las facturas de mi correo en una carpeta.', { conversationId: 'conversation-apr-1' });
  assert.equal(r.status, 200, r.data.code);
  assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.equal(r.data.details.approvalId, null, 'nada llega a la cola sin la conexión');
  assert.equal(r.data.executionEnabled, false);
  assert.doesNotMatch(persisted(s.root), THIRD_RE, 'el correo ya leído no queda guardado mientras se espera');
 } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('I: las categorías especiales de un asunto o extracto (salud) no persisten; solo quedan señales cerradas', async () => {
 const s = setup();
 try {
  await s.ask(ORDER, { conversationId: 'conversation-salud-1' });
  const disk = persisted(s.root);
  assert.doesNotMatch(disk, /cita médica|especialista|informe del análisis/);
  assert.match(disk, /"minimized":true/, 'el elemento sigue existiendo, sin texto');
  assert.match(disk, /"provenance":"GMAIL"/); assert.match(disk, /"type":"calendar"/);
 } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
