'use strict';
const { freeze } = require('./scope-session');
// Deterministic interpretation: natural language -> objective, context,
// constraints, needed capabilities, plan and an explicit outcome. It is the
// safe fallback of the adaptive planner, not a list of sentences: each
// capability declares the vocabulary of its domain and the plan is composed
// from whatever capabilities a request mentions. What OXKIO cannot do yet is
// declared too, so it is reported as NEEDS_CAPABILITY instead of guessed.
const OUTCOMES = Object.freeze({
 CAN_EXECUTE: 'CAN_EXECUTE', NEEDS_INFORMATION: 'NEEDS_INFORMATION', NEEDS_CONNECTION: 'NEEDS_CONNECTION',
 NEEDS_CAPABILITY: 'NEEDS_CAPABILITY', NEEDS_APPROVAL: 'NEEDS_APPROVAL', BLOCKED: 'BLOCKED',
});
const normalize = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokensOf = text => normalize(text).match(/[a-z0-9]+/g) || [];
// Domain vocabulary matches a word or (for stems of 5+ letters) its inflections.
const stemMatch = (token, stem) => token === stem || (stem.length >= 5 && token.startsWith(stem));
const has = (tokens, stems) => tokens.some(token => stems.some(stem => stemMatch(token, stem)));
// Action words match exactly: "borrador" is not "borra", "secretaria" is not "secreto".
const exact = (tokens, words) => tokens.some(token => words.includes(token));
// A verb form after a determiner is a noun ("la compra", "la reserva"), and an
// informational question ("¿cuándo me paga…?") is not an order.
const NOUN_MARKERS = new Set(['la', 'las', 'el', 'los', 'una', 'un', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'de', 'del', 'al', 'esta', 'este', 'esa', 'ese', 'nuestra', 'nuestro']);
const QUESTION = /^(cuando|donde|quien|quienes|cuanto|cuanta|cuantos|cuantas|por que)\b/;
const action = (tokens, words, plain) => !QUESTION.test(plain.replace(/^[^a-z0-9]+/, '')) && tokens.some((token, i) => words.includes(token) && !(i > 0 && NOUN_MARKERS.has(tokens[i - 1])));
const SOURCES = Object.freeze({
 'calendar.read': ['agenda', 'cita', 'citas', 'reunion', 'reuniones', 'calendario', 'evento', 'eventos', 'compromiso'],
 'gmail.read': ['correo', 'correos', 'email', 'emails', 'mail', 'mails', 'bandeja', 'inbox', 'factura'],
 'memory.search': ['recuerdas', 'acuerdas', 'recupera', 'memoria', 'dije', 'dijiste', 'conte', 'apuntaste', 'guardaste', 'anotaste'],
 'documents.read': ['documento', 'archivo', 'fichero'],
});
const WEB_VERBS = ['investiga', 'investigar', 'averigua', 'busca', 'buscar', 'buscame'];
const WEB_STRONG = ['investiga', 'investigar', 'averigua', 'internet', 'web', 'online'];
const WEB_TOPICS = ['informacion', 'precio', 'precios', 'receta', 'recetas', 'horario', 'horarios', 'compara'];
const ANALYZE = ['clasifica', 'organiza', 'ordena', 'compara', 'resume', 'resumen', 'analiza', 'cuanto', 'cuantos', 'cuanta', 'total', 'suma'];
const STORAGE = ['carpeta', 'carpetas'];
// Declared but not implemented in V3: honest gaps, never silent fallbacks.
const DECLARED = Object.freeze({
 'reminders.schedule': { cues: ['recuerdame', 'recordarme', 'avisame', 'avisarme', 'recordatorio', 'recordatorios', 'alarma'], label: 'recordatorios y tareas programadas' },
 'drive.read': { cues: ['drive'], label: 'Google Drive' },
 'onedrive.read': { cues: ['onedrive'], label: 'OneDrive' },
 'outlook.read': { cues: ['outlook', 'hotmail'], label: 'Outlook' },
 'documents.extract': { cues: ['pdf', 'adjunto', 'adjuntos', 'escaneado', 'escaneo'], label: 'lectura de PDF y adjuntos' },
});
const WHEN = '(manana|pasado manana|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo)|la semana que viene|dentro de|cada (dia|semana|mes))';
// A check the user wants done later ("comprueba mañana si…") is a future task;
// "revisa mi agenda de mañana" is a read now.
const FUTURE = new RegExp('\\b(comprueba|revisa|mira|vigila|consulta|avisa)\\s+' + WHEN + '\\b');
const AGENDA_QUESTION = new RegExp('\\bque tengo (' + WHEN + '|hoy|esta semana|esta tarde|esta noche)\\b');
// Any external write (sending, scheduling, changing) needs a specific human authorization.
const SEND = ['envia', 'enviar', 'enviale', 'enviame', 'envialo', 'manda', 'mandar', 'mandale', 'mandalo', 'reenvia', 'reenviar', 'responde', 'responder', 'respondele', 'contesta', 'contestar', 'contestale', 'publica', 'publicar', 'send', 'reply', 'agendar', 'agendame', 'reserva', 'reservar', 'reservame', 'cancela', 'cancelar', 'mueve', 'mover', 'crea', 'crear', 'anade', 'anadir', 'modifica', 'modificar', 'actualiza', 'actualizar'];
// Credentials are never handled (not even remembered); irreversible, financial
// or production requests are blocked in V3.
const CREDENTIALS = ['contrasena', 'contrasenas', 'password', 'passwords', 'secreto', 'secretos', 'credencial', 'credenciales', 'iam'];
const BLOCK = ['deploy', 'despliega', 'desplegar', 'produccion', 'compra', 'comprame', 'comprar', 'paga', 'pagar', 'pagame', 'transfiere', 'transferir', 'transferencia', 'contrata', 'contratar', 'borra', 'borrar', 'borralo', 'elimina', 'eliminar', 'eliminalo'];
const STOP = new Set(['que', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'mi', 'mis', 'me', 'lo', 'le', 'les', 'por', 'para', 'con', 'sobre', 'al', 'a', 'es', 'se', 'su', 'sus', 'tu', 'tus', 'te', 'hay', 'tengo', 'tienes', 'todo', 'todos', 'algo', 'dime', 'puedes', 'favor', 'esto', 'esta', 'este', 'ese', 'esa', 'hoy', 'ahora', 'he', 'has', 'ha', 'revisa', 'consulta', 'mira', 'ver', 'sabes', 'lee', 'leer']);
const REMEMBER_CONSENT = /^(recuerda|guarda esta informacion|apunta|anota|memoriza)\b/;
const ORDER = ['memory.remember', 'calendar.read', 'gmail.read', 'memory.search', 'documents.read', 'web.search', 'research.web', 'data.analyze', 'storage.propose'];
const SOURCE_IDS = ['calendar.read', 'gmail.read', 'memory.search', 'documents.read', 'web.search', 'research.web'];
function rememberConsent(text) { return typeof text === 'string' && REMEMBER_CONSENT.test(normalize(text).trim()); }
function composePlan(ids) {
 const ordered = ORDER.filter(id => ids.includes(id));
 const keyOf = id => 'step-' + ordered.indexOf(id);
 return ordered.map(id => ({
  key: keyOf(id), capability: id,
  dependsOn: id === 'research.web' ? ordered.filter(v => v === 'web.search').map(keyOf)
   : id === 'data.analyze' ? ordered.filter(v => SOURCE_IDS.includes(v)).map(keyOf)
    : id === 'storage.propose' ? ordered.filter(v => v !== id).map(keyOf) : [],
 }));
}
function interpretIntention(text) {
 const tokens = tokensOf(text); const plain = normalize(text);
 const base = { objective: text.trim(), constraints: ['Solo lectura.', 'Sin envíos ni cambios externos.', 'Los datos privados permanecen con su propietario.'] };
 const result = (outcome, fields) => freeze({ ...base, outcome, capabilities: [], missingInformation: [], plan: null, searchTerms: [], ...fields });
 // Questions about OXKIO's own resources are read-only introspection, not a
 // request to run the mentioned tools. Resolve them from the scoped catalogue.
 const selfQuery = plain.trim().replace(/^oxkio[\s,:]+/, '').replace(/^[¿?\s]+/, '').replace(/^dime\s+/, '');
 if (/^(que (puedes hacer|capacidades tienes|tienes conectad[oa]|necesitas para)|(?:quiero que )?anali[cz](?:a|as|es|e) (?:tu |su )?(?:propio )?estado operativo)\b/.test(selfQuery)) {
  return result(OUTCOMES.CAN_EXECUTE, { reason: 'operational_state', introspection: true });
 }
 if (exact(tokens, CREDENTIALS)) return result(OUTCOMES.BLOCKED, { reason: 'credentials', gate: 'HUMAN_GATE' });
 const remember = rememberConsent(text);
 // A note to remember ("recuerda que tengo que comprar pan") is content, not an order.
 if (!remember && action(tokens, BLOCK, plain)) return result(OUTCOMES.BLOCKED, { reason: 'irreversible_or_financial', gate: 'HUMAN_GATE' });
 // "agenda" is a noun ("mi agenda", "agenda de hoy") unless it opens an order.
 const agendaVerb = tokens[0] === 'agenda' && ['una', 'un', 'me', 'la', 'el', 'cita', 'reunion', 'llamada'].includes(tokens[1]);
 if (!remember && (action(tokens, SEND, plain) || agendaVerb)) return result(OUTCOMES.NEEDS_APPROVAL, { reason: 'external_action', gate: 'HUMAN_GATE' });
 const declared = Object.entries(DECLARED).filter(([, d]) => has(tokens, d.cues)).map(([id]) => id);
 if (FUTURE.test(plain) && !declared.includes('reminders.schedule')) declared.push('reminders.schedule');
 if (declared.length && !remember) return result(OUTCOMES.NEEDS_CAPABILITY, { reason: 'not_implemented', capabilities: declared, labels: declared.map(id => DECLARED[id].label) });
 if (remember) {
  const content = text.trim().replace(/^\s*(recuerda|guarda esta informaci[oó]n|apunta|anota|memoriza)\s*(que\s+|:\s*)?/i, '').trim();
  if (content.length < 2) return result(OUTCOMES.NEEDS_INFORMATION, { reason: 'missing_content', missingInformation: ['¿Qué quieres que recuerde?'] });
  return result(OUTCOMES.CAN_EXECUTE, { capabilities: ['memory.remember'], plan: composePlan(['memory.remember']), rememberContent: content });
 }
 const cues = [...Object.values(SOURCES).flat(), ...WEB_VERBS, ...WEB_STRONG, ...ANALYZE.filter(w => w !== 'compara'), ...STORAGE];
 const ids = Object.entries(SOURCES).filter(([, stems]) => has(tokens, stems)).map(([id]) => id);
 if (AGENDA_QUESTION.test(plain) && !ids.includes('calendar.read')) ids.push('calendar.read');
 if (has(tokens, WEB_STRONG) || (ids.length === 0 && (has(tokens, WEB_VERBS) || has(tokens, WEB_TOPICS)))) ids.push('web.search', 'research.web');
 if (has(tokens, ANALYZE)) ids.push('data.analyze');
 if (has(tokens, STORAGE)) ids.push('storage.propose');
 const searchTerms = [...new Set(tokens.filter(t => !STOP.has(t) && !cues.some(stem => stemMatch(t, stem))))];
 if (!ids.some(id => SOURCE_IDS.includes(id))) {
  return result(OUTCOMES.NEEDS_INFORMATION, {
   reason: ids.length ? 'missing_source' : 'no_capability', searchTerms,
   missingInformation: [ids.length ? '¿Dónde está esa información: tu correo, tu agenda, tu memoria, tus documentos o fuentes públicas?' : '¿Qué quieres conseguir y con qué información (correo, agenda, memoria, documentos o fuentes públicas)?'],
  });
 }
 if (ids.includes('web.search') && searchTerms.length === 0) return result(OUTCOMES.NEEDS_INFORMATION, { reason: 'missing_topic', missingInformation: ['¿Qué tema quieres que investigue?'] });
 const unique = [...new Set(ids)];
 return result(OUTCOMES.CAN_EXECUTE, { capabilities: unique, plan: composePlan(unique), searchTerms });
}
module.exports = { OUTCOMES, DECLARED, interpretIntention, rememberConsent, normalize, tokensOf };
