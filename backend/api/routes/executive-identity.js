'use strict';

const { getClienteCeroIdentity } = require('../../services/private-context/client-identity-resolver');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });

  res.end(JSON.stringify(data, null, 2));
}

function isExecutiveIdentityRoute(pathname, method) {
  return pathname === '/api/executive/identity' && method === 'GET';
}

function buildExecutiveIdentityPayload(dependencies = {}) {
  const identityProvider = dependencies.getClienteCeroIdentity || getClienteCeroIdentity;

  return {
    ok: true,
    identity: identityProvider(),
  };
}

function handleExecutiveIdentityRequest(req, res, options = {}) {
  return sendJson(
    res,
    200,
    buildExecutiveIdentityPayload(options.dependencies || {})
  );
}

module.exports = {
  buildExecutiveIdentityPayload,
  handleExecutiveIdentityRequest,
  isExecutiveIdentityRoute,
};
