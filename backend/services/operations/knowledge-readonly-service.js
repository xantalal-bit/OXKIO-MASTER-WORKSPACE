'use strict';

const { createExecutiveRuntime } = require('../runtime/executive-runtime-factory');
const { searchKnowledge } = require('../knowledge/knowledge-query-service');

const WORKER_NAME = 'knowledge-readonly';
const MODE = 'manual';
const DEFAULT_TIMEOUT_MS = 7000;
const SAFE_ASSET_QUERIES = Object.freeze(['XANTALAL', 'OXKIO', 'Business Hunter', 'Learning Heroes']);
const MAX_ITEMS = 10;
const MAX_TOPICS = 5;
const MAX_RECOMMENDATIONS = 3;

function cleanText(value, limit = 120) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function executiveTopic(value) {
  const topic = cleanText(value, 80);
  const labels = {
    markdown: 'Documentos de trabajo', generic: 'Información general',
    governance: 'Gobernanza', executive: 'Gestión ejecutiva', commercial: 'Actividad comercial',
    education: 'Formación', knowledge: 'Conocimiento', business: 'Negocio',
  };
  return labels[topic.toLowerCase()] || topic;
}

function timeoutError() {
  return Object.assign(new Error('Knowledge review timed out.'), { code: 'knowledge_review_timeout' });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function collectTopics(results) {
  const topics = [];
  results.forEach((result) => {
    const asset = result && result.asset;
    const objects = result && result.pipeline && Array.isArray(result.pipeline.knowledgeObjects)
      ? result.pipeline.knowledgeObjects.slice(0, MAX_ITEMS)
      : [];
    [asset && asset.domain, ...objects.map((item) => item && item.metadata
      && item.metadata.documentTypeClassification
      && item.metadata.documentTypeClassification.type)]
      .map((value) => executiveTopic(value))
      .filter((value) => value && value.toLowerCase() !== 'unknown')
      .forEach((value) => { if (!topics.includes(value) && topics.length < MAX_TOPICS) topics.push(value); });
  });
  return topics;
}

function buildResult(ids, results, startedAt) {
  const found = results.filter((result) => result && result.found === true);
  const itemsCount = Math.min(MAX_ITEMS, found.reduce((total, result) => {
    const objects = result.pipeline && Array.isArray(result.pipeline.knowledgeObjects)
      ? result.pipeline.knowledgeObjects.length : 0;
    return total + objects;
  }, 0));
  const sourceStatus = itemsCount > 0 ? 'real' : found.length > 0 ? 'partial' : 'unavailable';
  const summary = sourceStatus === 'real'
    ? 'Se ha revisado la información disponible y se han identificado los temas principales para consulta y trabajo posterior.'
    : sourceStatus === 'partial'
      ? 'Hay información disponible, aunque todavía es limitada o incompleta.'
      : 'No se ha encontrado información suficiente para completar la revisión.';
  const recommendations = sourceStatus === 'real'
    ? ['Revisar los temas localizados antes de ampliar la biblioteca.', 'Mantener la revisión en modo de solo análisis.']
    : sourceStatus === 'partial'
      ? ['Identificar las áreas con información insuficiente.', 'Mantener la revisión en modo de solo análisis.']
      : ['Identificar las áreas con información insuficiente.'];
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
    topics: Object.freeze(collectTopics(found).slice(0, MAX_TOPICS)),
    recommendations: Object.freeze(recommendations.slice(0, MAX_RECOMMENDATIONS)),
    warnings: Object.freeze(sourceStatus === 'real' ? [] : [summary]),
    errors: Object.freeze([]),
  });
}

function createKnowledgeReadonlyService(dependencies = {}) {
  let lock = false;
  async function runKnowledgeReadonly(options = {}) {
    if (lock) throw Object.assign(new Error('Knowledge review already running.'), { code: 'knowledge_operation_in_progress' });
    const operationId = cleanText(options.operationId, 80);
    const interactionId = cleanText(options.interactionId, 80);
    if (!operationId || !interactionId) throw Object.assign(new Error('Missing operation identifiers.'), { code: 'invalid_knowledge_operation' });
    const identity = options.identity;
    if (!identity || identity.clientId !== identity.expectedClientId
      || !identity.authorization || identity.authorization.status !== 'granted') {
      throw Object.assign(new Error('Knowledge review authorization required.'), { code: 'operation_authorization_denied' });
    }
    lock = true;
    let runtime;
    const startedAt = new Date().toISOString();
    try {
      const factory = dependencies.createExecutiveRuntime || createExecutiveRuntime;
      const query = dependencies.searchKnowledge || searchKnowledge;
      runtime = factory({ mode: 'sandbox' });
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
      const results = await withTimeout(Promise.resolve().then(() => Promise.all(SAFE_ASSET_QUERIES.map((assetName) => query(assetName, {
        persist: false,
      })))), timeoutMs);
      return buildResult({ operationId, interactionId }, results, startedAt);
    } catch (error) {
      throw Object.assign(new Error(error && error.code === 'knowledge_review_timeout'
        ? 'La revisión tardó más de lo permitido y se detuvo de forma segura.'
        : 'No se pudo completar la revisión de conocimiento.'), { code: error && error.code || 'knowledge_review_failed' });
    } finally {
      lock = false;
      if (runtime && typeof runtime.cleanup === 'function') {
        try { runtime.cleanup(); } catch (error) { /* readonly cleanup is best effort */ }
      }
    }
  }
  return Object.freeze({ runKnowledgeReadonly });
}

module.exports = { WORKER_NAME, DEFAULT_TIMEOUT_MS, SAFE_ASSET_QUERIES, createKnowledgeReadonlyService };
