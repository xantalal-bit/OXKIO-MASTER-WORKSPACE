'use strict';
// Understanding before capabilities (05/10/2026). Determinism keeps security,
// consent and explicit orders; a vocabulary reading of the goal is confirmed by
// the existing decider when cognition is available, with the same reading as
// its deterministic fallback. These tests check meaning and routing, never the
// wording of a model answer.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { randomBytes } = require('node:crypto');
const { interpretIntention } = require('./intention-interpreter');
const { createServerComposition } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');

// --- Deterministic layer: what never depends on a model -------------------
const HARD = [
 ['Compra un coche.', 'BLOCKED'], ['¿Puedes comprar un coche?', 'BLOCKED'], ['Me puedes pagar la factura?', 'BLOCKED'], ['Paga la factura de la luz', 'BLOCKED'],
 ['Borra el correo de ayer', 'BLOCKED'], ['Transfiere 200 euros a la cuenta de mi hermano', 'BLOCKED'], ['Despliega la nueva versión', 'BLOCKED'],
 ['Envía un correo a Juan con el presupuesto', 'NEEDS_APPROVAL'], ['Responde a Laura que sí', 'NEEDS_APPROVAL'], ['¿Puedes responder al cliente?', 'NEEDS_APPROVAL'],
 ['Reserva una mesa para dos el viernes', 'NEEDS_APPROVAL'], ['Agenda una reunión con el equipo', 'NEEDS_APPROVAL'], ['Cancela la cita del dentista', 'NEEDS_APPROVAL'],
 ['Recuérdame mañana llamar a Ana.', 'NEEDS_CAPABILITY'], ['Avísame el viernes de la entrega', 'NEEDS_CAPABILITY'], ['Comprueba mañana si ha llegado el pedido', 'NEEDS_CAPABILITY'],
 ['Mi contraseña del banco es la de siempre', 'BLOCKED'],
];
test('security, explicit orders and reminder orders stay deterministic: never routed to a model', () => {
 for (const [text, outcome] of HARD) { const r = interpretIntention(text); assert.equal(r.outcome, outcome, text); assert.notEqual(r.semantic, true, text); }
});
test('consent, the direct agenda question and explicit public research or memory stay fast paths', () => {
 let r = interpretIntention('Recuerda que prefiero respuestas cortas.'); assert.deepEqual(r.capabilities, ['memory.remember']); assert.notEqual(r.semantic, true);
 r = interpretIntention('Apunta que el proveedor nuevo entrega los martes'); assert.deepEqual(r.capabilities, ['memory.remember']); assert.notEqual(r.semantic, true);
 r = interpretIntention('¿Qué tengo mañana?'); assert.deepEqual(r.capabilities, ['calendar.read']); assert.notEqual(r.semantic, true);
 r = interpretIntention('Investiga en fuentes públicas el reglamento europeo de protección de datos'); assert.ok(r.capabilities.includes('web.search')); assert.notEqual(r.semantic, true);
 r = interpretIntention('¿Qué recuerdas del proyecto Alfa?'); assert.deepEqual(r.capabilities, ['memory.search']); assert.notEqual(r.semantic, true);
});
// Mentioning a topic is not a request for its tool or an order: these outcomes
// rest on vocabulary, so understanding decides (A-K, N and paraphrases).
const UNDERSTAND = [
 'Explícame qué es Verifactu.', 'Investiga qué es Verifactu y qué plazos tiene la factura electrónica', '¿Qué obligaciones trae la factura electrónica para autónomos?',
 'Redáctame un correo explicando Verifactu a un cliente.', 'Escríbeme un email para un cliente explicando el nuevo sistema de facturación', 'Ayúdame a responder a un cliente que pide un descuento',
 'Busca en mi correo el último mensaje sobre Verifactu.', '¿Hay algo en mis emails sobre la renovación del seguro?',
 'Dame cinco ideas para que la reunión del lunes sea más productiva.', '¿Cómo preparo una buena agenda para la reunión de equipo?', 'Ideas para un evento de empresa de fin de año',
 '¿Qué reuniones tengo el lunes?', 'Repasa mis citas de la semana',
 'Compara alquilar o comprar un coche.', '¿Me compensa alquilar o comprar piso?', 'Ventajas de comprar frente a alquilar una oficina', 'Quiero comprar un portátil, ¿cuál me recomiendas?', 'Necesito pagar la factura de la luz, ¿qué opciones tengo?',
 'Organízame las prioridades de esta semana.', 'Ordena mis tareas pendientes por urgencia', 'Organiza mis prioridades usando mi agenda y mi correo.',
 'Resume este texto: La semana laboral de cuatro días reduce el absentismo según varios estudios.', 'Resume el documento Plan2026 de mis archivos.', '¿Qué formato de documento es mejor para un contrato?',
 '¿Qué sabes de mis preferencias?', '¿Qué es OneDrive?', 'Crea una lista de tareas para mañana', 'Añade ideas a la propuesta para el cliente',
];
test('vocabulary readings are marked for understanding, and none of them is an order or a block', () => {
 for (const text of UNDERSTAND) { const r = interpretIntention(text); assert.equal(r.semantic, true, text); assert.notEqual(r.outcome, 'BLOCKED', text); }
 // The deterministic reading of each one is still there as the fallback.
 assert.ok(interpretIntention('Redáctame un correo explicando Verifactu a un cliente.').capabilities.includes('gmail.read'));
 assert.equal(interpretIntention('Crea una lista de tareas para mañana').outcome, 'NEEDS_APPROVAL');
 assert.equal(interpretIntention('¿Qué es OneDrive?').outcome, 'NEEDS_CAPABILITY');
});

