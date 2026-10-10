'use strict';

// Observable routing for POST /api/executive/chat (10/10/2026). Every answer
// names the engine that produced it, and Cliente Cero never falls silently
// into the classic Executive Chat while V3 is on: a mission that the owner
// believes went to V3 must not be answered, untraced, by another engine.
// This only selects among the existing handlers; authorization and the V3
// cohort are decided exactly as before (v3Chat.accepts).

const HANDLERS = Object.freeze({
  SUPERVISED_OPERATION: 'supervised-operation',
  LEGACY: 'executive-chat-legacy',
  ROUTING_GATE: 'routing-gate',
});
const HANDLER_HEADER = 'X-OXKIO-Handler';
const ADMIN_ROLE = 'admin';

function selectExecutiveChatHandler({ v3Chat, identity } = {}) {
  if (v3Chat && typeof v3Chat.accepts === 'function' && v3Chat.accepts(identity)) return HANDLERS.SUPERVISED_OPERATION;
  // Cliente Cero (the admin identity) with V3 enabled but outside its cohort:
  // an explicit error instead of a legacy answer nobody can tell apart.
  if (v3Chat && identity && identity.authorized === true && identity.role === ADMIN_ROLE) return HANDLERS.ROUTING_GATE;
  // V3 off, or a family identity whose existing policy is the classic chat.
  return HANDLERS.LEGACY;
}

// One line per request: handler, final status and time. No uid, email,
// query text, token or cohort.
function defaultLog(entry) {
  console.log(`[OXKIO CHAT ROUTE] ${JSON.stringify(entry)}`);
}

function sendRoutingGate(res) {
  res.writeHead(403, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    [HANDLER_HEADER]: HANDLERS.ROUTING_GATE,
  });
  res.end(JSON.stringify({
    ok: false,
    code: 'v3_cohort_required',
    error: 'v3_cohort_required',
    handler: HANDLERS.ROUTING_GATE,
    message: 'Esta sesión no está en la cohorte de OXKIO V3, así que no he enviado la petición a ningún motor. Revisa la cuenta con la que has iniciado sesión.',
    executionEnabled: false,
  }));
}

function dispatchExecutiveChat(req, res, { v3Chat, legacy, log = defaultLog, now = () => new Date().toISOString() } = {}) {
  const handler = selectExecutiveChatHandler({ v3Chat, identity: req.oxkioIdentity });
  if (typeof res.once === 'function') {
    res.once('finish', () => {
      try { log({ event: 'executive_chat_route', handler, status: res.statusCode, at: now() }); } catch { /* logging never breaks a response */ }
    });
  }
  if (handler === HANDLERS.SUPERVISED_OPERATION) return v3Chat.handle(req, res);
  if (handler === HANDLERS.ROUTING_GATE) return sendRoutingGate(res);
  // writeHead merges headers set beforehand, so the classic handler keeps its
  // own responses unchanged and every one of them is labelled.
  res.setHeader(HANDLER_HEADER, HANDLERS.LEGACY);
  return legacy(req, res);
}

module.exports = {
  HANDLERS,
  HANDLER_HEADER,
  dispatchExecutiveChat,
  selectExecutiveChatHandler,
};
