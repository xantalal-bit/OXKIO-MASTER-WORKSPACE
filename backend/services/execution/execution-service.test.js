'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ApprovalQueue = require('../../core/approvalQueue');
const { ExecutionAdapter } = require('./execution-adapter');
const { ExecutionService } = require('./execution-service');
const { GmailDraftProvider } = require('./providers/gmail-draft-provider');

const PRIVATE_VALUES = [
  'recipient@example.com',
  'Internal subject',
  'Internal body',
  'executionPayload',
  'payloadHash',
  'Content-Type:',
];

function withTemporaryQueue(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-execution-service-'));
  const dataFile = path.join(directory, 'approvalQueue.v2.json');

  const queue = new ApprovalQueue({ dataFile });
  return Promise.resolve()
    .then(() => run(queue, dataFile))
    .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

async function addApproval(queue, type = 'email_draft', interactionId = `interaction-${type}`) {
  const added = await queue.add({
    type,
    summary: 'Safe public proposal',
    requiresApproval: true,
  }, { interactionId }, {
    to: 'recipient@example.com',
    subject: 'Internal subject',
    body: 'Internal body',
    replyMessageId: null,
    threadId: null,
  });
  return added.id;
}

// FASE A2: corrompe el payload persistido de un item V2 directamente en
// disco, sustituyendo la antigua mutación de `queue.history.find(...)`.
function tamperExecutionPayloadOnDisk(dataFile, approvalId, patch) {
  const state = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const record = state.records.find((item) => item.id === approvalId);
  Object.assign(record.record.executionPayload, patch);
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function buildFakeGmail(behavior = 'success') {
  const calls = [];
  const drafts = new Proxy({
    async create(request) {
      calls.push(request);
      if (behavior === '429') throw { response: { status: 429 } };
      if (behavior === '401') throw { response: { status: 401 } };
      return { data: { id: 'fake-draft-id', message: { id: 'fake-message-id' } } };
    },
  }, {
    get(target, property, receiver) {
      if (property === 'send') throw new Error(`Forbidden ${['drafts', 'send'].join('.')} access`);
      return Reflect.get(target, property, receiver);
    },
  });
  const users = new Proxy({ drafts }, {
    get(target, property, receiver) {
      if (property === 'messages') throw new Error('Forbidden messages access');
      return Reflect.get(target, property, receiver);
    },
  });
  return { gmail: { users }, calls };
}

function buildSystem(queue, behavior = 'success') {
  const fake = buildFakeGmail(behavior);
  const provider = new GmailDraftProvider({
    gmail: fake.gmail,
    mode: 'SAFE_DRAFT_ONLY',
    allowRealSend: false,
  });
  const executionAdapter = new ExecutionAdapter({ emailProvider: provider });
  return {
    service: new ExecutionService({ approvalQueue: queue, executionAdapter }),
    calls: fake.calls,
  };
}

function assertSafe(value) {
  const serialized = JSON.stringify(value);
  PRIVATE_VALUES.forEach((privateValue) => assert.equal(serialized.includes(privateValue), false));
  assert.equal(serialized.includes('raw'), false);
}

test('executes one approved email through fake Gmail and persists correlated safe IDs', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addApproval(queue, 'email_draft', 'interaction-success');
    await queue.approve(id);
    const originalBegin = queue.beginExecution.bind(queue);
    let beginResult;
    queue.beginExecution = async (approvalId) => {
      beginResult = await originalBegin(approvalId);
      return beginResult;
    };
    const { service, calls } = buildSystem(queue);

    const result = await service.executeApproved(id);
    const stored = await queue.getInternalById(id);

    assert.equal(calls.length, 1);
    assert.deepEqual(result, {
      ok: true,
      approvalId: id,
      interactionId: 'interaction-success',
      executionId: beginResult.executionId,
      status: 'executed',
      result: {
        type: 'email_draft',
        provider: 'gmail',
        mode: 'SAFE_DRAFT_ONLY',
        externalId: 'fake-draft-id',
        secondaryExternalId: 'fake-message-id',
      },
    });
    assert.equal(stored.status, 'executed');
    assert.equal(stored.executionId, beginResult.executionId);
    assert.equal(stored.interactionId, result.interactionId);
    assert.equal(stored.result.externalId, result.result.externalId);
    assert.equal(stored.result.secondaryExternalId, result.result.secondaryExternalId);
    assertSafe(result);
    assertSafe((await queue.getHistory()).find((item) => item.id === id));
  });
});