// --- Runtime: understanding first, deterministic gates after ----------------
const UID = 'fixture-owner-a'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
// A decider double: it returns whatever decision the test supplies for a goal,
// standing in for the model's understanding; everything after it is real.
function decider(decide) { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); const out = decide(request.mission, request); return out && out.status ? out : { status: 'ok', content: out, usage: { inputTokens: 400, outputTokens: 120 } }; } }; }
async function setup(providers) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-semantic-'));
 const c = createServerComposition({ enabled: true, cohortUids: UID, memoryRoot: root, integrityKey: randomBytes(32), authorizeIdentity: authorize, reasoning: providers ? { providers, requestPrivacyFloor: 'INTERNAL', privacyPolicy: POLICY, approvedDailyBudgetUsd: 0.9 } : null });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid: UID }).identity; c.handle(req, res); });
 await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
 const ask = query => new Promise((resolve, reject) => { const body = JSON.stringify({ query, includeDetails: true }); const req = http.request({ host: '127.0.0.1', port, path: '/api/executive/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', s => d += s); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') })); }); req.on('error', reject); req.end(body); });
 return { ask, close: async () => { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); } };
}
const ADVICE = 'Te propongo una respuesta clara y breve; puedo ajustarla si me das más contexto.';
const answer = { action: 'answer', message: ADVICE, plan: [] };
const plan = (...caps) => ({ action: 'plan', plan: caps.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })) });

