'use strict';
const { containsSecretMarker, evaluateProviderRouting, maxPrivacyClass, PRIVACY_CLASSES, DEFAULT_PRIVACY_POLICY } = require('../executive-brain/privacy-gate');
const { freeze } = require('./scope-session');
// Every text that leaves OXKIO (a search query, a planning prompt) is
// classified here and routed through the existing Privacy Gate before any
// external call. The classifier can only raise a class: SECRET never leaves,
// CONFIDENTIAL needs a provider approved for it, PUBLIC follows the policy.
const IDENTIFIERS = Object.freeze([
 ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
 ['iban', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/i],
 ['national_id', /\b(?:\d{8}|[XYZ]\d{7})[-\s]?[A-HJ-NP-TV-Z]\b/i],
 ['phone_or_card', /(?:\+?\d[\s.-]?){9,19}/],
 ['tokenized_url', /https?:\/\/\S+[?#]\S+/i],
]);
// Special categories (health, beliefs, finances…) only become personal data
// when tied to someone: a first-person reference or a full name.
const SPECIAL = /\b(diagn[oó]stic|enfermedad|vih|sida|c[aá]ncer|embaraz|aborto|psiqui|depresi[oó]n|terapia|medicaci[oó]n|tratamiento|religi[oó]n|orientaci[oó]n sexual|afiliaci[oó]n|antecedentes|deuda|n[oó]mina|salario|hipoteca|denuncia|juicio)/i;
const FIRST_PERSON = /\b(mi|mis|me|m[ií]o|m[ií]a|yo|conmigo|nuestro|nuestra)\b/i;
// Two adjacent capitalised words are read as a full name, unless BOTH are
// institutional or legal vocabulary ("Reglamento General", "Parlamento
// Europeo", "European Union"). One ordinary word is enough to keep a name:
// "Ana Real" or "Carlos Banco" are still people. Unknown institutions stay
// treated as people (fail closed).
const INSTITUTIONAL = new Set(('reglamento general ley leyes organica parlamento europeo europea europeos europeas union comision consejo tribunal supremo '
 + 'constitucional justicia banco central ministerio agencia tributaria estado estados unidos unidas naciones seguridad social codigo civil penal real '
 + 'decreto directiva carta derechos fundamentales comunidad gobierno inteligencia artificial proteccion datos autonoma nacional internacional '
 + 'organizacion mundial salud espacio economico area junta ayuntamiento diputacion boletin oficial administracion publica servicio instituto '
 + 'universidad fondo monetario oficina registro defensor pueblo corte camara senado congreso diputados autoridad comite europa espana '
 + 'european parliament commission council court supreme data protection regulation intelligence act board directive united states nations '
 + 'kingdom federal reserve bank national international organization world health economic charter fundamental rights security agency '
 + 'authority department office ministry government digital services markets').split(' '));
// A capitalised article or preposition only starts a sentence ("La Comisión
// Europea…"); it never begins a full name, so such a pair is skipped. It still
// counts after a name: "María La Fuente" is a person.
const LEADING_FUNCTION = new Set('el la los las lo un una unos unas del al de en y o por para con segun sobre the a an of in and or for'.split(' '));
const plainWord = w => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function namesPerson(text) {
 const words = [...text.matchAll(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/gu)];
 for (let i = 0; i + 1 < words.length; i++) {
  const [a, b] = [words[i], words[i + 1]];
  if (!/^\s+$/u.test(text.slice(a.index + a[0].length, b.index))) continue;
  if (LEADING_FUNCTION.has(plainWord(a[0]))) continue;
  if (!(INSTITUTIONAL.has(plainWord(a[0])) && INSTITUTIONAL.has(plainWord(b[0])))) return true;
 }
 return false;
}
// A request that refers to a person (first person or a full name) is treated
// as personal data on its own, even without a special category.
const mentionsPerson = text => typeof text === 'string' && (FIRST_PERSON.test(text) || namesPerson(text));
// text: what the person wrote or what derives from private sources.
// publicText: text read from PUBLIC sources (fetched pages). It is checked for
// secrets and identifiers, but not for the special-category rule: a public
// page discussing "tratamiento de datos" next to "Parlamento Europeo" is not
// the person's data.
function classifyEgress(text, { derivedFromPrivate = false, floor = PRIVACY_CLASSES.PUBLIC, publicText = '' } = {}) {
 if (typeof text !== 'string' || typeof publicText !== 'string' || containsSecretMarker(text) || containsSecretMarker(publicText)) return freeze({ privacyClass: PRIVACY_CLASSES.SECRET, reasons: ['secret_marker'] });
 let privacyClass = floor; const reasons = [];
 const raise = (reason) => { privacyClass = maxPrivacyClass(privacyClass, PRIVACY_CLASSES.CONFIDENTIAL); reasons.push(reason); };
 if (derivedFromPrivate) raise('private_source');
 for (const [name, pattern] of IDENTIFIERS) if (pattern.test(text) || pattern.test(publicText)) raise('identifier_' + name);
 if (SPECIAL.test(text) && mentionsPerson(text)) raise('special_category_personal');
 return freeze({ privacyClass, reasons });
}
// provider: the connection's declared egress { providerId, region }. Without a
// declaration only PUBLIC text may leave (no approved provider can match).
function authorizeEgress({ text, publicText = '', provider = {}, policy = DEFAULT_PRIVACY_POLICY, derivedFromPrivate = false, floor } = {}) {
 const classified = classifyEgress(text, { derivedFromPrivate, floor, publicText });
 const routing = evaluateProviderRouting({ privacyClass: classified.privacyClass, provider: { external: true, providerId: provider && provider.providerId, region: provider && provider.region }, policy });
 return freeze({ allowed: routing.allowed, privacyClass: classified.privacyClass, reasons: [...classified.reasons, routing.reason] });
}
module.exports = { classifyEgress, authorizeEgress, mentionsPerson };