test('does not report executed when Approval Queue rejects final synchronization', async () => {
  const queue = {
    getInternalById() {
      return { status: 'approved' };
    },
    beginExecution() {
      return {
        ok: true,
        approvalId: 'approval-sync',
        interactionId: 'interaction-sync',
        executionId: 'execution-sync',
        actionType: 'propose_email',
        executionPayload: {
          to: 'pilot@example.com',
          subject: 'Prueba',
          body: 'Borrador',
          replyMessageId: null,
          threadId: null,
        },
      };
    },
    completeExecution() {
      return { ok: false, code: 'execution_id_mismatch' };
    },
  };
  const service = new ExecutionService({
    approvalQueue: queue,
    executionAdapter: {
      async execute() {
        return {
          success: true,
          mode: 'SAFE_DRAFT_ONLY',
          externalId: 'draft-id',
          secondaryExternalId: 'message-id',
        };
      },
    },
  });

  const result = await service.executeApproved('approval-sync');

  assert.deepEqual(result, {
    ok: false,
    approvalId: 'approval-sync',
    interactionId: 'interaction-sync',
    executionId: 'execution-sync',
    status: 'execution_state_unsynchronized',
    error: {
      code: 'execution_id_mismatch',
      retryable: false,
    },
  });
});

for (const providerCase of [
  { behavior: '429', code: 'gmail_rate_limited', retryable: true },
  { behavior: '401', code: 'gmail_unauthorized', retryable: false },
]) {
  test(`persists safe ${providerCase.behavior} Gmail failure classification`, async () => {
    await withTemporaryQueue(async (queue) => {
      const id = await addApproval(queue);
      await queue.approve(id);
      const { service, calls } = buildSystem(queue, providerCase.behavior);

      const result = await service.executeApproved(id);
      const stored = (await queue.getHistory()).find((item) => item.id === id);

      assert.equal(calls.length, 1);
      assert.equal(result.status, 'execution_failed');
      assert.deepEqual(result.error, {
        code: providerCase.code,
        retryable: providerCase.retryable,
      });
      assert.deepEqual(stored.error, result.error);
      assert.equal(stored.status, 'execution_failed');
      assertSafe(result);
    });
  });
}

test('converts an unexpected adapter exception to a non-sensitive persisted failure', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addApproval(queue);
    await queue.approve(id);
    const executionAdapter = {
      async execute() {
        throw new Error('sensitive stack and provider message');
      },
    };
    const service = new ExecutionService({ approvalQueue: queue, executionAdapter });

    const result = await service.executeApproved(id);

    assert.deepEqual(result.error, { code: 'execution_provider_error', retryable: false });
    assert.equal((await queue.getHistory()).find((item) => item.id === id).status, 'execution_failed');
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
    assert.equal(JSON.stringify(result).includes('stack'), false);
  });
});

test('pending, rejected, and already executed approvals never invoke Gmail again', async () => {
  await withTemporaryQueue(async (queue) => {
    const pendingId = await addApproval(queue, 'email_draft', 'pending');
    const rejectedId = await addApproval(queue, 'email_draft', 'rejected');
    const executedId = await addApproval(queue, 'email_draft', 'executed');
    await queue.reject(rejectedId);
    await queue.approve(executedId);
    const { service, calls } = buildSystem(queue);
    const firstExecution = await service.executeApproved(executedId);
    assert.equal(firstExecution.ok, true);
    assert.equal(calls.length, 1);

    for (const id of [pendingId, rejectedId, executedId]) {
      const result = await service.executeApproved(id);
      assert.equal(result.ok, false);
      assert.equal(result.status, 'execution_rejected');
      assertSafe(result);
    }
    assert.equal(calls.length, 1);
  });
});

test('tampered payload and an approval without payload are rejected before Gmail', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const id = await addApproval(queue);
    await queue.approve(id);
    tamperExecutionPayloadOnDisk(dataFile, id, { body: 'tampered' });
    const { service, calls } = buildSystem(queue);
    const result = await service.executeApproved(id);

    assert.equal(result.error.code, 'execution_payload_integrity_failed');
    assert.equal(calls.length, 0);
    assertSafe(result);
  });

  // FASE A2: sustituye el fichero V1 legado por el flujo real add() sin
  // executionPayload — mismo desenlace (execution_payload_unavailable).
  await withTemporaryQueue(async (queue) => {
    const added = await queue.add({ type: 'email_draft', summary: 'Legacy', requiresApproval: true }, { interactionId: 'legacy-interaction' });
    await queue.approve(added.id);
    const { service, calls } = buildSystem(queue);
    const result = await service.executeApproved(added.id);

    assert.equal(result.error.code, 'execution_payload_unavailable');
    assert.equal(calls.length, 0);
    assertSafe(result);
  });
});

test('two sequential executeApproved calls cause at most one fake Gmail call', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addApproval(queue);
    await queue.approve(id);
    const { service, calls } = buildSystem(queue);

    const first = await service.executeApproved(id);
    const second = await service.executeApproved(id);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(calls.length, 1);
  });
});

