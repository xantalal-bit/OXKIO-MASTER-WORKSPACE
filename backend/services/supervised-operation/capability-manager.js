'use strict';
const { describeCapability } = require('../executive-brain/capability-registry');
const { copy, freeze, fail } = require('./scope-session');
const { interpretIntention, rememberConsent, OUTCOMES, DECLARED } = require('./intention-interpreter');
// Composable primitives, rather than one blueprint for each sentence. Resource
// adapters are installed by trusted composition; planners only choose these ids.
const DEFINITIONS = freeze({
 'calendar.read': { role: 'calendar', provider: 'calendar', scope: 'calendar.read', provenance: 'CALENDAR', label: 'tu agenda' },
 'gmail.read': { role: 'email', provider: 'mail', scope: 'mail.read', provenance: 'GMAIL', label: 'tu correo' },
 'memory.search': { role: 'memory', provider: null, provenance: 'INTERNAL_MEMORY', label: 'tu memoria' },
 'memory.remember': { role: 'memory-write', provider: null, provenance: 'INTERNAL_MEMORY', label: 'recordar información' },
 'documents.read': { role: 'documents', provider: 'storage', scope: 'documents.read', provenance: 'INTERNAL_DOCUMENT', label: 'tus documentos' },
 'web.search': { role: 'web-search', provider: 'search', scope: 'public.search', provenance: 'PUBLIC_DISCOVERY', label: 'buscar fuentes públicas' },
 'research.web': { role: 'web-research', provider: 'fetch', scope: 'public.fetch', provenance: 'PUBLIC_WEB', label: 'leer fuentes públicas' },
 'data.analyze': { role: 'data-analysis', provider: null, provenance: 'DERIVED', label: 'analizar información' },
 'storage.propose': { role: 'storage-proposal', provider: 'storage', scope: 'documents.read', provenance: 'INTERNAL_PROPOSAL', label: 'proponer organización de archivos' },
});
const PROVIDERS = ['calendar', 'mail', 'storage', 'search', 'fetch'];
const MESSAGES = freeze({
 NEEDS_APPROVAL: 'Esta acción cambiaría algo fuera de OXKIO o enviaría información, y requiere tu autorización específica. En esta fase no envío ni modifico nada; no he ejecutado nada.',
 BLOCKED: 'No puedo hacer esto: implica una acción irreversible, un pago o credenciales. No he ejecutado nada.',
});
function createCapabilityManager({ connections, planner = null }) {
 // Engine-facing profile, consulted only after the runtime cleared every
 // connection gap of the plan (see gaps); user-facing truth is catalogue().
 // Declared-but-missing capabilities are never AVAILABLE.
 function profile(id) {
  if (!DEFINITIONS[id]) return describeCapability(id);
  const base = describeCapability(id);
  return freeze({ ...(base || {}), id, mode: 'analyze', status: 'AVAILABLE', risk: 'low', costClass: 'deterministic', requiresApproval: false, requiresExternalConnection: false, tools: [id], reason: null });
 }
 function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0 || plan.length > 12) fail('plan_invalid');
  const used = new Set();
  for (const step of plan) {
   if (!step || Object.keys(step).some(k => !['key','capability','dependsOn'].includes(k)) || !/^[a-z][a-z0-9-]{0,30}$/.test(step.key)
    || used.has(step.key) || !DEFINITIONS[step.capability] || !Array.isArray(step.dependsOn) || step.dependsOn.some(k => !used.has(k))) fail('plan_invalid');
   used.add(step.key);
  }
  return freeze(copy(plan));
 }
 function message(interpretation) {
  if (interpretation.outcome === OUTCOMES.NEEDS_CAPABILITY) return 'Todavía no puedo hacerlo: OXKIO no tiene ' + interpretation.labels.join(', ') + '. Lo dejo registrado como capacidad pendiente; no he ejecutado nada.';
  if (interpretation.outcome === OUTCOMES.NEEDS_INFORMATION) return interpretation.missingInformation.join(' ');
  return MESSAGES[interpretation.outcome] || null;
 }
 // Deterministic interpretation first (free, explainable). Only when it finds
 // no capability does the adaptive planner reason, under its own privacy and
 // budget gates; any planner failure or invalid output falls back safely.
 async function interpret(text, context = {}) {
  if (typeof text !== 'string' || text.trim().length < 2 || text.length > 2000) fail('intention_invalid');
  let interpretation = interpretIntention(text);
  if (interpretation.outcome === OUTCOMES.NEEDS_INFORMATION && interpretation.reason === 'no_capability' && planner) {
   try {
    const plan = validatePlan(await planner(freeze({ intention: text, capabilities: Object.keys(DEFINITIONS) }), context));
    // A planner can never authorize a memory write the human did not ask for.
    if (plan.some(step => step.capability === 'memory.remember') && !rememberConsent(text)) fail('memory_consent_required');
    interpretation = freeze({ ...interpretation, outcome: OUTCOMES.CAN_EXECUTE, reason: 'planner', plan, capabilities: [...new Set(plan.map(step => step.capability))] });
   } catch (error) {
    interpretation = freeze({ ...interpretation, plannerRejected: /^[a-z_]+$/.test(error.code || '') ? error.code : 'planner_failed' });
   }
  }
  return freeze({ ...interpretation, message: message(interpretation) });
 }
 function gaps(handle, plan) {
  return plan.flatMap(step => {
   const d = DEFINITIONS[step.capability]; if (!d.provider) return [];
   const status = connections.inspect(handle, d.provider, d.scope); if (status.ready) return [];
   const connectable = connections.connectable(handle, d.provider);
   return [{ ...status, connectable, capability: step.capability, provider: d.provider, permission: d.scope,
    reason: status.status === 'EXPIRED' ? 'La autorización para consultar ' + d.label + ' ha caducado o se ha revocado.' : 'Necesito acceso para consultar ' + d.label + '.',
    canDo: 'Consultar y preparar resultados para ti.', cannotDo: 'Enviar, publicar o ejecutar cambios externos.',
    how: connectable ? 'Conecta el servicio mediante su autorización segura; nunca compartas una contraseña.' : 'Esta conexión todavía no está disponible para tu cuenta en OXKIO: requiere que el administrador la habilite. No he ejecutado nada.' }];
  });
 }
 // Honest per-owner catalogue: what can run now, what needs a connection,
 // what is declared but not implemented, and what is reserved to humans.
 function catalogue(handle) {
  const implemented = Object.entries(DEFINITIONS).map(([id, d]) => {
   if (!d.provider) return { id, status: 'AVAILABLE' };
   const status = connections.inspect(handle, d.provider, d.scope);
   return { id, status: status.ready && status.verified !== false ? 'AVAILABLE' : connections.connectable(handle, d.provider) ? 'NEEDS_CONNECTION' : 'NOT_AVAILABLE_FOR_ACCOUNT', connection: status.verified === false && status.ready ? 'NOT_VERIFIED' : status.status };
  });
  return freeze([...implemented, ...Object.keys(DECLARED).map(id => ({ id, status: 'NOT_IMPLEMENTED' })), { id: 'external.write', status: 'HUMAN_GATE' }]);
 }
 function describe(handle) {
  const rows = catalogue(handle);
  const labels = { AVAILABLE: 'Disponible', NEEDS_CONNECTION: 'Necesita conexión o validación', NOT_AVAILABLE_FOR_ACCOUNT: 'No disponible para tu cuenta', NOT_IMPLEMENTED: 'No implementado', HUMAN_GATE: 'Requiere aprobación humana' };
  const name = row => DEFINITIONS[row.id]?.label || DECLARED[row.id]?.label || (row.id === 'external.write' ? 'envíos y cambios externos' : row.id);
  const lines = Object.entries(labels).flatMap(([status, label]) => { const matches = rows.filter(row => row.status === status); return matches.length ? [label + ': ' + matches.map(row => name(row) + (row.connection === 'NOT_VERIFIED' ? ' (adaptador instalado; lectura aún no validada)' : '')).join(', ') + '.'] : []; });
  return freeze({ capabilities: rows, message: lines.join('\n') + '\n' + MESSAGES.BLOCKED + ' La ejecución material permanece deshabilitada.' });
 }
 return Object.freeze({ interpret, validatePlan, profile, gaps, catalogue, describe, definitions: DEFINITIONS });
}
// Error codes adapters use to report that their authorization is no longer valid.
const AUTH_CODES = new Set(['auth_expired', 'token_expired', 'invalid_grant', 'unauthorized', 'oauth_token_invalid', 'oauth_token_missing', 'oauth_refresh_unavailable', 'oauth_access_unavailable', 'google_oauth_tokens_missing', 'google_oauth_not_configured', 'google_oauth_token_store_unavailable']);
const PERMISSION_CODES = new Set(['insufficient_scope', 'permission_denied', 'forbidden', 'gmail_private_identity_required']);
const connectionError = code => Object.assign(new Error(code), { code, failureKind: 'connection' });
// Only trusted OAuth callbacks/composition may install a scoped connection.
// An adapter must carry the server-resolved owner and explicit allowed scopes.
// connectable(scope, provider) says whether this deployment offers a way to
// connect that provider for that owner (never decided by a prompt).
function createConnectionManager(sessions, { connectable = () => true } = {}) {
 const entries = new Map();
 const key = (h,p) => JSON.stringify([sessions.key(h),p]);
 function install(handle, provider, adapter) {
  const scope = sessions.scope(handle);
  if (!PROVIDERS.includes(provider) || !adapter || typeof adapter.read !== 'function'
   || adapter.tenantId !== scope.tenantId || adapter.userId !== scope.userId || adapter.clientId !== scope.clientId
   || !Array.isArray(adapter.scopes) || !['fixture','live'].includes(adapter.origin)) fail('connection_scope_invalid');
  const egress = adapter.egress && typeof adapter.egress.providerId === 'string' ? freeze({ providerId: adapter.egress.providerId, region: typeof adapter.egress.region === 'string' ? adapter.egress.region : null }) : freeze({ providerId: null, region: null });
  entries.set(key(handle,provider),Object.freeze({ read: adapter.read, scopes: Object.freeze([...adapter.scopes]), origin: adapter.origin, egress, state: 'CONNECTED', verified: adapter.authorizationVerified !== false }));
 }
 function inspect(handle,provider,permission) {
  const e=entries.get(key(handle,provider));
  const status = !e ? 'NOT_CONNECTED' : e.state === 'EXPIRED' ? 'EXPIRED' : !e.scopes.includes(permission) ? 'PERMISSION_REQUIRED' : 'CONNECTED';
  return { ready: status === 'CONNECTED', status, ...(e ? { verified: e.verified } : {}) };
 }
 // A connection is replaced (never mutated): readers holding the previous
 // entry detect the change and discard their late result.
 function degrade(handle, provider, entry, change) { if (entries.get(key(handle,provider)) === entry) entries.set(key(handle,provider), Object.freeze({ ...entry, ...change })); }
 function capture(handle,provider,permission) {
  if (!inspect(handle,provider,permission).ready) fail('connection_required');
  const e=entries.get(key(handle,provider));
  return Object.freeze({ origin: e.origin, egress: e.egress, read: async input => {
   await sessions.current(handle); if(entries.get(key(handle,provider)) !== e) throw connectionError('connection_revoked');
   const {signal,...data}=input; let result;
   try { result=await e.read(Object.freeze({...freeze(copy(data)),signal})); }
   catch (error) {
    const code = error && (typeof error.code === 'string' ? error.code : error.response?.data?.error);
    if (error && (error.failureKind === 'auth' || error.failureKind === 'connection' || AUTH_CODES.has(code))) { degrade(handle, provider, e, { state: 'EXPIRED' }); throw connectionError('connection_expired'); }
    if (error && (error.failureKind === 'permission' || PERMISSION_CODES.has(code))) { degrade(handle, provider, e, { scopes: Object.freeze(e.scopes.filter(s => s !== permission)) }); throw connectionError('permission_required'); }
    throw error;
   }
   await sessions.current(handle); if(entries.get(key(handle,provider)) !== e) throw connectionError('connection_revoked');
   if (!e.verified) degrade(handle, provider, e, { verified: true });
   return copy(result);
  } });
 }
 function disconnect(handle,provider) { entries.delete(key(handle,provider)); }
 // Installed and usable (not expired): trusted composition does not reinstall it.
 function active(handle, provider) { const e = entries.get(key(handle,provider)); return Boolean(e && e.state === 'CONNECTED'); }
 return Object.freeze({ install, inspect, capture, disconnect, active, installed: (handle, provider) => entries.has(key(handle,provider)), connectable: (handle, provider) => Boolean(connectable(freeze(copy(sessions.scope(handle))), provider)) });
}
module.exports = { DEFINITIONS, createCapabilityManager, createConnectionManager };