test('A/B/D/F/H/J: understanding answers without inventing a source read or a payment', async () => {
 const p = decider(() => answer); const s = await setup([p]);
 try {
  for (const q of ['Explícame qué es Verifactu.', 'Redáctame un correo explicando Verifactu a un cliente.', 'Dame cinco ideas para que la reunión del lunes sea más productiva.', 'Compara alquilar o comprar un coche.', 'Organízame las prioridades de esta semana.', 'Resume este texto: La semana laboral de cuatro días reduce el absentismo según varios estudios.']) {
   const r = await s.ask(q); const d = r.data.details;
   assert.equal(d.mode, 'COGNITIVE_ADVICE', q); assert.equal(r.data.missionId, null, q); assert.equal(d.connectionRequests, undefined, q); assert.notEqual(r.data.outcome, 'BLOCKED', q); assert.equal(r.data.executionEnabled, false);
  }
  assert.equal(p.calls.length, 6);
  // The decider got the goal and the effective view, with the understanding rules.
  assert.ok(p.calls.every(c => c.context.capabilities.some(v => v.id === 'gmail.read' && v.status === 'NEEDS_CONNECTION')));
  assert.ok(p.calls[0].constraints.some(c => /is not a request to read that data or to perform that action/.test(c)));
 } finally { await s.close(); }
});
test('C/E/I: when the goal needs the person\'s data, the source is planned and its missing connection is asked for, never presented as active', async () => {
 const p = decider(m => /correo|emails/i.test(m) && /agenda/i.test(m) ? plan('calendar.read', 'gmail.read') : /correo|emails/i.test(m) ? plan('gmail.read') : plan('calendar.read'));
 const s = await setup([p]);
 try {
  for (const [q, caps] of [['Busca en mi correo el último mensaje sobre Verifactu.', ['gmail.read']], ['¿Qué reuniones tengo el lunes?', ['calendar.read']], ['Organiza mis prioridades usando mi agenda y mi correo.', ['calendar.read', 'gmail.read']]]) {
   const r = await s.ask(q); const d = r.data.details;
   assert.equal(d.status, 'NEEDS_CONNECTION', q); assert.deepEqual(d.connectionRequests.map(g => g.capability).sort(), caps.sort(), q); assert.equal(d.result, null, q); assert.equal(r.data.executionEnabled, false);
   assert.ok(d.trace.some(t => t.event === 'CONVERSATIONAL_DECISION'), q);
  }
 } finally { await s.close(); }
});
test('K/L/N/M/G: unavailable sources, missing capabilities, memory and orders keep their deterministic truth', async () => {
 const p = decider(m => /archivos/.test(m) ? plan('documents.read') : /preferencias/.test(m) ? plan('memory.search') : answer);
 const s = await setup([p]);
 try {
  // K: the model may not plan an UNAVAILABLE capability; the deterministic reading
  // then says the source is not available for this account.
  let r = await s.ask('Resume el documento Plan2026 de mis archivos.');
  assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.match(r.data.response, /todavía no está disponible para tu cuenta/); assert.ok(r.data.details.trace.some(t => t.event === 'SEMANTIC_FALLBACK' && t.code === 'reasoning_resource_unavailable'));
  // N: memory search is planned and runs locally.
  await s.ask('Recuerda mis preferencias: reuniones por la mañana');
  r = await s.ask('¿Qué sabes de mis preferencias?'); assert.equal(r.data.details.status, 'COMPLETED'); assert.equal(r.data.details.result.capability, 'memory.search');
  const before = p.calls.length;
  // L, M, G: no model involved.
  r = await s.ask('Recuérdame mañana llamar a Ana.'); assert.equal(r.data.outcome, 'NEEDS_CAPABILITY'); assert.match(r.data.response, /recordatorios/);
  r = await s.ask('Recuerda que prefiero respuestas cortas.'); assert.equal(r.data.details.result.capability, 'memory.remember');
  r = await s.ask('Compra un coche.'); assert.equal(r.data.outcome, 'BLOCKED');
  assert.equal(p.calls.length, before);
 } finally { await s.close(); }
});
test('a model can never use visibility or understanding as authority', async () => {
 // A plan to remember what the person did not ask to remember, or to write, is refused.
 const p = decider(m => /preferencias/.test(m) ? plan('memory.remember') : /evento/.test(m) ? plan('storage.propose') : answer);
 const s = await setup([p]);
 try {
  let r = await s.ask('Ten en cuenta mis preferencias para las próximas respuestas');
  assert.equal(r.data.missionId, null); assert.ok(!(r.data.details.result && r.data.details.result.capability === 'memory.remember'));
  r = await s.ask('Crea un evento el lunes a las diez');
  assert.equal(r.data.outcome, 'NEEDS_APPROVAL'); assert.equal(r.data.details.diagnosis.action, 'DETERMINISTIC_FALLBACK'); assert.equal(r.data.executionEnabled, false);
 } finally { await s.close(); }
});
test('without cognition, or when it fails or is refused, the deterministic reading stands with no more authority', async () => {
 // No reasoning configured: identical to the vocabulary reading.
 let s = await setup(null);
 try { const r = await s.ask('Redáctame un correo explicando Verifactu a un cliente.'); assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.deepEqual(r.data.details.connectionRequests.map(g => g.capability), ['gmail.read']); } finally { await s.close(); }
 // Provider failure: fallback to the same reading, traced.
 const failing = decider(() => ({ status: 'error', errorCode: 'reasoning_request_rejected' })); s = await setup([failing]);
 try {
  const r = await s.ask('Redáctame un correo explicando Verifactu a un cliente.'); assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.ok(r.data.details.trace.some(t => t.event === 'SEMANTIC_FALLBACK'));
  const g = await s.ask('Crea un evento el lunes a las diez'); assert.equal(g.data.outcome, 'NEEDS_APPROVAL');
  const n = await s.ask('¿Qué es OneDrive?'); assert.equal(n.data.outcome, 'NEEDS_CAPABILITY');
 } finally { await s.close(); }
 // Privacy: the request never leaves; the local reading still serves the person.
 const p = decider(() => answer); s = await setup([p]);
 try {
  const r = await s.ask('Busca en mi correo el último mensaje de ana.lopez@example.org'); assert.equal(p.calls.length, 0); assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.equal(r.data.executionEnabled, false);
  // A personal amount that used to be blocked by the word "pagar" must not leave
  // now that the infinitive is a topic: the Privacy Gate keeps it local.
  for (const q of ['Necesito pagar 300 € de una multa, ¿qué opciones tengo?', 'Quiero transferir 1.200 € a un proveedor, ¿cómo lo hago?', 'Tengo 5.000 € ahorrados, ¿me compensa comprar o alquilar?']) { const m = await s.ask(q); assert.notEqual(m.data.details.mode, 'COGNITIVE_ADVICE', q); }
  assert.equal(p.calls.length, 0);
 } finally { await s.close(); }
});