test('one safe retry after pre-Gmail OAuth failure creates one draft and then blocks duplicates', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addApproval(queue);
    await queue.approve(id);
    let calls = 0;
    const executionAdapter = {
      async execute() {
        calls += 1;
        if (calls === 1) {
          return { success: false, code: 'oauth_unavailable', retryable: true };
        }
        return {
          success: true,
          mode: 'SAFE_DRAFT_ONLY',
          externalId: 'retry-draft-id',
          secondaryExternalId: 'retry-message-id',
        };
      },
    };
    const service = new ExecutionService({ approvalQueue: queue, executionAdapter });

    const failed = await service.executeApproved(id);
    const retried = await service.executeApproved(id);
    const duplicate = await service.executeApproved(id);
    const stored = await queue.getInternalById(id);

    assert.equal(failed.status, 'execution_failed');
    assert.deepEqual(failed.error, { code: 'oauth_unavailable', retryable: true });
    assert.equal(retried.status, 'executed');
    assert.equal(retried.result.externalId, 'retry-draft-id');
    assert.equal(duplicate.status, 'execution_rejected');
    assert.equal(calls, 2);
    assert.equal(stored.status, 'executed');
    assert.equal(stored.executionAttemptCount, 2);
    assert.equal(stored.result.externalId, 'retry-draft-id');
  });
});

test('uncertain provider failure requires review and is never retried automatically', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addApproval(queue);
    await queue.approve(id);
    let calls = 0;
    const executionAdapter = {
      async execute() {
        calls += 1;
        return { success: false, code: 'gmail_draft_failed', retryable: false };
      },
    };
    const service = new ExecutionService({ approvalQueue: queue, executionAdapter });

    const failed = await service.executeApproved(id);
    const blocked = await service.executeApproved(id);

    assert.equal(failed.status, 'execution_failed');
    assert.deepEqual(failed.error, { code: 'gmail_draft_failed', retryable: false });
    assert.equal(blocked.status, 'execution_rejected');
    assert.equal(blocked.error.code, 'execution_not_retryable');
    assert.equal(calls, 1);
    assert.equal((await queue.getInternalById(id)).status, 'execution_failed');
    assert.equal((await queue.getInternalById(id)).result, null);
  });
});

test('meeting and task become disconnected failures without touching fake Gmail', async () => {
  for (const type of ['meeting_proposal', 'task_proposal']) {
    await withTemporaryQueue(async (queue) => {
      const id = await addApproval(queue, type);
      await queue.approve(id);
      const { service, calls } = buildSystem(queue);

      const result = await service.executeApproved(id);

      assert.equal(result.status, 'execution_failed');
      assert.deepEqual(result.error, { code: 'execution_not_connected', retryable: false });
      assert.equal((await queue.getHistory()).find((item) => item.id === id).status, 'execution_failed');
      assert.equal(calls.length, 0);
      assertSafe(result);
    });
  }
});

test('invalid approvalId is rejected without calling queue or adapter', async () => {
  let queueCalls = 0;
  let adapterCalls = 0;
  const service = new ExecutionService({
    approvalQueue: { beginExecution() { queueCalls += 1; } },
    executionAdapter: { async execute() { adapterCalls += 1; } },
  });

  for (const approvalId of [undefined, null, '', '   ', 123, {}, []]) {
    const result = await service.executeApproved(approvalId);
    assert.equal(result.error.code, 'invalid_approval_id');
    assertSafe(result);
  }
  assert.equal(queueCalls, 0);
  assert.equal(adapterCalls, 0);
});

test('executeApproved accepts only approvalId and constructs adapter input from beginExecution', async () => {
  let adapterInput;
  const beginResult = {
    ok: true,
    approvalId: 'internal-approval',
    interactionId: 'internal-interaction',
    executionId: 'internal-execution',
    actionType: 'propose_meeting',
    executionPayload: { internal: true },
    payloadHash: 'internal-hash',
  };
  const approvalQueue = {
    beginExecution: () => beginResult,
    failExecution() {},
  };
  const executionAdapter = {
    async execute(input) {
      adapterInput = input;
      return { success: false, code: 'execution_not_connected' };
    },
  };
  const service = new ExecutionService({ approvalQueue, executionAdapter });

  await service.executeApproved('client-approval', {
    actionType: 'propose_email',
    executionPayload: { attacker: true },
  });

  assert.deepEqual(adapterInput, {
    approvalId: 'internal-approval',
    interactionId: 'internal-interaction',
    executionId: 'internal-execution',
    actionType: 'propose_meeting',
    executionPayload: { internal: true },
  });
  assert.equal(Object.hasOwn(adapterInput, 'payloadHash'), false);
  assert.equal(ExecutionService.prototype.executeApproved.length, 1);
});

test('production service and fake Gmail test contain no prohibited execution integrations', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, 'execution-service.js'), 'utf8');
  const combinedSource = `${serviceSource}\n${fs.readFileSync(__filename, 'utf8')}`;
  const forbidden = [
    new RegExp(['drafts', 'send'].join('\\.')),
    new RegExp(['messages', 'send'].join('\\.')),
    /ActionExecutor/,
    /ExecutionLogger/,
    /oauth/i,
  ];

  forbidden.forEach((pattern) => assert.equal(pattern.test(serviceSource), false));
  assert.equal(combinedSource.includes(['google', 'apis'].join('')), false);
});
