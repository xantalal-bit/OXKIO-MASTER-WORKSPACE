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
const PERSONAL = /\b(mi|mis|me|m[ií]o|m[ií]a|yo|conmigo|nuestro|nuestra)\b|\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/;
function classifyEgress(text, { derivedFromPrivate = false, floor = PRIVACY_CLASSES.PUBLIC } = {}) {
 if (typeof text !== 'string' || containsSecretMarker(text)) return freeze({ privacyClass: PRIVACY_CLASSES.SECRET, reasons: ['secret_marker'] });
 let privacyClass = floor; const reasons = [];
 const raise = (reason) => { privacyClass = maxPrivacyClass(privacyClass, PRIVACY_CLASSES.CONFIDENTIAL); reasons.push(reason); };
 if (derivedFromPrivate) raise('private_source');
 for (const [name, pattern] of IDENTIFIERS) if (pattern.test(text)) raise('identifier_' + name);
 if (SPECIAL.test(text) && PERSONAL.test(text)) raise('special_category_personal');
 return freeze({ privacyClass, reasons });
}
// provider: the connection's declared egress { providerId, region }. Without a
// declaration only PUBLIC text may leave (no approved provider can match).
function authorizeEgress({ text, provider = {}, policy = DEFAULT_PRIVACY_POLICY, derivedFromPrivate = false, floor } = {}) {
 const classified = classifyEgress(text, { derivedFromPrivate, floor });
 const routing = evaluateProviderRouting({ privacyClass: classified.privacyClass, provider: { external: true, providerId: provider && provider.providerId, region: provider && provider.region }, policy });
 return freeze({ allowed: routing.allowed, privacyClass: classified.privacyClass, reasons: [...classified.reasons, routing.reason] });
}
module.exports = { classifyEgress, authorizeEgress };
