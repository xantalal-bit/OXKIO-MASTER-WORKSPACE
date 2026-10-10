'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { dispatchExecutiveChat, selectExecutiveChatHandler, HANDLERS, HANDLER_HEADER } = require('./executive-chat-routing');
const { handleExecutiveChatRequest } = require('./routes/executive-chat');
const { createServerComposition } = require('../services/supervised-operation/server-composition');
const { createExecutiveAuthorizer } = require('../security/executive-authorization');

// Routing observability (10/10/2026): every /api/executive/chat answer names
// its handler, and Cliente Cero never falls silently into the classic chat
// while V3 is on. Real V3 composition and real classic handler; no network,
// no model.

const COHORT_UID = 'cliente-cero-cohort-uid';
const OTHER_ADMIN_UID = 'cliente-cero-other-admin-uid';
const FAMILY_UID = 'family-member-uid-0001';
const authorize = createExecutiveAuthorizer({
  OXKIO_ADMIN_FIREBASE_UIDS: `${COHORT_UID},${OTHER_ADMIN_UID}`,
  OXKIO_FAMILY_FIREBASE_UIDS: FAMILY_UID,
});
const identityOf = (uid) => authorize({ uid, email: `${uid}@example.test`, email_verified: true }).identity;

class FakeResponse extends EventEmitter {
  constructor() { super(); this.statusCode = 200; this.headers = {}; this.body = ''; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  getHeader(name) { return this.headers[name.toLowerCase()]; }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
    return this;
  }
  end(body = '') { this.body = String(body); this.emit('finish'); }
  json() { return this.body ? JSON.parse(this.body) : null; }
}

function request(identity, body = { query: 'hola' }) {
  const req = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
  req.oxkioIdentity = identity;
  return req;
}

function v3Composition() {
  const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-routing-'));
  const v3Chat = createServerComposition({ enabled: true, cohortUids: COHORT_UID, integrityKey: randomBytes(32), memoryRoot, authorizeIdentity: authorize });
  return { v3Chat, cleanup: () => fs.rmSync(memoryRoot, { recursive: true, force: true }) };
}

const header = (res) => res.headers[HANDLER_HEADER.toLowerCase()];
const PII = [COHORT_UID, OTHER_ADMIN_UID, FAMILY_UID, '@example.test', 'hola'];

test('selection: cohort -> V3; Cliente Cero outside the cohort with V3 on -> routing gate; family or V3 off -> legacy', () => {
  const v3Chat = { accepts: (identity) => Boolean(identity && identity.uid === COHORT_UID) };
  assert.equal(selectExecutiveChatHandler({ v3Chat, identity: identityOf(COHORT_UID) }), HANDLERS.SUPERVISED_OPERATION);
  assert.equal(selectExecutiveChatHandler({ v3Chat, identity: identityOf(OTHER_ADMIN_UID) }), HANDLERS.ROUTING_GATE);
  assert.equal(selectExecutiveChatHandler({ v3Chat, identity: identityOf(FAMILY_UID) }), HANDLERS.LEGACY);
  assert.equal(selectExecutiveChatHandler({ v3Chat: null, identity: identityOf(OTHER_ADMIN_UID) }), HANDLERS.LEGACY);
  assert.equal(selectExecutiveChatHandler({ v3Chat, identity: undefined }), HANDLERS.LEGACY);
  // Authorization is untouched: the identity is still the authorizer's own.
  assert.equal(identityOf(OTHER_ADMIN_UID).role, 'admin');
  assert.equal(identityOf(FAMILY_UID).role, 'family_member');
});

test('Cliente Cero in the cohort reaches V3; header and JSON say supervised-operation; executionEnabled=false', async () => {
  const { v3Chat, cleanup } = v3Composition();
  const logs = []; let legacyCalls = 0;
  try {
    const res = new FakeResponse();
    await dispatchExecutiveChat(request(identityOf(COHORT_UID)), res, { v3Chat, legacy: () => { legacyCalls += 1; }, log: (entry) => logs.push(entry) });
    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(header(res), 'supervised-operation');
    assert.equal(body.handler, header(res));
    assert.equal(body.executionEnabled, false);
    assert.equal(legacyCalls, 0);
    assert.deepEqual(logs.map((entry) => [entry.event, entry.handler, entry.status]), [['executive_chat_route', 'supervised-operation', 200]]);
  } finally { cleanup(); }
});

