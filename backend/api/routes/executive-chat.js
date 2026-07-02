'use strict';

const { orchestrateExecutiveQuery } = require('../../services/executive-brain/executive-orchestrator');

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

    return sendJson(res, 200, orchestrator(query));
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: error.message || 'Invalid request.',
    });
  }
}

module.exports = {
  handleExecutiveChatRequest,
  isExecutiveChatRoute,
};
