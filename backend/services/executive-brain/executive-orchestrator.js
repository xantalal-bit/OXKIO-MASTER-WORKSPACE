'use strict';

const { randomUUID } = require('crypto');
const { analyzeExecutiveQuery } = require('./query-analyzer');
const { searchKnowledge } = require('../knowledge/knowledge-query-service');
const { simulateExecutiveBrainQuery } = require('../knowledge/executive-brain-simulation');
const { preparePrivateContextAdapter } = require('../private-context/private-context-adapter');
const { buildExecutiveResponse } = require('./executive-response-builder');

function shouldUseKnowledgeQuery(analysis) {
  return Boolean(analysis && analysis.project);
}

function buildSimulationQuery(query, analysis) {
  const parts = [
    query,
    analysis && analysis.project ? analysis.project : null,
    analysis && analysis.intent !== 'unknown' ? analysis.intent : null,
    ...(analysis && Array.isArray(analysis.keywords) ? analysis.keywords : []),
  ].filter(Boolean);

  return Array.from(new Set(parts)).join(' ');
}

function normalizeQueryText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isTemporalAgendaQuery(query, analysis) {
  const normalizedQuery = normalizeQueryText(query);
  const keywords = analysis && Array.isArray(analysis.keywords)
    ? analysis.keywords.map(normalizeQueryText)
    : [];
  const searchableText = `${normalizedQuery} ${keywords.join(' ')}`;

  return [
    'agenda',
    'calendario',
    'calendar',
    'evento',
    'eventos',
    'reunion',
    'reuniones',
    'cita',
    'citas',
    'compromiso',
    'compromisos',
    'hoy',
    'manana',
    'semana',
    'proximas 24',
    'briefing',
  ].some((term) => searchableText.includes(term));
}

function shouldPreferPrivateCalendarContext(query, analysis, authorizedContext) {
  return Boolean(
    authorizedContext
      && authorizedContext.sourceType === 'calendar'
      && isTemporalAgendaQuery(query, analysis),
  );
}

function isEmailQuery(query, analysis) {
  const normalizedQuery = normalizeQueryText(query);
  const keywords = analysis && Array.isArray(analysis.keywords)
    ? analysis.keywords.map(normalizeQueryText)
    : [];
  const searchableText = `${normalizedQuery} ${keywords.join(' ')}`;

  return [
    'correo',
    'correos',
    'email',
    'emails',
    'gmail',
    'inbox',
    'bandeja',
    'mensaje',
    'mensajes',
  ].some((term) => searchableText.includes(term));
}

function shouldPreferPrivateGmailContext(query, analysis, authorizedContext) {
  return Boolean(
    authorizedContext
      && authorizedContext.sourceType === 'gmail'
      && isEmailQuery(query, analysis),
  );
}

function isMixedAgendaEmailQuery(query, analysis) {
  return isTemporalAgendaQuery(query, analysis) && isEmailQuery(query, analysis);
}

function filterPrivatePrimaryLimitations(limitations) {
  const noisyPatterns = [
    /knowledge store/i,
    /knowledge objects/i,
    /simulation only/i,
    /no ai is used/i,
    /persisted knowledge objects/i,
    /deterministic keyword/i,
  ];

  return Array.isArray(limitations)
    ? limitations.filter((limitation) => !noisyPatterns.some((pattern) => pattern.test(String(limitation))))
    : [];
}

function hasPrivateContextInput(options) {
  return Boolean(options && (
    Object.hasOwn(options, 'privateContextMetadata')
    || Object.hasOwn(options, 'privatePayload')
    || Object.hasOwn(options, 'expectedClientId')
  ));
}

function hasPrivateContextCollectionInput(options) {
  return Boolean(options && Object.hasOwn(options, 'privateContexts'));
}

function buildPrivateContextIdentityMismatchError() {
  const error = new Error('private context identity mismatch.');
  error.code = 'private_context_identity_mismatch';
  return error;
}

function getEffectivePrivateContextValue(privateContextOptions, fieldName, defaults = {}) {
  if (Object.hasOwn(privateContextOptions, fieldName)) {
    return privateContextOptions[fieldName];
  }

  return defaults[fieldName];
}

