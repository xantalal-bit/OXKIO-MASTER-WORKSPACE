'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ApprovalQueue = require('../../core/approvalQueue');
const { ExecutionAdapter } = require('../../services/execution/execution-adapter');
const { ExecutionService } = require('../../services/execution/execution-service');
const { GmailDraftProvider } = require('../../services/execution/providers/gmail-draft-provider');
const { getClienteCeroIdentity } = require('../../services/private-context/client-identity-resolver');
const { createExecutiveCsrf } = require('../../security/executive-csrf');
const {
  handleApproveRequest,
  handleExecutiveSecurityContextRequest,
  handleExecuteApprovedRequest,
} = require('./executive-approval');

async function withTemporaryQueue(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-approval-api-'));
  const dataFile = path.join(directory, 'approvalQueue.json');

  try {
    return await run(new ApprovalQueue({ dataFile }), dataFile);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function addEmailApproval(queue, interactionId = 'interaction-api') {
  return queue.add({
    type: 'email_draft',
    summary: 'Borrador preparado',
    requiresApproval: true,
  }, { interactionId }, {
    to: null,
    subject: 'Asunto interno',
    body: 'Cuerpo interno',
    replyMessageId: null,
    threadId: null,
  });
}

function addExecutableEmailApproval(queue, interactionId = 'interaction-api-execution') {
  return queue.add({
    type: 'email_draft',
    summary: 'Borrador ejecutable',
    requiresApproval: true,
  }, { interactionId }, {
    to: 'recipient@example.com',
    subject: 'Asunto interno',
    body: 'Cuerpo interno',
    replyMessageId: null,
    threadId: null,
  });
}

function request(handler, queue, {
  method = 'POST',
  body,
  contentType = 'application/json',
  dependencies = {},
  csrfHeader,
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  const csrf = dependencies.csrf || createExecutiveCsrf();
  const effectiveCsrfHeader = csrfHeader === undefined
    ? csrf.getSecurityContext().csrfToken
    : csrfHeader;
  req.headers = contentType ? { 'content-type': contentType } : {};
  if (effectiveCsrfHeader !== null) req.headers['x-oxkio-csrf'] = effectiveCsrfHeader;
  const effectiveDependencies = {
    getIdentity: getClienteCeroIdentity,
    csrf,
    ...dependencies,
  };

  return new Promise((resolve, reject) => {
    const response = { statusCode: null, headers: null, body: '' };
    const res = {
      writeHead(statusCode, headers) {
        response.statusCode = statusCode;
        response.headers = headers;
      },
      end(payload = '') {
        response.body = payload;
        try {
          response.json = payload ? JSON.parse(payload) : null;
          resolve(response);
        } catch (error) {
          reject(error);
        }
      },
    };

    Promise.resolve(handler(req, res, { approvalQueue: queue, ...effectiveDependencies })).catch(reject);
    process.nextTick(() => {
      if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      req.emit('end');
    });
  });
}

test('GET security context returns only an authorized expiring token with no-store', async () => {
  await withTemporaryQueue(async (queue) => {
    const firstCsrf = createExecutiveCsrf();
    const secondCsrf = createExecutiveCsrf();
    const response = await request(handleExecutiveSecurityContextRequest, queue, {
      method: 'GET',
      contentType: null,
      dependencies: { csrf: firstCsrf },
      csrfHeader: null,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(response.json).sort(), ['authorized', 'csrfToken', 'expiresAt']);
    assert.equal(response.json.authorized, true);
    assert.match(response.json.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Date.parse(response.json.expiresAt) > Date.now(), true);
    assert.notEqual(response.json.csrfToken, secondCsrf.getSecurityContext().csrfToken);
    const serialized = JSON.stringify(response.json);
    ['clientId', 'authorization', 'token_type', 'client_secret', 'userId'].forEach((value) => {
      assert.equal(serialized.includes(value), false);
    });
  });
});

test('security context denies missing or unauthorized internal identity', async () => {
  await withTemporaryQueue(async (queue) => {
    for (const getIdentity of [
      () => null,
      () => ({
        clientId: 'cliente-cero',
        expectedClientId: 'cliente-cero',
        authorization: { status: 'denied' },
      }),
      () => ({
        clientId: 'other-client',
        expectedClientId: 'other-client',
        authorization: { status: 'granted' },
      }),
    ]) {
      const response = await request(handleExecutiveSecurityContextRequest, queue, {
        method: 'GET',
        contentType: null,
        dependencies: { getIdentity },
        csrfHeader: null,
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json.code, 'executive_authorization_denied');
    }
  });
});

test('mutable routes fail closed on identity and CSRF before queue access', async () => {
  let queueCalls = 0;
  const queue = {
    approve() { queueCalls += 1; },
    validateForExecution() { queueCalls += 1; },
  };
  const csrf = createExecutiveCsrf();
  const validToken = csrf.getSecurityContext().csrfToken;
  const deniedIdentity = () => ({
    clientId: 'cliente-cero',
    expectedClientId: 'cliente-cero',
    authorization: { status: 'denied' },
  });

  for (const handler of [handleApproveRequest, handleExecuteApprovedRequest]) {
    const denied = await request(handler, queue, {
      body: {
        approvalId: 'approval-1',
        clientId: 'cliente-cero',
        authorization: 'granted',
        csrfToken: validToken,
      },
      dependencies: { csrf, getIdentity: deniedIdentity },
      csrfHeader: validToken,
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json.code, 'executive_authorization_denied');

    const missing = await request(handler, queue, {
      body: { approvalId: 'approval-1', csrfToken: validToken },
      dependencies: { csrf },
      csrfHeader: null,
    });
    assert.equal(missing.statusCode, 403);
    assert.equal(missing.json.code, 'csrf_token_required');

    const invalid = await request(handler, queue, {
      body: { approvalId: 'approval-1' },
      dependencies: { csrf },
      csrfHeader: 'invalid-token',
    });
    assert.equal(invalid.statusCode, 403);
    assert.equal(invalid.json.code, 'csrf_token_invalid');
  }
  assert.equal(queueCalls, 0);
});

test('expired CSRF is rejected without changing approval state', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const added = addEmailApproval(queue);
    const before = fs.readFileSync(dataFile, 'utf8');
    let clock = 1_000;
    const csrf = createExecutiveCsrf({ now: () => clock, ttlMs: 10 });
    const token = csrf.getSecurityContext().csrfToken;
    clock += 10;

    const response = await request(handleApproveRequest, queue, {
      body: { approvalId: added.id },
      dependencies: { csrf },
      csrfHeader: token,
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json.code, 'csrf_token_expired');
    assert.equal(queue.getInternalById(added.id).status, 'pending');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  });
});

function buildFakeExecution(queue, behavior = 'success') {
  const calls = [];
  const gmail = {
    users: {
      drafts: {
        async create(input) {
          calls.push(input);
          if (behavior === '429') throw { response: { status: 429 } };
          if (behavior === '401') throw { response: { status: 401 } };
          if (behavior === '403') throw { response: { status: 403 } };
          return { data: { id: 'api-fake-draft', message: { id: 'api-fake-message' } } };
        },
      },
    },
  };
  const provider = new GmailDraftProvider({
    gmail,
    mode: 'SAFE_DRAFT_ONLY',
    allowRealSend: false,
  });
  const executionAdapter = new ExecutionAdapter({ emailProvider: provider });
  return {
    calls,
    dependencies: {
      executionService: new ExecutionService({ approvalQueue: queue, executionAdapter }),
      config: { executionEnabled: true },
    },
  };
}

function assertSafeExecutionResponse(response) {
  const serialized = JSON.stringify(response.json);
  [
    'executionPayload',
    'payloadHash',
    'Asunto interno',
    'Cuerpo interno',
    'attacker@example.com',
    'private-token',
    'stack',
    'Content-Type:',
  ].forEach((value) => assert.equal(serialized.includes(value), false));
}

test('POST /api/approve approves pending item and ignores client-controlled fields', async () => {
  await withTemporaryQueue(async (queue) => {
    const added = addEmailApproval(queue, 'server-interaction');
    const response = await request(handleApproveRequest, queue, {
      body: {
        approvalId: added.id,
        proposal: { type: 'attacker' },
        executionPayload: { to: 'attacker@example.com' },
        payloadHash: 'attacker-hash',
        status: 'executed',
        interactionId: 'attacker-interaction',
        context: { attacker: true },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.json.result.item.status, 'approved');
    assert.equal(response.json.result.item.interactionId, 'server-interaction');
    assert.equal(Object.hasOwn(response.json.result.item, 'executionPayload'), false);
    assert.equal(Object.hasOwn(response.json.result.item, 'payloadHash'), false);
    const internal = queue.getInternalById(added.id);
    assert.equal(internal.executionPayload.to, null);
    assert.notEqual(internal.payloadHash, 'attacker-hash');
    assert.equal(internal.approvedBy.clientId, 'cliente-cero');
  });
});

test('POST /api/approve rejects only when the closed decision requests rejection', async () => {
  await withTemporaryQueue(async (queue) => {
    const added = addEmailApproval(queue, 'interaction-reject');
    const response = await request(handleApproveRequest, queue, {
      body: { approvalId: added.id, decision: 'reject' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.result.action, 'rejected');
    assert.equal(queue.getInternalById(added.id).status, 'rejected');
  });
});

test('POST /api/approve validates body, content type, existence, and state', async () => {
  await withTemporaryQueue(async (queue) => {
    const added = addEmailApproval(queue);

    assert.equal((await request(handleApproveRequest, queue, { body: {} })).statusCode, 400);
    assert.equal((await request(handleApproveRequest, queue, { body: { approvalId: '   ' } })).statusCode, 400);
    assert.equal((await request(handleApproveRequest, queue, {
      body: { approvalId: added.id },
      contentType: 'text/plain',
    })).statusCode, 400);
    assert.equal((await request(handleApproveRequest, queue, {
      body: { approvalId: 'missing' },
    })).statusCode, 404);

    assert.equal((await request(handleApproveRequest, queue, {
      body: { approvalId: added.id },
    })).statusCode, 200);
    const conflict = await request(handleApproveRequest, queue, {
      body: { approvalId: added.id },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json.code, 'invalid_transition');
  });
});

test('legacy GET approval route returns 405 and does not change state', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const added = addEmailApproval(queue);
    const before = fs.readFileSync(dataFile, 'utf8');
    const response = await request(handleApproveRequest, queue, { method: 'GET', contentType: null });

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'POST');
    assert.equal(response.json.code, 'method_not_allowed');
    assert.equal(queue.getInternalById(added.id).status, 'pending');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  });
});

test('POST /api/execute-approved validates but remains disabled without state change', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const added = addEmailApproval(queue, 'interaction-disabled');
    queue.approve(added.id);
    const before = fs.readFileSync(dataFile, 'utf8');
    let serviceCalls = 0;
    const response = await request(handleExecuteApprovedRequest, queue, {
      body: {
        approvalId: added.id,
        executionPayload: { to: 'attacker@example.com' },
        payloadHash: 'attacker-hash',
        executionEnabled: true,
      },
      dependencies: {
        executionService: { executeApproved() { serviceCalls += 1; } },
        config: { executionEnabled: false },
      },
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json, {
      ok: false,
      code: 'execution_disabled',
      message: 'Execution is not enabled.',
    });
    assert.equal(queue.getInternalById(added.id).status, 'approved');
    assert.equal(Object.hasOwn(queue.getInternalById(added.id), 'executionId'), false);
    assert.equal(serviceCalls, 0);
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  });
});

test('internally enabled POST executes approved email once with correlated safe response', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const added = addExecutableEmailApproval(queue, 'interaction-api-enabled');
    queue.approve(added.id);
    const fake = buildFakeExecution(queue);
    const response = await request(handleExecuteApprovedRequest, queue, {
      body: {
        approvalId: added.id,
        executionEnabled: false,
        executionPayload: { to: 'attacker@example.com' },
        payloadHash: 'attacker-hash',
        actionType: 'create_task_proposal',
        provider: 'attacker-provider',
        interactionId: 'attacker-interaction',
        executionId: 'attacker-execution',
        status: 'executed',
      },
      dependencies: fake.dependencies,
    });
    const stored = JSON.parse(fs.readFileSync(dataFile, 'utf8')).history.find((item) => item.id === added.id);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(fake.calls.length, 1);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.approvalId, added.id);
    assert.equal(response.json.interactionId, 'interaction-api-enabled');
    assert.equal(response.json.executionId, stored.executionId);
    assert.equal(response.json.result.externalId, 'api-fake-draft');
    assert.equal(response.json.result.secondaryExternalId, 'api-fake-message');
    assert.equal(stored.status, 'executed');
    assert.equal(stored.executionPayload.to, 'recipient@example.com');
    assert.notEqual(stored.payloadHash, 'attacker-hash');
    assertSafeExecutionResponse(response);
  });
});

