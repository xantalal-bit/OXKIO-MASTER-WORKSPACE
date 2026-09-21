'use strict';

const {
  orchestrateExecutiveQuery,
  sanitizeExecutiveSources,
} = require('../../services/executive-brain/executive-orchestrator');
const { selectExecutiveContext } = require('../../services/executive-brain/context-intent-router');
const { getClienteCeroIdentity } = require('../../services/private-context/client-identity-resolver');
const { buildCalendarPrivateContext } = require('../../services/private-context/calendar-private-provider');
const { buildGmailPrivateContext } = require('../../services/private-context/gmail-private-provider');
const { getDashboardState } = require('../../services/dashboard/dashboard-intelligence');
const { recommendSupervisedOperation } = require('../../services/executive-brain/supervised-decision-engine');
const { planOperations } = require('../../services/executive-brain/operation-planner');
const { safeDiagnostic } = require('../../security/secret-runtime');
const { createConversationContextStore } = require('../../services/executive-brain/conversation-context-store');

// V0.5: process-wide, in-memory, ephemeral store — see
// conversation-context-store.js for why this is intentionally not a new
// persistent infrastructure dependency. A test can inject its own instance
// via dependencies.conversationContextStore.
const defaultConversationContextStore = createConversationContextStore();

// Distinguishes "you never connected/consented" from "you connected but the
// grant lacks a scope OXKIO needs" — both used to collapse into the same
// generic gmail_unavailable failure, which meant a user who simply never
// pressed "Conectar Google" saw the same message as an actual infrastructure
// outage. The underlying codes come from backend/integrations/googleOAuth.js
// (inspectGoogleOAuthReadiness) and gmail-private-provider.js.
const GMAIL_NOT_CONNECTED_CODES = new Set([
  'google_oauth_not_configured',
  'google_oauth_tokens_missing',
  'oauth_refresh_unavailable',
  'gmail_private_identity_required',
]);
const GMAIL_INSUFFICIENT_SCOPE_CODES = new Set([
  'gmail_compose_scope_missing',
]);

function classifyGmailContextFailure(code) {
  if (GMAIL_NOT_CONNECTED_CODES.has(code)) return 'gmail_not_connected';
  if (GMAIL_INSUFFICIENT_SCOPE_CODES.has(code)) return 'gmail_insufficient_scope';
  return 'gmail_unavailable';
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function isExecutiveChatRoute(pathname, method) {
  return pathname === '/api/executive/chat' && method === 'POST';
}

function getInternalOrchestratorDependencies(dependencies = {}) {
  const allowed = ['memory', 'proposalEngine', 'approvalQueue'];
  return allowed.reduce((result, name) => {
    if (Object.hasOwn(dependencies, name)) result[name] = dependencies[name];
    return result;
  }, {});
}

function isInternallyAuthorized(identity) {
  return Boolean(
    identity
      && typeof identity.clientId === 'string'
      && typeof identity.userId === 'string'
      && identity.clientId === identity.expectedClientId
      && identity.authorization
      && identity.authorization.status === 'granted'
      && identity.authorization.provider === 'google-oauth',
  );
}

function sanitizeGmailContext(context) {
  const payload = context && context.privatePayload;
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
  return {
    ...context,
    privatePayload: {
      source: 'gmail',
      messages: messages.map((message) => ({
        from: typeof message.from === 'string' ? message.from : '',
        subject: typeof message.subject === 'string' ? message.subject : '',
        date: typeof message.date === 'string' ? message.date : '',
        unread: message.unread === true,
        important: message.important === true,
      })),
    },
  };
}

function sanitizeCalendarContext(context) {
  const payload = context && context.privatePayload;
  const events = payload && Array.isArray(payload.events) ? payload.events : [];
  return {
    ...context,
    privatePayload: {
      source: 'calendar',
      events: events.map((event) => ({
        title: typeof event.title === 'string' ? event.title : 'Evento sin titulo',
        start: typeof event.start === 'string' ? event.start : null,
        end: typeof event.end === 'string' ? event.end : null,
        allDay: event.allDay === true,
      })),
    },
  };
}

function sanitizeDashboardContext(state) {
  const safeNumber = (value) => (Number.isFinite(value) ? value : 0);
  const executiveSummary = state && state.executiveSummary;
  const morningBriefing = state && state.morningBriefing;
  return {
    status: state && state.executiveStatus && typeof state.executiveStatus.status === 'string'
      ? state.executiveStatus.status : 'unknown',
    agenda: {
      available: Boolean(state && state.agenda && state.agenda.available !== false),
      count: safeNumber(state && state.agenda && state.agenda.count),
    },
    gmail: {
      available: Boolean(state && state.gmail && state.gmail.available !== false),
      unread: safeNumber(state && state.gmail && state.gmail.unread),
      important: safeNumber(state && state.gmail && state.gmail.important),
    },
    memory: {
      summary: state && state.memory && typeof state.memory.summary === 'string' ? state.memory.summary : null,
    },
    approvals: {
      available: Boolean(state && state.automations && state.automations.available !== false),
      pending: safeNumber(state && state.automations && state.automations.pending),
    },
    executiveSummary: typeof executiveSummary === 'string'
      ? executiveSummary
      : (executiveSummary && typeof executiveSummary.priority === 'string' ? executiveSummary.priority : null),
    morningBriefing: typeof morningBriefing === 'string'
      ? morningBriefing
      : (morningBriefing && typeof morningBriefing.summary === 'string' ? morningBriefing.summary : null),
  };
}

function sanitizeApprovalItem(item) {
  const proposal = item && (item.publicProposal || item.proposal);
  return {
    id: item && (typeof item.id === 'string' || typeof item.id === 'number') ? item.id : null,
    status: item && typeof item.status === 'string' ? item.status : 'unknown',
    createdAt: item && typeof item.createdAt === 'string' ? item.createdAt : null,
    proposal: proposal && typeof proposal === 'object' ? {
      type: typeof proposal.type === 'string' ? proposal.type : null,
      summary: typeof proposal.summary === 'string' ? proposal.summary : null,
      requiresApproval: proposal.requiresApproval === true,
    } : null,
  };
}

function sanitizeMemoryContext(memory) {
  if (!memory || typeof memory.getRecentMemory !== 'function') return [];
  const recent = memory.getRecentMemory();
  return (Array.isArray(recent) ? recent : []).slice(-5).map((entry) => {
    const data = entry && entry.data && typeof entry.data === 'object' ? entry.data : {};
    return {
      timestamp: entry && entry.timestamp ? String(entry.timestamp) : null,
      intent: typeof data.intent === 'string' ? data.intent : null,
      status: typeof data.status === 'string' ? data.status : null,
      actionable: data.actionable === true,
    };
  });
}

function calendarRangeForQuery(query) {
  const normalized = String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized.includes('esta semana') || normalized.includes('proxim')) return 'next7Days';
  if (normalized.includes('hoy')) return 'today';
  return 'next24Hours';
}