function validatePrivateContextCollectionIdentity(privateContexts, defaults = {}) {
  if (!Array.isArray(privateContexts) || privateContexts.length <= 1) {
    return;
  }

  const firstContextOptions = privateContexts[0] || {};
  const firstMetadata = firstContextOptions.privateContextMetadata || {};
  const expectedIdentity = {
    clientId: firstMetadata.clientId,
    userId: firstMetadata.userId,
    expectedClientId: getEffectivePrivateContextValue(firstContextOptions, 'expectedClientId', defaults),
    purpose: firstMetadata.purpose,
    promotionPolicy: firstMetadata.promotionPolicy,
  };

  const hasMismatch = privateContexts.some((privateContextOptions = {}) => {
    const metadata = privateContextOptions.privateContextMetadata || {};

    return metadata.clientId !== expectedIdentity.clientId
      || metadata.userId !== expectedIdentity.userId
      || getEffectivePrivateContextValue(
        privateContextOptions,
        'expectedClientId',
        defaults,
      ) !== expectedIdentity.expectedClientId
      || metadata.purpose !== 'executive-briefing'
      || metadata.purpose !== expectedIdentity.purpose
      || metadata.promotionPolicy !== 'NEVER_PROMOTE'
      || metadata.promotionPolicy !== expectedIdentity.promotionPolicy;
  });

  if (hasMismatch) {
    throw buildPrivateContextIdentityMismatchError();
  }
}

function countPayloadItems(payload) {
  if (Array.isArray(payload)) {
    return payload.length;
  }

  if (!payload || typeof payload !== 'object') {
    return 0;
  }

  const listKeys = [
    'items',
    'events',
    'emails',
    'documents',
    'projects',
    'criticalDates',
    'tasks',
  ];
  const matchedListKey = listKeys.find((key) => Array.isArray(payload[key]));

  return matchedListKey ? payload[matchedListKey].length : Object.keys(payload).length;
}

function buildPrivateContextSummary(authorizedContext) {
  if (authorizedContext.sensitivity === 'critical') {
    return 'Contexto privado autorizado considerado.';
  }

  if (authorizedContext.sourceType === 'calendar') {
    return buildCalendarContextSummary(authorizedContext.payload);
  }

  if (authorizedContext.sourceType === 'gmail') {
    return buildGmailContextSummary(authorizedContext.payload);
  }

  const itemCount = countPayloadItems(authorizedContext.payload);

  return `Contexto privado autorizado considerado: ${itemCount} elemento(s).`;
}

function findAuthorizedPrivateContextBySource(authorizedPrivateContexts, sourceType) {
  return Array.isArray(authorizedPrivateContexts)
    ? authorizedPrivateContexts.find((authorizedContext) => (
      authorizedContext && authorizedContext.sourceType === sourceType
    ))
    : null;
}

function buildCombinedPrivateContextSummary(query, analysis, authorizedPrivateContexts) {
  if (!isMixedAgendaEmailQuery(query, analysis)) {
    return null;
  }

  const calendarContext = findAuthorizedPrivateContextBySource(authorizedPrivateContexts, 'calendar');
  const gmailContext = findAuthorizedPrivateContextBySource(authorizedPrivateContexts, 'gmail');

  if (!calendarContext || !gmailContext) {
    return null;
  }

  return [
    buildCalendarContextSummary(calendarContext.payload),
    buildGmailContextSummary(gmailContext.payload),
  ].join(' ');
}

function formatCalendarEvent(event) {
  const title = event && typeof event.title === 'string' && event.title.trim()
    ? event.title.trim()
    : 'Evento sin titulo';
  const start = event && typeof event.start === 'string' && event.start.trim()
    ? event.start.trim()
    : null;

  if (!start) {
    return title;
  }

  const timeMatch = start.match(/T(\d{2}:\d{2})/);
  const timeText = timeMatch ? timeMatch[1] : start;

  return `${title} a las ${timeText}`;
}

function buildCalendarContextSummary(payload) {
  const events = payload && Array.isArray(payload.events) ? payload.events : [];

  if (events.length === 0) {
    return 'Agenda privada autorizada: no hay eventos en el rango solicitado.';
  }

  const visibleEvents = events.slice(0, 3).map(formatCalendarEvent);
  const hiddenCount = Math.max(events.length - visibleEvents.length, 0);
  const suffix = hiddenCount > 0 ? ` y ${hiddenCount} evento(s) mas.` : '.';
  const eventWord = events.length === 1 ? 'evento' : 'eventos';

  return `Agenda privada autorizada: tienes ${events.length} ${eventWord} hoy: ${visibleEvents.join('; ')}${suffix}`;
}

