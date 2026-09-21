'use strict';

// V0.4 FASE 2: a real, data-driven inventory of what OXKIO can and cannot do,
// so "que puedes hacer"/"que no puedes hacer todavia" answer from this table
// instead of a hardcoded string that can silently go stale. Each entry
// describes one capability owned by exactly one responsible module — this
// registry does not implement anything itself, it only declares what
// already exists elsewhere in the codebase (or explicitly does not yet).
const MODES = Object.freeze(['read', 'analyze', 'propose', 'execute']);

// FULL RUNTIME REVEAL FASE 4/20: source and dependencies make each entry
// independently verifiable against the real code (grep the source file,
// confirm the dependency chain) instead of trusting the prose description.
// partial=true means the capability is real and connected but narrower than
// its name suggests (e.g. only reachable through specific phrasings, or only
// reasoning over data already shown this conversation) — unavailableReason
// is reused to explain that limitation even when available=true, so there is
// exactly one place to read "why isn't this the full thing yet".
const CAPABILITIES = Object.freeze([
  Object.freeze({
    id: 'gmail.read', name: 'Leer tu correo reciente',
    description: 'Consultar remitente, asunto y fecha de tus correos recientes.',
    mode: 'read', owner: 'gmail-private-provider', risk: 'low',
    requiresApproval: false, available: true, partial: false, unavailableReason: null,
    source: 'backend/services/private-context/gmail-private-provider.js',
    dependencies: ['google-oauth'],
  }),
  Object.freeze({
    id: 'gmail.draft', name: 'Preparar un borrador de respuesta',
    description: 'Redactar un borrador de correo sin enviarlo, para tu revisión.',
    mode: 'propose', owner: 'gmail-draft-provider-factory', risk: 'medium',
    requiresApproval: true, available: true, partial: false, unavailableReason: null,
    source: 'backend/services/execution/gmail-draft-provider-factory.js',
    dependencies: ['gmail.read', 'google-oauth'],
  }),
  Object.freeze({
    id: 'gmail.send', name: 'Enviar un correo real',
    description: 'Enviar un correo en tu nombre.',
    mode: 'execute', owner: 'gmail-draft-provider-factory', risk: 'high',
    requiresApproval: true, available: false, partial: false,
    unavailableReason: 'Deshabilitado por seguridad (allowRealSend=false).',
    source: 'backend/services/execution/providers/gmail-draft-provider.js',
    dependencies: ['gmail.draft'],
  }),
  Object.freeze({
    id: 'gmail.prioritize', name: 'Priorizar tu correo',
    description: 'Clasificar correos por urgencia/importancia.',
    mode: 'analyze', owner: 'mail-priority', risk: 'low',
    // V0.5 FASE 6 wired this into context-intent-router.js (PRIORITIZE_QUERIES)
    // and executive-orchestrator.js (buildPrioritizationAnswer), which calls
    // classifyMailPriority for real. Previously reported as unavailable —
    // that was stale the moment V0.5 shipped; corrected in FULL RUNTIME REVEAL.
    requiresApproval: false, available: true, partial: true,
    // V0.6.1 PROBLEMA 5: this text can reach the user (describeCapabilityAnswer
    // interpolates unavailableReason verbatim), so it stays free of internal
    // identifiers (function/constant names, file paths) — those live in
    // `source`/`dependencies` instead, for developers/audits.
    unavailableReason: 'Solo reconoce peticiones con frases concretas y solo razona sobre los correos que ya te mostre en esta conversacion, nunca vuelve a clasificar toda la bandeja en vivo.',
    source: 'backend/services/private-context/mail-priority.js',
    dependencies: ['gmail.read'],
  }),
  Object.freeze({
    id: 'calendar.read', name: 'Leer tu agenda',
    description: 'Consultar tus proximos eventos.',
    mode: 'read', owner: 'calendar-private-provider', risk: 'low',
    requiresApproval: false, available: true, partial: false, unavailableReason: null,
    source: 'backend/services/private-context/calendar-private-provider.js',
    dependencies: ['google-oauth'],
  }),
  Object.freeze({
    id: 'calendar.create', name: 'Crear eventos de calendario',
    description: 'Crear o modificar eventos en tu agenda.',
    mode: 'execute', owner: null, risk: 'high',
    requiresApproval: true, available: false, partial: false,
    unavailableReason: 'Todavia no esta desarrollado.',
    source: null, dependencies: [],
  }),
  Object.freeze({
    id: 'tasks.read', name: 'Consultar tus tareas',
    description: 'Consultar tus tareas personales y su estado.',
    mode: 'read', owner: null, risk: 'low',
    requiresApproval: false, available: false, partial: false,
    unavailableReason: 'Tus tareas viven en la app pero el chat todavia no tiene acceso a ellas.',
    source: null, dependencies: [],
  }),
  Object.freeze({
    id: 'documents.read', name: 'Consultar tus documentos',
    description: 'Consultar tus documentos personales.',
    mode: 'read', owner: null, risk: 'low',
    requiresApproval: false, available: false, partial: false,
    unavailableReason: 'Tus documentos viven en la app pero el chat todavia no tiene acceso a ellos.',
    source: null, dependencies: [],
  }),
  Object.freeze({
    id: 'drive.search', name: 'Buscar en Drive',
    description: 'Buscar archivos en Drive.',
    mode: 'read', owner: null, risk: 'low',
    requiresApproval: false, available: false, partial: false,
    unavailableReason: 'Todavia no esta desarrollado.',
    source: null, dependencies: [],
  }),
  Object.freeze({
    id: 'memory.search', name: 'Consultar la memoria del proyecto',
    description: 'Consultar decisiones y contexto pasado registrados.',
    mode: 'read', owner: 'memory', risk: 'low',
    requiresApproval: false, available: true, partial: false, unavailableReason: null,
    source: 'backend/memory/memoryEngine.js', dependencies: [],
  }),
  Object.freeze({
    id: 'approvals.read', name: 'Consultar tus aprobaciones pendientes',
    description: 'Consultar propuestas que esperan tu aprobacion.',
    mode: 'read', owner: 'approvalQueue', risk: 'low',
    requiresApproval: false, available: true, partial: false, unavailableReason: null,
    source: 'backend/core/approvalQueue.js', dependencies: [],
  }),
  Object.freeze({
    id: 'dashboard.read', name: 'Darte un estado general',
    description: 'Resumen agregado de tu dia (agenda, correo, aprobaciones).',
    mode: 'read', owner: 'dashboard-intelligence', risk: 'low',
    // partial: /api/dashboard exposes the full state; the chat only exposes
    // a saned subset (status/agenda/gmail/memory/approvals/executiveSummary/
    // morningBriefing) — see sanitizeDashboardContext() in executive-chat.js
    // for the technical detail; unavailableReason itself stays human-facing.
    requiresApproval: false, available: true, partial: true,
    unavailableReason: 'El chat solo muestra un resumen del estado general; el detalle completo del dashboard solo esta disponible en el panel, no en el chat.',
    source: 'backend/services/dashboard/dashboard-intelligence.js',
    dependencies: ['gmail.read', 'calendar.read', 'approvals.read'],
  }),
  Object.freeze({
    id: 'governance.read', name: 'Consultar el estado de gobernanza de OXKIO',
    description: 'Consultar politicas y estado del propio proyecto OXKIO.',
    mode: 'read', owner: 'ecosystem-observer', risk: 'low',
    // Corrected in FULL RUNTIME REVEAL: buildEcosystemObserver() DOES run on
    // every getDashboardState() call (dashboard-intelligence.js), it is not
    // disconnected — its output is computed and then discarded by
    // sanitizeDashboardContext() in executive-chat.js before it ever reaches
    // the user. The user-facing effect (chat cannot answer this) is correct;
    // the previous reason ("no conectado") was not. V0.6.1 PROBLEMA 5:
    // unavailableReason can reach the user verbatim (describeCapabilityAnswer),
    // so the technical mechanism (which functions run, where the discard
    // happens) stays in this comment and in `source`, never in the string
    // itself.
    requiresApproval: false, available: false, partial: false,
    unavailableReason: 'El estado de gobernanza todavia no esta disponible directamente en el chat; solo se calcula para el panel completo.',
    source: 'backend/services/executive-brain/ecosystem-observer.js',
    dependencies: ['dashboard.read'],
  }),
  Object.freeze({
    id: 'executive.summary', name: 'Darte un resumen ejecutivo',
    description: 'Agregar correo, agenda y aprobaciones en una sola respuesta.',
    mode: 'analyze', owner: 'dashboard-intelligence', risk: 'low',
    requiresApproval: false, available: true, partial: false, unavailableReason: null,
    source: 'backend/services/dashboard/dashboard-intelligence.js',
    dependencies: ['dashboard.read'],
  }),
  Object.freeze({
    id: 'executive.prioritize', name: 'Decidir que atender primero entre varias fuentes',
    description: 'Comparar y priorizar asuntos combinando Gmail, Calendar y aprobaciones.',
    mode: 'analyze', owner: null, risk: 'low',
    requiresApproval: false, available: false, partial: false,
    unavailableReason: 'Todavia no existe un motor de priorizacion cruzada entre fuentes.',
    source: null, dependencies: [],
  }),
]);

function listCapabilities() { return CAPABILITIES; }
function getCapability(id) { return CAPABILITIES.find((capability) => capability.id === id) || null; }
function listAvailable() { return CAPABILITIES.filter((capability) => capability.available); }
function listUnavailable() { return CAPABILITIES.filter((capability) => !capability.available); }

module.exports = {
  MODES,
  listCapabilities,
  getCapability,
  listAvailable,
  listUnavailable,
};