async function buildOrchestratorOptions(query, dependencies = {}, controls = {}) {
  const selectedContext = controls.selectedContext
    || (dependencies.selectExecutiveContext || selectExecutiveContext)(query);
  const selection = {
    ...selectedContext,
    ...(controls.skipGmail === true ? { gmail: false } : {}),
    ...(controls.skipCalendar === true ? { calendar: false } : {}),
  };
  const identity = (dependencies.getClienteCeroIdentity || getClienteCeroIdentity)();
  const internalDependencies = getInternalOrchestratorDependencies(dependencies);
  const conversationEntities = {};
  const options = {
    dependencies: internalDependencies,
    contextSelection: selection,
    conversationContext: controls.conversationContext || null,
    contextualData: { dashboard: null, approvals: null, memory: null },
    contextFailures: [],
  };
  const privateContexts = [];
  const requiresAuthorizedPrivateSource = selection.gmail || selection.calendar || selection.dashboard;

  if (requiresAuthorizedPrivateSource && !isInternallyAuthorized(identity)) {
    options.contextFailures.push('private_context_unauthorized');
  } else {
    if (selection.gmail) {
      try {
        const context = await (dependencies.buildGmailPrivateContext || buildGmailPrivateContext)({
          ...identity,
          maxMessages: 5,
        });
        const sanitized = sanitizeGmailContext(context);
        privateContexts.push(sanitized);
        conversationEntities.messages = (sanitized.privatePayload.messages || [])
          .map((message, index) => ({ ref: String(index + 1), ...message }));
      } catch (error) {
        // Internal-only diagnostic: never surfaced to the user, never
        // includes token values (the error codes here are a fixed enum,
        // not free-text derived from any credential).
        console.error('[gmail-intent] Gmail private context unavailable:', safeDiagnostic(error, 'gmail_unavailable'));
        options.contextFailures.push(classifyGmailContextFailure(error && error.code));
      }
    }
    if (selection.calendar) {
      try {
        const context = await (dependencies.buildCalendarPrivateContext || buildCalendarPrivateContext)({
          ...identity,
          range: calendarRangeForQuery(query),
          maxResults: 10,
        });
        const sanitized = sanitizeCalendarContext(context);
        privateContexts.push(sanitized);
        conversationEntities.events = (sanitized.privatePayload.events || [])
          .map((event, index) => ({ ref: String(index + 1), ...event }));
      } catch (error) {
        options.contextFailures.push('calendar_unavailable');
      }
    }
    if (selection.dashboard) {
      try {
        const state = await (dependencies.getDashboardState || getDashboardState)({
          approvalQueue: dependencies.approvalQueue,
          gmailReader: dependencies.dashboardGmailReader,
          calendarReader: dependencies.dashboardCalendarReader,
        });
        options.contextualData.dashboard = sanitizeDashboardContext(state);
      } catch (error) {
        options.contextFailures.push('dashboard_unavailable');
      }
    }
  }

  if (selection.approvals) {
    if (!isInternallyAuthorized(identity)) {
      options.contextFailures.push('approvals_unauthorized');
    } else {
      try {
        const queue = dependencies.approvalQueue;
        if (!queue || typeof queue.listPending !== 'function' || typeof queue.getHistory !== 'function') throw new Error('unavailable');
        // The real ApprovalQueue (backend/core/approvalQueue.js) declares
        // both methods async; awaiting them here is required in production
        // — without it, .map() runs on a Promise instead of an array and
        // this whole branch always fails closed into approvals_unavailable,
        // even though the queue itself has real pending/history data.
        const [pending, history] = await Promise.all([queue.listPending(), queue.getHistory()]);
        const sanitizedPending = pending.map(sanitizeApprovalItem);
        options.contextualData.approvals = {
          pending: sanitizedPending,
          history: history.map(sanitizeApprovalItem),
        };
        conversationEntities.approvals = sanitizedPending
          .map((approval, index) => ({ ref: String(index + 1), ...approval }));
      } catch (error) {
        options.contextFailures.push('approvals_unavailable');
      }
    }
  }

  if (selection.memory) {
    if (!isInternallyAuthorized(identity)) {
      options.contextFailures.push('memory_unauthorized');
    } else {
      try {
        options.contextualData.memory = sanitizeMemoryContext(dependencies.memory);
      } catch (error) {
        options.contextFailures.push('memory_unavailable');
      }
    }
  }

  if (privateContexts.length === 1) {
    const context = privateContexts[0];
    options.privateContextMetadata = context.privateContextMetadata;
    options.expectedClientId = context.expectedClientId;
    options.privatePayload = context.privatePayload;
    options.privateContextRequiredPurpose = 'executive-briefing';
  } else if (privateContexts.length > 1) {
    options.privateContexts = privateContexts;
    options.privateContextRequiredPurpose = 'executive-briefing';
  }
  return { options, conversationEntities };
}

