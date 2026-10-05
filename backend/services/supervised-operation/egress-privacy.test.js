'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEgress, authorizeEgress, mentionsPerson, identifiesPerson } = require('./egress-privacy');
const { createGovernedReasoner } = require('./governed-reasoning');

// Institutional and legal names were read as full names, which raised public
// research to CONFIDENTIAL (blocked under authorization B).
const NOT_PERSON = [
 'Investiga el Reglamento General de Protección de Datos', 'Qué aprobó el Parlamento Europeo', 'Normativa de la Unión Europea',
 'Resume la Ley de Inteligencia Artificial', 'La Comisión Europea propuso la norma', 'Sentencia del Tribunal Supremo',
 'Tipos del Banco Central Europeo', 'Informe de Naciones Unidas', 'Aranceles de Estados Unidos', 'Lee el Real Decreto',
 'Cotizaciones a la Seguridad Social', 'Plazos de la Agencia Tributaria', 'Compare the European Union and the United Kingdom',
 'Summarize the Artificial Intelligence Act', 'What is the General Data Protection Regulation', 'Ley Orgánica de protección de datos',
 'El Tribunal Constitucional y el Consejo General', 'European Parliament and Council of the European Union',
];
// People must stay people: one ordinary word keeps a name, and a leading
// article is skipped only at the start of a pair.
const PERSON = [
 'Qué sabes de María López', 'Busca a Juan Pérez', 'Llama a José Luis Rodríguez', 'Habla con Ana Real', 'Opinión de Pedro Sánchez',
 'Escribe a Carlos Banco', 'Cita con María La Fuente', 'La reunión con Pedro Sánchez', 'El Juan Pérez de contabilidad',
 'El Parlamento Europeo y Juan Pérez', 'Ayuda con mi empresa', 'Revisa mi correo', 'Lo que dijo Laura Martín ayer',
];
test('institutional and legal names are not read as people', () => {
 for (const text of NOT_PERSON) assert.equal(mentionsPerson(text), false, text);
});
test('references to people and first-person requests are still detected', () => {
 for (const text of PERSON) assert.equal(mentionsPerson(text), true, text);
});
test('special categories tied to the person or a named person stay CONFIDENTIAL', () => {
 for (const text of ['Investiga el tratamiento de mi depresión', 'Investiga el tratamiento de Juan Pérez', 'La hipoteca de Ana Real'])
  assert.equal(classifyEgress(text, { floor: 'INTERNAL' }).privacyClass, 'CONFIDENTIAL', text);
});
test('public page text is not subject to the special-category rule, but secrets and identifiers still count', () => {
 const page = 'El tratamiento de datos personales lo regulan el Parlamento Europeo y el Consejo. Juan Pérez fue ponente del informe.';
 assert.equal(classifyEgress('Investiga la normativa europea', { floor: 'INTERNAL', publicText: page }).privacyClass, 'INTERNAL');
 assert.equal(classifyEgress('Investiga la normativa europea', { floor: 'INTERNAL', publicText: page + ' Contacto: oficina@example.org' }).privacyClass, 'CONFIDENTIAL');
 assert.equal(classifyEgress('Investiga la normativa europea', { floor: 'INTERNAL', publicText: 'password=fixture' }).privacyClass, 'SECRET');
 // The person's own words keep every rule even when public text is present.
 assert.equal(classifyEgress('Investiga el tratamiento de mi depresión', { floor: 'INTERNAL', publicText: page }).privacyClass, 'CONFIDENTIAL');
 const policy = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
 assert.equal(authorizeEgress({ text: 'Investiga la normativa europea', publicText: page, provider: { providerId: 'fixture' }, policy, floor: 'INTERNAL' }).allowed, true);
 assert.equal(authorizeEgress({ text: 'Investiga la normativa europea', publicText: page, provider: { providerId: 'fixture' }, policy, floor: 'INTERNAL', derivedFromPrivate: true }).allowed, false);
});
// Canon 05/10/2026: the first person alone is not confidential. What raises a
// request is its content: special or financial data tied to the speaker,
// identifiers, secrets, an identified third party or private sources.
const OWN_WORDS = ['Organiza mi semana', 'Ayúdame con mi trabajo', 'Ayuda con mi empresa', 'Quiero mejorar mi productividad', 'Prepara nuestra reunión de equipo', 'Mis clientes piden descuentos, ¿qué hago?', 'Resume mi reunión'];
const OTHERS = ['Prepara la conversación con mi jefe', 'Qué regalo le hago a mi hija', 'Habla con nuestro abogado', 'Busca a Juan Pérez', 'Lo que dijo Laura Martín ayer'];
test('the first person alone does not identify anyone else; a name or a relation does', () => {
 for (const text of OWN_WORDS) assert.equal(identifiesPerson(text), false, text);
 for (const text of OTHERS) assert.equal(identifiesPerson(text), true, text);
});
test('first-person requests are classified by content: INTERNAL unless they carry private data', () => {
 const of = text => classifyEgress(text, { floor: 'INTERNAL' }).privacyClass;
 for (const text of OWN_WORDS) assert.equal(of(text), 'INTERNAL', text);
 for (const text of ['Compara portátiles de 900 € y 1.200 €', 'Qué es una hipoteca a tipo fijo', 'Precio medio del alquiler en Madrid']) assert.equal(of(text), 'INTERNAL', text);
 for (const text of ['Analiza mi hipoteca de 180.000 €', 'Mi préstamo de 20.000 € a 10 años', 'Gano 3.000 € al mes, ¿cuánto debería ahorrar?', 'Revisa mi nómina', 'Mi sueldo no llega a fin de mes',
  'Mi DNI es 12345678Z', 'Llámame al 612 345 678', 'Mi correo es ana@example.org', 'Mi IBAN es ES91 2100 0418 4502 0005 1332', 'Investiga el tratamiento de mi depresión'])
  assert.equal(of(text), 'CONFIDENTIAL', text);
 assert.equal(of('Organiza mi semana, mi clave es password=fixture'), 'SECRET');
 assert.equal(classifyEgress('Organiza mi semana', { floor: 'INTERNAL', derivedFromPrivate: true }).privacyClass, 'CONFIDENTIAL');
});
test('governed reasoning: own words reach the INTERNAL provider; a third party, private context or a secret never leave', async () => {
 const calls = []; const provider = { status: 'ready', provider: 'fixture', region: 'eu', modelId: 'fixture:model', reason: async request => { calls.push(request); return { status: 'ok', content: {}, usage: {} }; } };
 const reasoner = createGovernedReasoner({ providers: [provider], privacyPolicy: { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] }, approvedDailyBudgetUsd: 1, requestFloor: 'INTERNAL' });
 const spend = { estimate: () => 0.001, reserve: () => ({}), settle: () => 0.001 };
 const ask = (objective, extra = {}) => reasoner.reason({ objective, egressText: objective, request: {}, basis: {}, spend, missionId: 'fixture', ...extra });
 const ok = await ask('Organiza mi semana'); assert.equal(ok.privacyClass, 'INTERNAL'); assert.equal(calls.length, 1);
 for (const [objective, extra] of [['Prepara la conversación con mi jefe'], ['Analiza mi hipoteca de 180.000 €'], ['Organiza mi semana', { derivedFromPrivate: true }], ['Organiza mi semana', { egressText: 'Organiza mi semana\nReunión con el cliente: ana@example.org' }]]) {
  await assert.rejects(ask(objective, extra), e => e.code === 'reasoning_resource_unavailable' && e.attempts.every(a => a.failure === 'PRIVACY_BLOCKED'), objective);
 }
 await assert.rejects(ask('Organiza mi semana', { egressText: 'Organiza mi semana password=fixture' }), e => e.code === 'secret_context');
 assert.equal(calls.length, 1);
});
