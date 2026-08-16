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
  const options = {
    dependencies: internalDependencies,
    contextSelection: selection,
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
        privateContexts.push(sanitizeGmailContext(context));
      } catch (error) {
        options.contextFailures.push('gmail_unavailable');
      }
    }
    if (selection.calendar) {
      try {
        const context = await (dependencies.buildCalendarPrivateContext || buildCalendarPrivateContext)({
          ...identity,
          range: calendarRangeForQuery(query),
          maxResults: 10,
        });
        privateContexts.push(sanitizeCalendarContext(context));
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
    try {
      const queue = dependencies.approvalQueue;
      if (!queue || typeof queue.listPending !== 'function' || typeof queue.getHistory !== 'function') throw new Error('unavailable');
      options.contextualData.approvals = {
        pending: queue.listPending().map(sanitizeApprovalItem),
        history: queue.getHistory().map(sanitizeApprovalItem),
      };
    } catch (error) {
      options.contextFailures.push('approvals_unavailable');
    }
  }

  if (selection.memory) {
    try {
      options.contextualData.memory = sanitizeMemoryContext(dependencies.memory);
    } catch (error) {
      options.contextFailures.push('memory_unavailable');
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
  return options;
}

function isEmailActionRequest(query) {
  const normalized = String(query || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(?:prepara|preparar|redacta|redactar|crea|crear|genera|generar)\b/.test(normalized)
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
    const orchestratorOptions = await buildOrchestratorOptions(query, dependencies, {
      skipGmail: isSupervisedGmailReview,
      skipCalendar: isSupervisedCalendarReview,
      selectedContext,
    });
    const payload = sanitizeExecutivePayload(await orchestrator(query, orchestratorOptions));
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
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendSafeError(res, error);
  }
}

module.exports = {
  buildCapabilityComposition,
  buildOrchestratorOptions,
  getInternalOrchestratorDependencies,
  handleExecutiveChatRequest,
  isExecutiveChatRoute,
};
