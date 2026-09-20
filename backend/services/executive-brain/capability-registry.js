'use strict';

// V0.4 FASE 2: a real, data-driven inventory of what OXKIO can and cannot do,
// so "que puedes hacer"/"que no puedes hacer todavia" answer from this table
// instead of a hardcoded string that can silently go stale. Each entry
// describes one capability owned by exactly one responsible module — this
// registry does not implement anything itself, it only declares what
// already exists elsewhere in the codebase (or explicitly does not yet).
const MODES = Object.freeze(['read', 'analyze', 'propose', 'execute']);

const CAPABILITIES = Object.freeze([
  Object.freeze({
    id: 'gmail.read', name: 'Leer tu correo reciente',
    description: 'Consultar remitente, asunto y fecha de tus correos recientes.',
    mode: 'read', owner: 'gmail-private-provider', risk: 'low',
    requiresApproval: false, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'gmail.draft', name: 'Preparar un borrador de respuesta',
    description: 'Redactar un borrador de correo sin enviarlo, para tu revisión.',
    mode: 'propose', owner: 'gmail-draft-provider-factory', risk: 'medium',
    requiresApproval: true, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'gmail.send', name: 'Enviar un correo real',
    description: 'Enviar un correo en tu nombre.',
    mode: 'execute', owner: 'gmail-draft-provider-factory', risk: 'high',
    requiresApproval: true, available: false,
    unavailableReason: 'Deshabilitado por seguridad (allowRealSend=false).',
  }),
  Object.freeze({
    id: 'gmail.prioritize', name: 'Priorizar tu correo',
    description: 'Clasificar correos por urgencia/importancia.',
    mode: 'analyze', owner: 'mail-priority', risk: 'low',
    requiresApproval: false, available: false,
    unavailableReason: 'La funcion existe internamente pero todavia no esta conectada al chat.',
  }),
  Object.freeze({
    id: 'calendar.read', name: 'Leer tu agenda',
    description: 'Consultar tus proximos eventos.',
    mode: 'read', owner: 'calendar-private-provider', risk: 'low',
    requiresApproval: false, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'calendar.create', name: 'Crear eventos de calendario',
    description: 'Crear o modificar eventos en tu agenda.',
    mode: 'execute', owner: null, risk: 'high',
    requiresApproval: true, available: false,
    unavailableReason: 'Todavia no esta desarrollado.',
  }),
  Object.freeze({
    id: 'tasks.read', name: 'Consultar tus tareas',
    description: 'Consultar tus tareas personales y su estado.',
    mode: 'read', owner: null, risk: 'low',
    requiresApproval: false, available: false,
    unavailableReason: 'Tus tareas viven en la app pero el chat todavia no tiene acceso a ellas.',
  }),
  Object.freeze({
    id: 'documents.read', name: 'Consultar tus documentos',
    description: 'Consultar tus documentos personales.',
    mode: 'read', owner: null, risk: 'low',
    requiresApproval: false, available: false,
    unavailableReason: 'Tus documentos viven en la app pero el chat todavia no tiene acceso a ellos.',
  }),
  Object.freeze({
    id: 'drive.search', name: 'Buscar en Drive',
    description: 'Buscar archivos en Drive.',
    mode: 'read', owner: null, risk: 'low',
    requiresApproval: false, available: false,
    unavailableReason: 'Todavia no esta desarrollado.',
  }),
  Object.freeze({
    id: 'memory.search', name: 'Consultar la memoria del proyecto',
    description: 'Consultar decisiones y contexto pasado registrados.',
    mode: 'read', owner: 'memory', risk: 'low',
    requiresApproval: false, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'approvals.read', name: 'Consultar tus aprobaciones pendientes',
    description: 'Consultar propuestas que esperan tu aprobacion.',
    mode: 'read', owner: 'approvalQueue', risk: 'low',
    requiresApproval: false, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'dashboard.read', name: 'Darte un estado general',
    description: 'Resumen agregado de tu dia (agenda, correo, aprobaciones).',
    mode: 'read', owner: 'dashboard-intelligence', risk: 'low',
    requiresApproval: false, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'governance.read', name: 'Consultar el estado de gobernanza de OXKIO',
    description: 'Consultar politicas y estado del propio proyecto OXKIO.',
    mode: 'read', owner: 'ecosystem-observer', risk: 'low',
    requiresApproval: false, available: false,
    unavailableReason: 'Existe internamente pero todavia no esta conectado al chat.',
  }),
  Object.freeze({
    id: 'executive.summary', name: 'Darte un resumen ejecutivo',
    description: 'Agregar correo, agenda y aprobaciones en una sola respuesta.',
    mode: 'analyze', owner: 'dashboard-intelligence', risk: 'low',
    requiresApproval: false, available: true, unavailableReason: null,
  }),
  Object.freeze({
    id: 'executive.prioritize', name: 'Decidir que atender primero entre varias fuentes',
    description: 'Comparar y priorizar asuntos combinando Gmail, Calendar y aprobaciones.',
    mode: 'analyze', owner: null, risk: 'low',
    requiresApproval: false, available: false,
    unavailableReason: 'Todavia no existe un motor de priorizacion cruzada entre fuentes.',
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
