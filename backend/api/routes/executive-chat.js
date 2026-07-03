'use strict';

const {
  orchestrateExecutiveQuery,
  sanitizeExecutiveSources,
} = require('../../services/executive-brain/executive-orchestrator');
const { buildCalendarPrivateContext } = require('../../services/private-context/calendar-private-provider');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });

  res.end(JSON.stringify(data, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function isExecutiveChatRoute(pathname, method) {
  return pathname === '/api/executive/chat' && method === 'POST';
}

async function buildOrchestratorOptions(body, dependencies = {}) {
  const calendarProvider = dependencies.buildCalendarPrivateContext || buildCalendarPrivateContext;
  const options = {};

  if (body.calendar && body.calendar.enabled === true) {
    const calendarContext = await calendarProvider(body.calendar);

    return {
      ...options,
      privateContextMetadata: calendarContext.privateContextMetadata,
      expectedClientId: calendarContext.expectedClientId,
      privatePayload: calendarContext.privatePayload,
      privateContextRequiredPurpose: 'executive-briefing',
    };
  }

  if (Object.hasOwn(body, 'privateContextMetadata')) {
    options.privateContextMetadata = body.privateContextMetadata;
  }

  if (Object.hasOwn(body, 'expectedClientId')) {
    options.expectedClientId = body.expectedClientId;
  }

  if (Object.hasOwn(body, 'privatePayload')) {
    options.privatePayload = body.privatePayload;
  }

  return options;
}

function sanitizeExecutivePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  return {
    ...payload,
    sources: sanitizeExecutiveSources(payload.sources),
  };
}

async function handleExecutiveChatRequest(req, res, options) {
  const dependencies = options && options.dependencies ? options.dependencies : {};
  const orchestrator = dependencies.orchestrateExecutiveQuery || orchestrateExecutiveQuery;

  try {
    const body = await readJsonBody(req);
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return sendJson(res, 400, {
        ok: false,
        error: 'query is required.',
      });
    }

    const orchestratorOptions = await buildOrchestratorOptions(body, dependencies);

    return sendJson(res, 200, sanitizeExecutivePayload(orchestrator(query, orchestratorOptions)));
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: error.message || 'Invalid request.',
    });
  }
}

module.exports = {
  buildOrchestratorOptions,
  handleExecutiveChatRequest,
  isExecutiveChatRoute,
};
