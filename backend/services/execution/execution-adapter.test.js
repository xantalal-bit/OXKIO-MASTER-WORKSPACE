'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ACCEPTED_ACTION_TYPES,
  ExecutionAdapter,
  validateExecutionContract,
} = require('./execution-adapter');

function buildContract(overrides = {}) {
  return {
    approvalId: 'approval-1',
    interactionId: 'interaction-1',
    executionId: 'execution-1',
    actionType: 'propose_email',
    executionPayload: { marker: 'private-execution-payload' },
    ...overrides,
  };
}

test('accepts every current actionType and returns a disconnected result', async () => {
  assert.deepEqual(ACCEPTED_ACTION_TYPES, [
    'propose_email',
    'propose_meeting',
    'create_task_proposal',
  ]);

  const adapter = new ExecutionAdapter();

  for (const actionType of ACCEPTED_ACTION_TYPES) {
    const result = await adapter.execute(buildContract({ actionType }));

    assert.equal(result.success, false);
    assert.equal(result.code, 'execution_not_connected');
    assert.equal(result.provider, null);
    assert.equal(result.mode, 'NOT_CONNECTED');
    assert.equal(result.externalId, null);
    assert.equal(result.secondaryExternalId, null);
    assert.deepEqual(result.metadata, { actionType, connected: false });
  }
});

test('rejects an unknown actionType without selecting a provider', async () => {
  const result = await new ExecutionAdapter().execute(buildContract({ actionType: 'unknown_action' }));

  assert.equal(result.success, false);
  assert.equal(result.code, 'unknown_action_type');
  assert.equal(result.provider, null);
  assert.equal(result.mode, 'NOT_CONNECTED');
});

test('requires every execution contract identifier and actionType', () => {
  [
    'approvalId',
    'interactionId',
    'executionId',
    'actionType',
  ].forEach((field) => {
    const missing = buildContract();
    delete missing[field];
    const missingResult = validateExecutionContract(missing);
    const blankResult = validateExecutionContract(buildContract({ [field]: '   ' }));

    assert.equal(missingResult.valid, false);
    assert.equal(missingResult.code, 'invalid_execution_contract');
    assert.match(missingResult.message, new RegExp(field));
    assert.equal(blankResult.valid, false);
    assert.equal(blankResult.code, 'invalid_execution_contract');
  });
});

test('requires executionPayload to be a non-array object', () => {
  [undefined, null, [], 'payload', 1, true].forEach((executionPayload) => {
    const result = validateExecutionContract(buildContract({ executionPayload }));

    assert.equal(result.valid, false);
    assert.equal(result.code, 'invalid_execution_contract');
    assert.match(result.message, /executionPayload/);
  });

  assert.deepEqual(validateExecutionContract(buildContract({ executionPayload: {} })), { valid: true });
});

test('does not return or reflect executionPayload', async () => {
  const sensitiveMarker = 'sensitive-value-that-must-not-be-returned';
  const result = await new ExecutionAdapter().execute(buildContract({
    executionPayload: {
      nested: { sensitiveMarker },
      body: sensitiveMarker,
    },
  }));
  const serialized = JSON.stringify(result);

  assert.equal(Object.hasOwn(result, 'executionPayload'), false);
  assert.equal(serialized.includes('executionPayload'), false);
  assert.equal(serialized.includes(sensitiveMarker), false);
});

test('does not mutate the execution contract input', async () => {
  const input = buildContract({
    executionPayload: {
      nested: { value: 'unchanged' },
      values: ['one', 'two'],
    },
  });
  const before = JSON.parse(JSON.stringify(input));

  await new ExecutionAdapter().execute(input);

  assert.deepEqual(input, before);
});

test('independent calls do not share result state', async () => {
  const adapter = new ExecutionAdapter();
  const first = await adapter.execute(buildContract({ actionType: 'propose_email' }));
  const second = await adapter.execute(buildContract({ actionType: 'propose_meeting' }));

  assert.notEqual(first, second);
  assert.notEqual(first.metadata, second.metadata);
  first.metadata.connected = true;
  first.metadata.localOnly = 'changed';

  assert.deepEqual(second.metadata, {
    actionType: 'propose_meeting',
    connected: false,
  });
});