test('Cliente Cero outside the cohort with V3 on gets an explicit 403, never a silent legacy answer', async () => {
  const { v3Chat, cleanup } = v3Composition();
  const logs = []; let legacyCalls = 0;
  try {
    const res = new FakeResponse();
    await dispatchExecutiveChat(request(identityOf(OTHER_ADMIN_UID)), res, { v3Chat, legacy: () => { legacyCalls += 1; }, log: (entry) => logs.push(entry) });
    const body = res.json();
    assert.equal(legacyCalls, 0);
    assert.equal(res.statusCode, 403);
    assert.equal(header(res), 'routing-gate');
    assert.equal(body.code, 'v3_cohort_required'); assert.equal(body.error, 'v3_cohort_required');
    assert.equal(body.handler, header(res)); assert.equal(body.ok, false); assert.equal(body.executionEnabled, false);
    for (const value of PII) assert.equal(res.body.includes(value), false);
    assert.deepEqual(logs.map((entry) => [entry.handler, entry.status]), [['routing-gate', 403]]);
  } finally { cleanup(); }
});

test('an authorized legacy identity keeps the classic chat, labelled in the header', async () => {
  const { v3Chat, cleanup } = v3Composition();
  const logs = [];
  try {
    const res = new FakeResponse();
    // The real classic handler on an invalid body: its own error answer.
    await dispatchExecutiveChat(request(identityOf(FAMILY_UID), '{not json'), res, {
      v3Chat, legacy: (req, response) => handleExecutiveChatRequest(req, response, { dependencies: {} }), log: (entry) => logs.push(entry),
    });
    // The classic body contract is unchanged (no new field); the header names it.
    assert.equal(header(res), 'executive-chat-legacy');
    assert.equal(res.json().handler, undefined);
    assert.deepEqual(logs.map((entry) => entry.handler), ['executive-chat-legacy']);
    // With V3 off, Cliente Cero keeps the classic chat as before, labelled.
    const off = new FakeResponse();
    await dispatchExecutiveChat(request(identityOf(OTHER_ADMIN_UID), '{not json'), off, {
      v3Chat: null, legacy: (req, response) => handleExecutiveChatRequest(req, response, { dependencies: {} }), log: () => {},
    });
    assert.equal(header(off), 'executive-chat-legacy');
  } finally { cleanup(); }
});

test('no auth: V3 answers 401 as before (now labelled); the request never reaches the gate', async () => {
  const { v3Chat, cleanup } = v3Composition();
  try {
    const res = new FakeResponse();
    await v3Chat.handle(request({ authorized: false }), res);
    assert.equal(res.statusCode, 401); assert.equal(header(res), 'supervised-operation');
    // The Firebase middleware 401 happens before routing and is not touched.
    const auth = fs.readFileSync(path.join(__dirname, '..', 'security', 'firebase-server-auth.js'), 'utf8');
    assert.match(auth, /auth_token_required: 401/);
    assert.notEqual(selectExecutiveChatHandler({ v3Chat, identity: null }), HANDLERS.ROUTING_GATE);
  } finally { cleanup(); }
});

test('headers and logs hold no PII: fixed handler names, and log entries carry only event, handler, status, time', async () => {
  const { v3Chat, cleanup } = v3Composition();
  const logs = [];
  try {
    for (const uid of [COHORT_UID, OTHER_ADMIN_UID]) {
      const res = new FakeResponse();
      await dispatchExecutiveChat(request(identityOf(uid)), res, { v3Chat, legacy: () => {}, log: (entry) => logs.push(entry), now: () => '2026-10-10T12:00:00.000Z' });
      assert.ok(Object.values(HANDLERS).includes(header(res)));
      for (const value of PII) assert.equal(JSON.stringify(res.headers).includes(value), false);
    }
    for (const entry of logs) assert.deepEqual(Object.keys(entry).sort(), ['at', 'event', 'handler', 'status']);
    for (const value of PII) assert.equal(JSON.stringify(logs).includes(value), false);
    // A failing logger never breaks the answer.
    const res = new FakeResponse();
    await dispatchExecutiveChat(request(identityOf(COHORT_UID)), res, { v3Chat, legacy: () => {}, log: () => { throw new Error('log down'); } });
    assert.equal(res.statusCode, 200);
  } finally { cleanup(); }
});

test('server.js routes /api/executive/chat only through the observable dispatcher', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(source, /dispatchExecutiveChat\(req, res, \{ v3Chat, legacy: chat \}\)/);
  // No direct V3 shortcut left that could bypass the labelled routing.
  assert.doesNotMatch(source, /v3Chat\.accepts\(/);
  assert.doesNotMatch(source, /v3Chat\.handle\(/);
});