for (const failureCase of [
  { behavior: '429', statusCode: 503, code: 'gmail_rate_limited', retryable: true },
  { behavior: '401', statusCode: 502, code: 'gmail_unauthorized', retryable: false },
  { behavior: '403', statusCode: 502, code: 'gmail_unauthorized', retryable: false },
]) {
  test(`maps fake Gmail ${failureCase.behavior} to safe HTTP failure`, async () => {
    await withTemporaryQueue(async (queue) => {
      const added = addExecutableEmailApproval(queue);
      queue.approve(added.id);
      const fake = buildFakeExecution(queue, failureCase.behavior);
      const response = await request(handleExecuteApprovedRequest, queue, {
        body: { approvalId: added.id },
        dependencies: fake.dependencies,
      });

      assert.equal(response.statusCode, failureCase.statusCode);
      assert.equal(fake.calls.length, 1);
      assert.equal(response.json.status, 'execution_failed');
      assert.deepEqual(response.json.error, {
        code: failureCase.code,
        retryable: failureCase.retryable,
      });
      assert.equal(queue.getInternalById(added.id).status, 'execution_failed');
      assertSafeExecutionResponse(response);
    });
  });
}

test('invalid execution states and tampered payload never call fake Gmail', async () => {
  await withTemporaryQueue(async (queue) => {
    const pending = addEmailApproval(queue, 'pending');
    const rejected = addEmailApproval(queue, 'rejected');
    const executing = addEmailApproval(queue, 'executing');
    const executed = addEmailApproval(queue, 'executed');
    const tampered = addEmailApproval(queue, 'tampered');
    queue.reject(rejected.id);
    queue.approve(executing.id);
    queue.beginExecution(executing.id);
    queue.approve(executed.id);
    const begun = queue.beginExecution(executed.id);
    queue.completeExecution(executed.id, {
      executionId: begun.executionId,
      result: { type: 'email_draft', mode: 'SAFE_DRAFT_ONLY' },
    });
    queue.approve(tampered.id);
    queue.history.find((item) => item.id === tampered.id).executionPayload.body = 'tampered';
    const fake = buildFakeExecution(queue);

    for (const id of [pending.id, rejected.id, executing.id, executed.id, tampered.id, 'missing']) {
      const response = await request(handleExecuteApprovedRequest, queue, {
        body: { approvalId: id },
        dependencies: fake.dependencies,
      });
      assert.equal([404, 409].includes(response.statusCode), true);
      assertSafeExecutionResponse(response);
    }
    assert.equal(fake.calls.length, 0);
  });

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-api-old-record-'));
  const dataFile = path.join(directory, 'approvalQueue.json');
  fs.writeFileSync(dataFile, JSON.stringify({
    pending: [],
    history: [{
      id: 'old-approved',
      status: 'approved',
      proposal: { type: 'email_draft' },
      context: {},
    }],
  }));
  try {
    const queue = new ApprovalQueue({ dataFile });
    const fake = buildFakeExecution(queue);
    const response = await request(handleExecuteApprovedRequest, queue, {
      body: { approvalId: 'old-approved' },
      dependencies: fake.dependencies,
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json.error.code, 'execution_payload_unavailable');
    assert.equal(fake.calls.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('two enabled POST calls invoke fake Gmail at most once', async () => {
  await withTemporaryQueue(async (queue) => {
    const added = addExecutableEmailApproval(queue);
    queue.approve(added.id);
    const fake = buildFakeExecution(queue);
    const options = { body: { approvalId: added.id }, dependencies: fake.dependencies };

    const first = await request(handleExecuteApprovedRequest, queue, options);
    const second = await request(handleExecuteApprovedRequest, queue, options);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409);
    assert.equal(fake.calls.length, 1);
    assertSafeExecutionResponse(second);
  });
});

test('execute route validates method, JSON, and approvalId before dependencies', async () => {
  await withTemporaryQueue(async (queue) => {
    const invalidId = await request(handleExecuteApprovedRequest, queue, { body: {} });
    const invalidJson = await request(handleExecuteApprovedRequest, queue, { body: '{' });
    const invalidType = await request(handleExecuteApprovedRequest, queue, {
      body: { approvalId: 'id' },
      contentType: 'text/plain',
    });
    const get = await request(handleExecuteApprovedRequest, queue, {
      method: 'GET',
      contentType: null,
    });

    assert.equal(invalidId.statusCode, 400);
    assert.equal(invalidJson.statusCode, 400);
    assert.equal(invalidType.statusCode, 400);
    assert.equal(get.statusCode, 405);
    assert.equal(get.headers.Allow, 'POST');
    assert.equal(get.headers['Cache-Control'], 'no-store');
  });
});

test('execution validation rejects invalid state and unavailable legacy payload safely', async () => {
  await withTemporaryQueue(async (queue) => {
    const pending = addEmailApproval(queue);
    const pendingResponse = await request(handleExecuteApprovedRequest, queue, {
      body: { approvalId: pending.id },
    });
    assert.equal(pendingResponse.statusCode, 409);
    assert.equal(pendingResponse.json.code, 'invalid_transition');
  });

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-approval-api-legacy-'));
  const dataFile = path.join(directory, 'approvalQueue.json');
  fs.writeFileSync(dataFile, JSON.stringify({
    pending: [],
    history: [{
      id: 'legacy-approved',
      status: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      proposal: { type: 'email_draft', summary: 'Legacy', requiresApproval: true },
      context: {},
    }],
  }));
  try {
    const queue = new ApprovalQueue({ dataFile });
    const response = await request(handleExecuteApprovedRequest, queue, {
      body: { approvalId: 'legacy-approved' },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json.code, 'execution_payload_unavailable');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy GET execution route returns 405 and never changes approval state', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const added = addEmailApproval(queue);
    queue.approve(added.id);
    const before = fs.readFileSync(dataFile, 'utf8');
    const response = await request(handleExecuteApprovedRequest, queue, { method: 'GET', contentType: null });

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'POST');
    assert.equal(queue.getInternalById(added.id).status, 'approved');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  });
});

test('public pending and history views never expose executable fields', async () => {
  await withTemporaryQueue(async (queue) => {
    const added = addEmailApproval(queue);
    const pendingJson = JSON.stringify(queue.listPending());
    queue.approve(added.id);
    const historyJson = JSON.stringify(queue.getHistory());

    ['executionPayload', 'payloadHash', 'Asunto interno', 'Cuerpo interno'].forEach((value) => {
      assert.equal(pendingJson.includes(value), false);
      assert.equal(historyJson.includes(value), false);
    });
  });
});

test('approval frontends keep CSRF in memory and send only approvalId in mutable bodies', () => {
  const files = ['app/index.html', 'app/approvals.html'];

  files.forEach((file) => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
    assert.match(html, /(?:window\.oxkioAuthenticatedFetch|authenticatedFetch)\(["'`]\/api\/executive\/security-context["'`]/);
    assert.match(html, /["']X-OXKIO-CSRF["']:\s*executiveCsrfToken/);
    assert.match(html, /executivePost\(["'`]\/api\/approve["'`],\s*id\)/);
    assert.match(html, /executivePost\(["'`]\/api\/execute-approved["'`],\s*id\)/);
    assert.equal(/\/api\/approve\?id=/.test(html), false);
    assert.equal(/\/api\/execute-approved\?id=/.test(html), false);
    assert.match(html, /body:\s*JSON\.stringify\(\{\s*approvalId\s*\}\)/);
    assert.equal(/body:\s*JSON\.stringify\(\{[^}]*csrfToken/.test(html), false);
    assert.equal(/localStorage|sessionStorage/.test(html), false);
    assert.match(html, /data\.code\s*===\s*["']csrf_token_expired["']/);
  });
});