test('delegates propose_email only to the internally injected provider', async () => {
  const calls = [];
  const emailProvider = {
    async execute(input) {
      calls.push(input);
      return {
        success: true,
        provider: 'test-provider',
        mode: 'SAFE_DRAFT_ONLY',
        externalId: 'external-1',
        secondaryExternalId: 'secondary-1',
        metadata: { private: 'must-not-pass' },
        executionPayload: { private: 'must-not-pass' },
      };
    },
  };
  const adapter = new ExecutionAdapter({ emailProvider });
  const input = buildContract();
  const result = await adapter.execute(input);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], input);
  assert.deepEqual(result, {
    success: true,
    provider: 'test-provider',
    mode: 'SAFE_DRAFT_ONLY',
    externalId: 'external-1',
    secondaryExternalId: 'secondary-1',
    metadata: { actionType: 'propose_email' },
  });
  assert.equal(JSON.stringify(result).includes('must-not-pass'), false);
});

test('never accepts an execution provider from client input', async () => {
  let clientProviderCalls = 0;
  const input = buildContract({
    emailProvider: {
      execute() {
        clientProviderCalls += 1;
      },
    },
    provider: {
      execute() {
        clientProviderCalls += 1;
      },
    },
  });
  const result = await new ExecutionAdapter().execute(input);

  assert.equal(clientProviderCalls, 0);
  assert.equal(result.code, 'execution_not_connected');
});

test('keeps meeting and task disconnected when an email provider exists', async () => {
  let calls = 0;
  const adapter = new ExecutionAdapter({
    emailProvider: { execute: async () => { calls += 1; } },
  });

  for (const actionType of ['propose_meeting', 'create_task_proposal']) {
    const result = await adapter.execute(buildContract({ actionType }));
    assert.equal(result.code, 'execution_not_connected');
    assert.equal(result.provider, null);
  }
  assert.equal(calls, 0);
});

test('normalizes provider failures and catches thrown errors', async () => {
  const failingAdapter = new ExecutionAdapter({
    emailProvider: {
      execute: async () => ({
        success: false,
        provider: 'test-provider',
        mode: 'SAFE_DRAFT_ONLY',
        code: 'temporary_failure',
        retryable: true,
        message: 'sensitive provider message',
        executionPayload: { private: true },
      }),
    },
  });
  const thrownAdapter = new ExecutionAdapter({
    emailProvider: { execute: async () => { throw new Error('sensitive failure'); } },
  });

  const failed = await failingAdapter.execute(buildContract());
  const thrown = await thrownAdapter.execute(buildContract());

  assert.equal(failed.success, false);
  assert.equal(failed.code, 'temporary_failure');
  assert.equal(failed.retryable, true);
  assert.equal(JSON.stringify(failed).includes('sensitive provider message'), false);
  assert.equal(JSON.stringify(failed).includes('executionPayload'), false);
  assert.equal(thrown.code, 'provider_execution_failed');
  assert.equal(thrown.retryable, true);
  assert.equal(JSON.stringify(thrown).includes('sensitive failure'), false);
});

test('production adapter has no provider or execution-system imports and references', () => {
  const source = fs.readFileSync(path.join(__dirname, 'execution-adapter.js'), 'utf8');
  const forbiddenPatterns = [
    /require\s*\(/,
    /\bimport\s/,
    /gmail/i,
    /calendar/i,
    /Action\s*Executor/i,
    /ActionExecutor/,
    /Execution\s*Logger/i,
    /ExecutionLogger/,
    /Approval\s*Queue/i,
    /ApprovalQueue/,
    /oauth/i,
    /\bmcp\b/i,
  ];

  forbiddenPatterns.forEach((pattern) => {
    assert.equal(pattern.test(source), false, `Forbidden production reference: ${pattern}`);
  });
});
