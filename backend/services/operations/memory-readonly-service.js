'use strict';

const { createExecutiveRuntime } = require('../runtime/executive-runtime-factory');

const WORKER_NAME = 'memory-readonly';
const MODE = 'manual';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ITEMS = 10;
const MAX_TOPICS = 5;
const MAX_RECOMMENDATIONS = 3;

function cleanText(value, limit = 100) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function executiveTopic(value) {
  const labels = {
    decisions: 'Decisiones', tasks: 'Tareas', roadmap: 'Planificación', documentation: 'Documentación',
    learning: 'Aprendizaje', governance: 'Gobernanza', email: 'Comunicaciones', meeting: 'Reuniones',
    completed: 'Trabajo completado', failed: 'Incidencias',
  };
  const topic = cleanText(value, 60).toLowerCase();
  return labels[topic] || null;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Memory review timed out.'), { code: 'memory_review_timeout' })), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function sanitizeEntries(entries) {
  return (Array.isArray(entries) ? entries : []).slice(-MAX_ITEMS).map((entry) => {
    const data = entry && entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data : {};
    return Object.freeze({
      intent: executiveTopic(data.intent),
      status: executiveTopic(data.status),
      actionable: data.actionable === true,
    });
  });
}

function buildResult(ids, entries, startedAt) {
  const safeEntries = sanitizeEntries(entries);
  const topics = [];
  safeEntries.flatMap((entry) => [entry.intent, entry.status]).filter(Boolean).forEach((topic) => {
    if (!topics.includes(topic) && topics.length < MAX_TOPICS) topics.push(topic);
  });
  const itemsCount = safeEntries.length;
  const sourceStatus = itemsCount > 0 ? (topics.length > 0 ? 'real' : 'partial') : 'unavailable';
  const summary = sourceStatus === 'real'
    ? 'He encontrado información relacionada en la memoria ejecutiva.'
    : sourceStatus === 'partial'
      ? 'Hay recuerdos disponibles, aunque su contexto es limitado.'
      : 'No se ha encontrado información suficiente en la memoria ejecutiva.';
  const recommendations = sourceStatus === 'real'
    ? ['Revisar los temas principales antes de tomar una decisión.', 'Mantener la revisión en modo de solo consulta.']
    : sourceStatus === 'partial'
      ? ['Completar el contexto antes de utilizar estos recuerdos.', 'Mantener la revisión en modo de solo consulta.']
      : ['Continuar sin utilizar memoria hasta disponer de información suficiente.'];
  const completedAt = new Date().toISOString();
  return Object.freeze({
    ...ids,
    worker: WORKER_NAME,
    mode: MODE,
    status: sourceStatus === 'real' ? 'completed' : 'completed_with_warnings',
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    sourceStatus,
    summary,
    itemsCount,
    topics: Object.freeze(topics.slice(0, MAX_TOPICS)),
    recommendations: Object.freeze(recommendations.slice(0, MAX_RECOMMENDATIONS)),
    warnings: Object.freeze(sourceStatus === 'real' ? [] : [summary]),
    errors: Object.freeze([]),
  });
}

function createMemoryReadonlyService(dependencies = {}) {
  let lock = false;
  async function runMemoryReadonly(options = {}) {
    if (lock) throw Object.assign(new Error('Memory review already running.'), { code: 'memory_operation_in_progress' });
    const operationId = cleanText(options.operationId, 80);
    const interactionId = cleanText(options.interactionId, 80);
    if (!operationId || !interactionId) throw Object.assign(new Error('Missing operation identifiers.'), { code: 'invalid_memory_operation' });
    const identity = options.identity;
    if (!identity || identity.clientId !== identity.expectedClientId
      || !identity.authorization || identity.authorization.status !== 'granted') {
      throw Object.assign(new Error('Memory review authorization required.'), { code: 'operation_authorization_denied' });
    }
    const memoryEngine = dependencies.memoryEngine;
    if (!memoryEngine || typeof memoryEngine.getRecentMemory !== 'function') {
      throw Object.assign(new Error('Memory Engine unavailable.'), { code: 'memory_service_unavailable' });
    }
    lock = true;
    let runtime;
    const startedAt = new Date().toISOString();
    try {
      const factory = dependencies.createExecutiveRuntime || createExecutiveRuntime;
      runtime = factory({ mode: 'sandbox' });
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
      const entries = await withTimeout(Promise.resolve().then(() => memoryEngine.getRecentMemory({ persist: false })), timeoutMs);
      return buildResult({ operationId, interactionId }, entries, startedAt);
    } catch (error) {
      throw Object.assign(new Error(error && error.code === 'memory_review_timeout'
        ? 'La revisión tardó más de lo permitido y se detuvo de forma segura.'
        : 'No se pudo completar la revisión de memoria.'), { code: error && error.code || 'memory_review_failed' });
    } finally {
      lock = false;
      if (runtime && typeof runtime.cleanup === 'function') {
        try { runtime.cleanup(); } catch (error) { /* readonly cleanup is best effort */ }
      }
    }
  }
  return Object.freeze({ runMemoryReadonly });
}

module.exports = { WORKER_NAME, DEFAULT_TIMEOUT_MS, createMemoryReadonlyService };