function isEmailActionRequest(query) {
  const normalized = String(query || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(?:respondele|contestale)\b/.test(normalized)) return true;
  return /\b(?:prepara|preparame|preparar|redacta|redactame|redactar|crea|crear|genera|generar)\b/.test(normalized)
    && /\b(?:borrador|respuesta|correo|email|contestacion)\b/.test(normalized);
}

function buildCapabilityComposition(query, recommendation, operationPlan) {
  if (isEmailActionRequest(query)) {
    const normalized = String(query || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return {
      primaryCapability: 'prepare-email-draft',
      supportingCapabilities: /\b(?:informacion|conocimiento|documentacion|knowledge)\b/.test(normalized)
        ? ['knowledge-review-readonly'] : [],
      deferredCapabilities: [],
      rejectedCapabilities: [],
    };
  }
  const planned = operationPlan && Array.isArray(operationPlan.steps) ? operationPlan.steps : [];
  const recommended = recommendation && recommendation.decision !== 'none'
    ? recommendation.decision : null;
  const primaryCapability = planned[0] || recommended;
  if (!primaryCapability) return null;
  return {
    primaryCapability,
    supportingCapabilities: planned.slice(1),
    deferredCapabilities: [],
    rejectedCapabilities: [],
  };
}

function sanitizeExecutivePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return { ...payload, sources: sanitizeExecutiveSources(payload.sources) };
}

function sendSafeError(res, error) {
  return sendJson(res, 400, { ok: false, error: error && error.message ? error.message : 'Invalid request.' });
}