function formatGmailMessage(message) {
  const subject = message && typeof message.subject === 'string' && message.subject.trim()
    ? message.subject.trim()
    : 'Sin asunto';
  const from = message && typeof message.from === 'string' && message.from.trim()
    ? message.from.trim()
    : 'remitente desconocido';

  return `${subject} de ${from}`;
}

function buildGmailContextSummary(payload) {
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];

  if (messages.length === 0) {
    return 'Correo privado autorizado: no hay correos recientes en el rango solicitado.';
  }

  const visibleMessages = messages.slice(0, 3).map(formatGmailMessage);
  const hiddenCount = Math.max(messages.length - visibleMessages.length, 0);
  const suffix = hiddenCount > 0 ? ` y ${hiddenCount} correo(s) mas.` : '.';
  const messageWord = messages.length === 1 ? 'correo reciente' : 'correos recientes';
  const bulletMessages = visibleMessages.map((message, index) => {
    const isLastVisibleMessage = index === visibleMessages.length - 1;

    return `- ${message}${isLastVisibleMessage ? suffix : ''}`;
  }).join('\n');

  return `Correo privado autorizado: tienes ${messages.length} ${messageWord}:\n${bulletMessages}`;
}

function sanitizeExecutiveSources(sources) {
  if (!Array.isArray(sources)) {
    return [];
  }

  return sources.map((source) => {
    const sanitized = {};

    [
      'id',
      'name',
      'type',
      'score',
      'rankingPosition',
      'reasons',
    ].forEach((fieldName) => {
      if (source && Object.hasOwn(source, fieldName)) {
        sanitized[fieldName] = source[fieldName];
      }
    });

    return sanitized;
  });
}

function prepareAuthorizedPrivateContext(options, adapter, defaults = {}) {
  if (!hasPrivateContextInput(options)) {
    return null;
  }

  const adapterInput = {
    privateContext: options.privateContextMetadata,
    expectedClientId: Object.hasOwn(options, 'expectedClientId')
      ? options.expectedClientId
      : defaults.expectedClientId,
    allowedScopes: Object.hasOwn(options, 'privateContextAllowedScopes')
      ? options.privateContextAllowedScopes
      : defaults.privateContextAllowedScopes,
    requiredPurpose: Object.hasOwn(options, 'privateContextRequiredPurpose')
      ? options.privateContextRequiredPurpose
      : defaults.privateContextRequiredPurpose,
  };

  if (Object.hasOwn(options, 'privatePayload')) {
    adapterInput.payload = options.privatePayload;
  }

  return adapter(adapterInput);
}

function prepareAuthorizedPrivateContexts(options, adapter) {
  if (hasPrivateContextCollectionInput(options)) {
    if (!Array.isArray(options.privateContexts)) {
      throw new TypeError('privateContexts must be an array.');
    }

    const defaults = {
      expectedClientId: options.expectedClientId,
      privateContextAllowedScopes: options.privateContextAllowedScopes,
      privateContextRequiredPurpose: options.privateContextRequiredPurpose,
    };

    validatePrivateContextCollectionIdentity(options.privateContexts, defaults);

    return options.privateContexts.map((privateContextOptions) => prepareAuthorizedPrivateContext(
      privateContextOptions,
      adapter,
      defaults,
    ));
  }

  const authorizedPrivateContext = prepareAuthorizedPrivateContext(options, adapter);

  return authorizedPrivateContext ? [authorizedPrivateContext] : [];
}

function selectPrimaryPrivateContext(query, analysis, authorizedPrivateContexts) {
  if (!Array.isArray(authorizedPrivateContexts) || authorizedPrivateContexts.length === 0) {
    return null;
  }

  return authorizedPrivateContexts.find((authorizedContext) => (
    shouldPreferPrivateCalendarContext(query, analysis, authorizedContext)
    || shouldPreferPrivateGmailContext(query, analysis, authorizedContext)
  )) || authorizedPrivateContexts[0];
}

const MAX_MEMORY_RESULT_COUNT = 5;

function searchMemorySafely(memory, query, diagnostics) {
  diagnostics.memorySearchAttempted = false;
  diagnostics.memorySearchSucceeded = false;
  diagnostics.memoryResultCount = 0;

  if (!memory || typeof memory.searchMemory !== 'function') {
    return;
  }

  diagnostics.memorySearchAttempted = true;

  try {
    const results = memory.searchMemory(query);
    const normalizedResults = Array.isArray(results)
      ? results.filter((result) => result && typeof result === 'object').slice(0, MAX_MEMORY_RESULT_COUNT)
      : [];

    diagnostics.memorySearchSucceeded = true;
    diagnostics.memoryResultCount = normalizedResults.length;
  } catch (error) {
    diagnostics.memorySearchSucceeded = false;
    diagnostics.memoryResultCount = 0;
  }
}

