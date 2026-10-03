'use strict';
const { describeCapability } = require('../executive-brain/capability-registry');
const { copy, freeze, fail } = require('./scope-session');
// Composable primitives, rather than one blueprint for each sentence. Resource
// adapters are installed by trusted composition; planners only choose these ids.
const DEFINITIONS = freeze({
 'calendar.read': { role: 'calendar', provider: 'calendar', scope: 'calendar.read', provenance: 'CALENDAR', terms: ['agenda','cita','hoy','mañana'], label: 'tu agenda' },
 'gmail.read': { role: 'email', provider: 'mail', scope: 'mail.read', provenance: 'GMAIL', terms: ['correo','email','facturas'], label: 'tu correo' },
 'memory.search': { role: 'memory', provider: null, provenance: 'INTERNAL_MEMORY', terms: ['recupera','recuerdas','dije','memoria'], label: 'tu memoria' },
 'memory.remember': { role: 'memory-write', provider: null, provenance: 'INTERNAL_MEMORY', terms: ['recuerda','guarda esta información'], label: 'recordar información' },
 'documents.read': { role: 'documents', provider: 'storage', scope: 'documents.read', provenance: 'INTERNAL_DOCUMENT', terms: ['documento','archivo'], label: 'tus documentos' },
 'web.search': { role: 'web-search', provider: 'search', scope: 'public.search', provenance: 'PUBLIC_DISCOVERY', terms: ['investiga','investigar','abierto','compara','cocinar'], label: 'buscar fuentes públicas' },
 'research.web': { role: 'web-research', provider: 'fetch', scope: 'public.fetch', provenance: 'PUBLIC_WEB', terms: [], label: 'leer fuentes públicas' },
 'data.analyze': { role: 'data-analysis', provider: null, provenance: 'DERIVED', terms: ['clasifica','organiza','compara','facturas'], label: 'analizar información' },
 'storage.propose': { role: 'storage-proposal', provider: 'storage', scope: 'documents.read', provenance: 'INTERNAL_PROPOSAL', terms: ['carpeta','almacenamiento','facturas'], label: 'proponer organización de archivos' },
});
const FORBIDDEN = /\b(enviar|envía|send|deploy|producción|contrata|comprar|borra|elimina|iam|contraseña|password|secreto)\b/i;
function createCapabilityManager({ connections, planner = null }) {
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
 async function compose(text, context = {}) {
  if (typeof text !== 'string' || text.length < 2 || text.length > 2000) fail('intention_invalid');
  if (FORBIDDEN.test(text)) return { gate: 'HUMAN_GATE', message: 'Esta acción requiere una autorización específica. No he ejecutado nada.' };
  const normalized = text.toLowerCase();
  let ids = Object.entries(DEFINITIONS).filter(([, d]) => d.terms.some(term => normalized.includes(term))).map(([id]) => id);
  if (ids.includes('memory.remember')) ids = ['memory.remember'];
  if (ids.includes('web.search')) ids.push('research.web');
  if (ids.length === 0 && !planner) return { gate: 'CAPABILITY_GAP', message: '¿Qué resultado quieres conseguir? Puedo comprobar las fuentes y conexiones necesarias y preparar un procedimiento.' };
  const raw = planner ? await planner(freeze({ intention: text, capabilities: Object.keys(DEFINITIONS) }), context) : [...new Set(ids)].map((capability, i, all) => ({ key: 'step-'+i, capability, dependsOn: ['data.analyze','storage.propose','research.web'].includes(capability) ? all.slice(0,i).map((_,j) => 'step-'+j) : [] }));
  return { plan: validatePlan(raw) };
 }
 function gaps(handle, plan) { return plan.flatMap(step => { const d = DEFINITIONS[step.capability]; if (!d.provider) return []; const status = connections.inspect(handle,d.provider,d.scope); return status.ready ? [] : [{ ...status, capability: step.capability, provider: d.provider, permission: d.scope, reason: 'Necesito acceso para consultar '+d.label+'.', canDo: 'Consultar y preparar resultados para ti.', cannotDo: 'Enviar, publicar o ejecutar cambios externos.', how: 'Conecta el servicio mediante su autorización segura; nunca compartas una contraseña.' }]; }); }
 return Object.freeze({ compose, validatePlan, profile, gaps, definitions: DEFINITIONS });
}
// Only trusted OAuth callbacks/composition may install a scoped connection.
// An adapter must carry the server-resolved owner and explicit allowed scopes.
function createConnectionManager(sessions) {
 const entries = new Map();
 const key = (h,p) => JSON.stringify([sessions.key(h),p]);
 function install(handle, provider, adapter) {
  const scope = sessions.scope(handle);
  if (!['calendar','mail','storage','search','fetch'].includes(provider) || !adapter || typeof adapter.read !== 'function'
   || adapter.tenantId !== scope.tenantId || adapter.userId !== scope.userId || adapter.clientId !== scope.clientId
   || !Array.isArray(adapter.scopes) || !['fixture','live'].includes(adapter.origin)) fail('connection_scope_invalid');
  entries.set(key(handle,provider),Object.freeze({ read: adapter.read, scopes: Object.freeze([...adapter.scopes]), origin: adapter.origin, generation: Symbol() }));
 }
 function inspect(handle,provider,permission) { const e=entries.get(key(handle,provider)); return { ready: Boolean(e && e.scopes.includes(permission)), status: !e ? 'NOT_CONNECTED' : !e.scopes.includes(permission) ? 'PERMISSION_REQUIRED' : 'CONNECTED' }; }
 function capture(handle,provider,permission) { if (!inspect(handle,provider,permission).ready) fail('connection_required'); const e=entries.get(key(handle,provider)); return Object.freeze({ read: async input => { await sessions.current(handle); if(entries.get(key(handle,provider)) !== e) fail('connection_revoked'); const {signal,...data}=input;const result=await e.read(Object.freeze({...freeze(copy(data)),signal})); await sessions.current(handle); if(entries.get(key(handle,provider)) !== e) fail('connection_revoked'); return copy(result); }, origin:e.origin }); }
 function disconnect(handle,provider) { entries.delete(key(handle,provider)); }
 return Object.freeze({ install, inspect, capture, disconnect });
}
module.exports = { DEFINITIONS, createCapabilityManager, createConnectionManager };
