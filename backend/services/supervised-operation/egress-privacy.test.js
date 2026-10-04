'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEgress, authorizeEgress, mentionsPerson } = require('./egress-privacy');

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