function detectActionableIntent(query) {
  const normalizedQuery = normalizeQueryText(query);
  const includesAny = (terms) => terms.some((term) => normalizedQuery.includes(term));

  if (/\b(?:no|nunca)\s+(?:me\s+)?(?:prepares?|redactes?|crees?|generes?|programes?|agendes?|anadas?|registres?)\b/.test(normalizedQuery)) {
    return null;
  }

  if (
    includesAny(['prepara', 'preparar', 'redacta', 'redactar', 'crea', 'crear', 'genera', 'generar'])
    && includesAny(['borrador', 'respuesta', 'correo', 'email'])
  ) {
    return {
      intent: 'email',
      actionType: 'prepare-email-draft',
      proposalType: 'email_draft',
    };
  }

  if (
    includesAny(['crea', 'crear', 'programa', 'programar', 'agenda', 'agendar', 'propone', 'proponer'])
    && includesAny(['reunion'])
  ) {
    return {
      intent: 'meeting',
      actionType: 'propose_meeting',
      proposalType: 'meeting_proposal',
    };
  }

  if (
    includesAny(['crea', 'crear', 'anade', 'anadir', 'registra', 'registrar', 'prepara', 'preparar'])
    && includesAny(['tarea'])
  ) {
    return {
      intent: 'task',
      actionType: 'create_task_proposal',
      proposalType: 'task_proposal',
    };
  }

  return null;
}

function buildContextualDataSummary(contextualData) {
  if (!contextualData || typeof contextualData !== 'object') return null;
  const summaries = [];
  if (contextualData.dashboard) {
    const dashboard = contextualData.dashboard;
    summaries.push(dashboard.morningBriefing || dashboard.executiveSummary || 'Resumen ejecutivo agregado disponible.');
  }
  if (contextualData.approvals) {
    const pending = Array.isArray(contextualData.approvals.pending) ? contextualData.approvals.pending : [];
    const history = Array.isArray(contextualData.approvals.history) ? contextualData.approvals.history : [];
    summaries.push(`Approval Queue: ${pending.length} propuesta(s) pendiente(s) y ${history.length} registro(s) historico(s).`);
  }
  if (Array.isArray(contextualData.memory)) {
    summaries.push(`Memoria segura: ${contextualData.memory.length} registro(s) reciente(s) disponible(s).`);
  }
  return summaries.filter(Boolean).join(' ') || null;
}

function buildContextFailureSummary(contextFailures) {
  if (!Array.isArray(contextFailures) || contextFailures.length === 0) return null;
  const labels = {
    gmail_unavailable: 'Gmail readonly no esta disponible temporalmente.',
    calendar_unavailable: 'Calendar readonly no esta disponible temporalmente.',
    dashboard_unavailable: 'El resumen agregado no esta disponible temporalmente.',
    approvals_unavailable: 'Approval Queue no esta disponible temporalmente.',
    memory_unavailable: 'La memoria segura no esta disponible temporalmente.',
    private_context_unauthorized: 'El contexto privado solicitado no esta autorizado.',
  };
  return contextFailures.map((code) => labels[code]).filter(Boolean).join(' ');
}

function buildProposalEngineInput(query, analysis, executiveResponse, actionableIntent) {
  return {
    message: query,
    analysis: {
      intent: actionableIntent.intent,
      urgency: analysis && analysis.priority ? analysis.priority : 'normal',
      actionType: actionableIntent.actionType,
      requiresApproval: true,
    },
    decision: {
      recommendation: executiveResponse && executiveResponse.recommendation
        ? executiveResponse.recommendation
        : 'Preparar propuesta para revision humana.',
      requiresApproval: true,
    },
  };
}

function buildSafeProposalMetadata(actionableIntent, generatedProposal) {
  if (!generatedProposal || typeof generatedProposal !== 'object') {
    return null;
  }

  const summaries = {
    email_draft: 'Borrador de email preparado para revision.',
    meeting_proposal: 'Propuesta de reunion preparada para revision.',
    task_proposal: 'Propuesta de tarea preparada para revision.',
  };

  return {
    type: actionableIntent.proposalType,
    actionType: actionableIntent.actionType,
    summary: summaries[actionableIntent.proposalType],
    requiresApproval: generatedProposal.requiresApproval === true,
  };
}

