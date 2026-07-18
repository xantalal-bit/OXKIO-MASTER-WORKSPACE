'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ApprovalQueue = require('../../core/approvalQueue');
const {
  handleApproveRequest,
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

function request(handler, queue, { method = 'POST', body, contentType = 'application/json' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = contentType ? { 'content-type': contentType } : {};

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

    Promise.resolve(handler(req, res, { approvalQueue: queue })).catch(reject);
    process.nextTick(() => {
      if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      req.emit('end');
    });
  });
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
    const response = await request(handleExecuteApprovedRequest, queue, {
      body: {
        approvalId: added.id,
        executionPayload: { to: 'attacker@example.com' },
        payloadHash: 'attacker-hash',
        executionEnabled: true,
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
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
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

test('approval frontends use POST approvalId only and contain no active mutable GET calls', () => {
  const files = ['app/index.html', 'app/approvals.html'];

  files.forEach((file) => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
    assert.match(html, /fetch\(["'`]\/api\/approve["'`],\s*\{[\s\S]*?method:\s*["']POST["']/);
    assert.equal(/\/api\/approve\?id=/.test(html), false);
    assert.equal(/\/api\/execute-approved\?id=/.test(html), false);
    assert.equal(/JSON\.stringify\(\{\s*approvalId:\s*id\s*\}\)/.test(html), true);
  });
});