async function handleExecutiveChatRequest(req, res, options) {
  const dependencies = options && options.dependencies ? options.dependencies : {};
  const orchestrator = dependencies.orchestrateExecutiveQuery || orchestrateExecutiveQuery;
  try {
    const body = await readJsonBody(req);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return sendJson(res, 400, { ok: false, error: 'query is required.' });
    const identity = (dependencies.getClienteCeroIdentity || getClienteCeroIdentity)();
    // V0.5: conversationId is client-supplied, so it is validated for shape
    // only (never trusted as an identity) and always paired with the
    // server's own resolved uid — never used alone. If it is missing or
    // invalid, or the identity is not authorized, the chat still answers
    // normally, just without short-term conversational memory.
    const conversationStore = dependencies.conversationContextStore || defaultConversationContextStore;
    const rawConversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
    const uid = identity && typeof identity.userId === 'string' ? identity.userId : null;
    const hasUsableConversation = Boolean(
      uid && rawConversationId && conversationStore.isValidConversationId(rawConversationId),
    );
    const conversationContext = hasUsableConversation ? conversationStore.get(uid, rawConversationId) : null;
    const decisionEngine = dependencies.recommendSupervisedOperation || recommendSupervisedOperation;
    const selectedContext = (dependencies.selectExecutiveContext || selectExecutiveContext)(query);
    const emailActionRequest = isEmailActionRequest(query);
    const shouldCheckSupervisedGmail = selectedContext.gmail === true
      && !emailActionRequest;
    const shouldCheckSupervisedCalendar = selectedContext.calendar === true;
    const preliminaryRecommendation = isInternallyAuthorized(identity)
      && (shouldCheckSupervisedGmail || shouldCheckSupervisedCalendar)
      ? decisionEngine({ query, analysis: {} })
      : null;
    const isSupervisedGmailReview = preliminaryRecommendation
      && preliminaryRecommendation.decision === 'gmail-review-readonly';
    const isSupervisedCalendarReview = preliminaryRecommendation
      && preliminaryRecommendation.decision === 'calendar-review-readonly';
    const { options: orchestratorOptions, conversationEntities } = await buildOrchestratorOptions(query, dependencies, {
      // V0.1 (Gmail) / V0.3 (Calendar): a plain "revisa mi correo"/"que
      // tengo manana"-style query is read-only (never writes, never sends,
      // never creates events) and answers with only the safe summary
      // fields, so it does not need the same "requiresConfirmation" gate
      // that business/knowledge/memory operations use — it injects the
      // real Gmail/Calendar context directly and answers in the same turn,
      // instead of surfacing a pending decisionRecommendation for the user
      // to separately confirm. The recommendation itself is still computed
      // and attached below (isSupervisedGmailReview/isSupervisedCalendarReview),
      // unchanged, purely as informational metadata for any consumer that
      // wants it.
      skipGmail: false,
      skipCalendar: false,
      selectedContext,
      conversationContext,
    });
    const rawResult = await orchestrator(query, orchestratorOptions);
    const conversationUpdate = rawResult && rawResult.conversationUpdate ? rawResult.conversationUpdate : null;
    if (rawResult && typeof rawResult === 'object') delete rawResult.conversationUpdate;
    const payload = sanitizeExecutivePayload(rawResult);
    const planner = dependencies.planOperations || planOperations;
    const recommendation = emailActionRequest
      ? null
      : (isSupervisedGmailReview || isSupervisedCalendarReview
      ? preliminaryRecommendation
      : (isInternallyAuthorized(identity)
        ? decisionEngine({ query, analysis: payload && payload.analysis })
        : null));
    const operationPlan = isInternallyAuthorized(identity) && !emailActionRequest
      ? planner({ query, analysis: payload && payload.analysis })
      : null;
    if (recommendation && recommendation.decision !== 'none') {
      payload.decisionRecommendation = recommendation;
    }
    if (operationPlan && Array.isArray(operationPlan.steps) && operationPlan.steps.length > 0) {
      payload.operationPlan = operationPlan;
    }
    const capabilityComposition = buildCapabilityComposition(query, recommendation, operationPlan);
    if (capabilityComposition) payload.capabilityComposition = capabilityComposition;
    if (hasUsableConversation) {
      const previous = conversationContext || {};
      const previousEntities = previous.entities || {};
      conversationStore.save(uid, rawConversationId, {
        lastIntent: selectedContext.reason,
        entities: {
          messages: conversationEntities.messages || previousEntities.messages || [],
          events: conversationEntities.events || previousEntities.events || [],
          approvals: conversationEntities.approvals || previousEntities.approvals || [],
          documents: previousEntities.documents || [],
        },
        selection: (conversationUpdate && conversationUpdate.selection) || previous.selection || null,
        lastProposal: payload.proposal
          ? { type: payload.proposal.type || null, summary: payload.proposal.summary || null }
          : (previous.lastProposal || null),
        updatedAt: Date.now(),
      });
    }
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendSafeError(res, error);
  }
}

module.exports = {
  buildCapabilityComposition,
  buildOrchestratorOptions,
  classifyGmailContextFailure,
  getInternalOrchestratorDependencies,
  handleExecutiveChatRequest,
  isExecutiveChatRoute,
};