function buildExecutionPayload(actionableIntent, generatedProposal) {
  if (
    !actionableIntent
    || actionableIntent.proposalType !== 'email_draft'
    || !generatedProposal
    || typeof generatedProposal !== 'object'
    || !generatedProposal.executionPayload
    || typeof generatedProposal.executionPayload !== 'object'
  ) {
    return null;
  }

  const payload = generatedProposal.executionPayload;

  return {
    to: typeof payload.to === 'string' && payload.to.trim() ? payload.to.trim() : null,
    subject: typeof payload.subject === 'string' ? payload.subject : '',
    body: typeof payload.body === 'string' ? payload.body : '',
    replyMessageId: typeof payload.replyMessageId === 'string' && payload.replyMessageId.trim()
      ? payload.replyMessageId.trim()
      : null,
    threadId: typeof payload.threadId === 'string' && payload.threadId.trim()
      ? payload.threadId.trim()
      : null,
  };
}

function emailPreparationFromQuery(query) {
  const text = typeof query === 'string' ? query.trim() : '';
  const recipient = text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const fields = text.match(/\basunto\s*:\s*(.+?)\s+y\s+cuerpo\s*:\s*(.+)$/iu);
  if (!recipient || !fields) return null;
  return {
    to: recipient[0],
    subject: fields[1].trim(),
    body: fields[2].trim(),
    replyMessageId: null,
    threadId: null,
  };
}

function emailPreparationFromPrivateContext(generatedProposal, authorizedPrivateContext) {
  const messages = authorizedPrivateContext
    && authorizedPrivateContext.sourceType === 'gmail'
    && authorizedPrivateContext.payload
    && Array.isArray(authorizedPrivateContext.payload.messages)
    ? authorizedPrivateContext.payload.messages
    : [];
  const message = messages[0];
  if (!message || typeof message !== 'object') return null;
  const addressMatch = String(message.from || '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const generated = generatedProposal && generatedProposal.executionPayload;
  const subject = typeof message.subject === 'string' && message.subject.trim()
    ? `Re: ${message.subject.trim()}` : '';
  const body = generated && typeof generated.body === 'string' ? generated.body.trim() : '';
  if (!addressMatch || !subject || !body) return null;
  return {
    to: addressMatch[0],
    subject,
    body,
    replyMessageId: typeof message.id === 'string' ? message.id : null,
    threadId: typeof message.threadId === 'string' ? message.threadId : null,
  };
}

function generateProposalSafely(
  proposalEngine,
  query,
  analysis,
  executiveResponse,
  authorizedPrivateContext,
  diagnostics,
) {
  diagnostics.proposalAttempted = false;
  diagnostics.proposalSucceeded = false;
  diagnostics.proposalType = null;
  const actionableIntent = detectActionableIntent(query);

  if (!actionableIntent || !proposalEngine || typeof proposalEngine.generate !== 'function') {
    return null;
  }

  diagnostics.proposalAttempted = true;
  diagnostics.proposalType = actionableIntent.proposalType;

  try {
    const proposalInput = buildProposalEngineInput(query, analysis, executiveResponse, actionableIntent);
    const generatedProposal = proposalEngine.generate(proposalInput);
    const publicProposal = buildSafeProposalMetadata(actionableIntent, generatedProposal);
    const executionPayload = actionableIntent.proposalType === 'email_draft'
      ? (
        emailPreparationFromQuery(query)
        || emailPreparationFromPrivateContext(generatedProposal, authorizedPrivateContext)
        || buildExecutionPayload(actionableIntent, generatedProposal)
      )
      : buildExecutionPayload(actionableIntent, generatedProposal);

    diagnostics.proposalSucceeded = Boolean(publicProposal);
    return publicProposal ? { publicProposal, executionPayload } : null;
  } catch (error) {
    diagnostics.proposalSucceeded = false;
    return null;
  }
}

function buildSafeApprovalContext(interactionId, actionableIntent, analysis, privateContextUsed) {
  return {
    interactionId,
    query: `Solicitud accionable de tipo ${actionableIntent.intent}.`,
    intent: actionableIntent.intent,
    actionType: actionableIntent.actionType,
    priority: analysis && analysis.priority ? analysis.priority : 'normal',
    privateContextUsed: Boolean(privateContextUsed),
    source: 'executive-orchestrator',
  };
}

function buildSafeApprovalMetadata(approvalItem) {
  if (
    !approvalItem
    || typeof approvalItem !== 'object'
    || (typeof approvalItem.id !== 'string' && typeof approvalItem.id !== 'number')
    || typeof approvalItem.status !== 'string'
    || typeof approvalItem.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: approvalItem.id,
    status: approvalItem.status,
    createdAt: approvalItem.createdAt,
  };
}

function enqueueApprovalSafely(
  approvalQueue,
  proposalBundle,
  query,
  analysis,
  privateContextUsed,
  interactionId,
  diagnostics,
) {
  diagnostics.approvalAttempted = false;
  diagnostics.approvalSucceeded = false;
  const actionableIntent = detectActionableIntent(query);

  if (
    !actionableIntent
    || !proposalBundle
    || !proposalBundle.publicProposal
    || proposalBundle.publicProposal.requiresApproval !== true
    || !approvalQueue
    || typeof approvalQueue.add !== 'function'
  ) {
    return null;
  }

  diagnostics.approvalAttempted = true;

  try {
    const context = buildSafeApprovalContext(
      interactionId,
      actionableIntent,
      analysis,
      privateContextUsed,
    );
    const usesPreparedDraft = actionableIntent.proposalType === 'email_draft'
      && typeof approvalQueue.addPreparedEmailDraft === 'function';
    if (usesPreparedDraft && !proposalBundle.executionPayload) return null;
    const approvalItem = usesPreparedDraft
      ? approvalQueue.addPreparedEmailDraft({
        recipient: proposalBundle.executionPayload.to,
        subject: proposalBundle.executionPayload.subject,
        body: proposalBundle.executionPayload.body,
        replyMessageId: proposalBundle.executionPayload.replyMessageId,
        threadId: proposalBundle.executionPayload.threadId,
        risk: analysis && analysis.priority === 'high' ? 'medium' : 'low',
      }, context)
      : approvalQueue.add(
        proposalBundle.publicProposal,
        context,
        proposalBundle.executionPayload,
      );
    const approval = buildSafeApprovalMetadata(approvalItem);

    diagnostics.approvalSucceeded = Boolean(approval);
    return approval;
  } catch (error) {
    diagnostics.approvalSucceeded = false;
    return null;
  }
}

function buildSafeMemoryEntry(
  interactionId,
  analysis,
  query,
  proposal,
  approval,
  privateContextUsed,
) {
  const actionableIntent = detectActionableIntent(query);

  return {
    type: 'executive-interaction',
    interactionId,
    intent: actionableIntent ? actionableIntent.intent : analysis.intent,
    priority: analysis && analysis.priority ? analysis.priority : 'normal',
    actionable: Boolean(actionableIntent),
    actionType: actionableIntent ? actionableIntent.intent : null,
    proposalCreated: Boolean(proposal),
    approvalCreated: Boolean(approval),
    privateContextUsed: Boolean(privateContextUsed),
    status: 'completed',
    createdAt: new Date().toISOString(),
  };
}

function writeMemorySafely(memory, entry, diagnostics) {
  diagnostics.memoryWriteAttempted = false;
  diagnostics.memoryWriteSucceeded = false;

  if (!memory || typeof memory.saveShortTerm !== 'function') {
    return;
  }

  diagnostics.memoryWriteAttempted = true;

  try {
    memory.saveShortTerm(entry);
    diagnostics.memoryWriteSucceeded = true;
  } catch (error) {
    diagnostics.memoryWriteSucceeded = false;
  }
}

function orchestrateExecutiveQuery(query, options) {
  const interactionId = randomUUID();
  const dependencies = options && options.dependencies ? options.dependencies : {};
  const diagnostics = options && options.diagnostics && typeof options.diagnostics === 'object'
    ? options.diagnostics
    : {};
  const memory = dependencies.memory || null;
  const proposalEngine = dependencies.proposalEngine || null;
  const approvalQueue = dependencies.approvalQueue || null;
  const analyzer = dependencies.analyzeExecutiveQuery || analyzeExecutiveQuery;
  const knowledgeSearch = dependencies.searchKnowledge || searchKnowledge;
  const simulator = dependencies.simulateExecutiveBrainQuery || simulateExecutiveBrainQuery;
  const responseBuilder = dependencies.buildExecutiveResponse || buildExecutiveResponse;
  const privateContextAdapter = dependencies.preparePrivateContextAdapter || preparePrivateContextAdapter;
  const authorizedPrivateContexts = prepareAuthorizedPrivateContexts(options, privateContextAdapter);
  const analysis = analyzer(query);
  const contextSelection = options && options.contextSelection;
  if (!contextSelection || contextSelection.memory === true) {
    searchMemorySafely(memory, query, diagnostics);
  }
  const authorizedPrivateContext = selectPrimaryPrivateContext(query, analysis, authorizedPrivateContexts);
  let knowledgeQueryResult = null;

  if (shouldUseKnowledgeQuery(analysis)) {
    knowledgeQueryResult = knowledgeSearch(analysis.project, options && options.knowledgeQueryOptions);
  }

  const response = simulator(buildSimulationQuery(query, analysis), options && options.simulationOptions);
  const combinedPrivateContextSummary = buildCombinedPrivateContextSummary(
    query,
    analysis,
    authorizedPrivateContexts,
  );
  const privateContextSummary = authorizedPrivateContext
    ? buildPrivateContextSummary(authorizedPrivateContext)
    : null;
  const contextualDataSummary = buildContextualDataSummary(options && options.contextualData);
  const contextFailureSummary = buildContextFailureSummary(options && options.contextFailures);
  const preferPrivateCalendarContext = shouldPreferPrivateCalendarContext(query, analysis, authorizedPrivateContext);
  const preferPrivateGmailContext = shouldPreferPrivateGmailContext(query, analysis, authorizedPrivateContext);
  const preferCombinedPrivateContext = Boolean(combinedPrivateContextSummary);
  const preferPrivateContext = preferCombinedPrivateContext
    || preferPrivateCalendarContext
    || preferPrivateGmailContext
    || Boolean(contextualDataSummary)
    || Boolean(contextFailureSummary);
  const responseSources = preferPrivateContext ? [] : sanitizeExecutiveSources(response.sources);
  const responseLimitations = preferCombinedPrivateContext
    ? []
    : (preferPrivateContext
    ? filterPrivatePrimaryLimitations(response.limitations)
    : response.limitations);
  const responseConfidence = preferPrivateContext
    ? Math.max(analysis.confidence, 0.7)
    : response.confidence;
  const executiveResponse = responseBuilder({
    answer: preferPrivateContext
      ? ([combinedPrivateContextSummary || privateContextSummary, contextualDataSummary, contextFailureSummary]
        .filter(Boolean).join(' '))
      : (privateContextSummary
        ? `${response.answer} ${privateContextSummary}`
        : response.answer),
    confidence: responseConfidence,
    sources: responseSources,
    reasoningSummary: response.reasoningSummary,
    limitations: responseLimitations,
  });
  const finalConfidence = preferPrivateContext
    ? executiveResponse.confidence
    : Math.min(analysis.confidence, executiveResponse.confidence);
  const proposalBundle = generateProposalSafely(
    proposalEngine,
    query,
    analysis,
    executiveResponse,
    authorizedPrivateContext,
    diagnostics,
  );
  const proposal = proposalBundle ? proposalBundle.publicProposal : null;
  const privateContextUsed = authorizedPrivateContexts.length > 0 || Boolean(contextualDataSummary);
  const approval = enqueueApprovalSafely(
    approvalQueue,
    proposalBundle,
    query,
    analysis,
    privateContextUsed,
    interactionId,
    diagnostics,
  );
  const memoryEntry = buildSafeMemoryEntry(
    interactionId,
    analysis,
    query,
    proposal,
    approval,
    privateContextUsed,
  );
  writeMemorySafely(memory, memoryEntry, diagnostics);

  return {
    interactionId,
    query,
    analysis,
    response: executiveResponse.executiveSummary,
    confidence: finalConfidence,
    sources: sanitizeExecutiveSources(executiveResponse.sources),
    privateContextUsed,
    proposal,
    approval,
    limitations: [
      ...executiveResponse.limitations,
      ...(!preferPrivateContext && knowledgeQueryResult && knowledgeQueryResult.found === false
        ? [`Knowledge Query Service did not find project ${analysis.project}.`]
        : []),
    ],
  };
}

module.exports = {
  orchestrateExecutiveQuery,
  prepareAuthorizedPrivateContexts,
  sanitizeExecutiveSources,
};
