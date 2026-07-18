'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ApprovalQueue = require('./approvalQueue');
const { calculatePayloadHash, normalizeExecutionPayload } = ApprovalQueue;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function withTemporaryQueue(run, initialData = null) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-approval-queue-'));
  const dataFile = path.join(directory, 'approvalQueue.json');

  if (initialData) {
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2));
  }

  try {
    return run(new ApprovalQueue({ dataFile }), dataFile);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function addEmailApproval(queue, interactionId = 'interaction-execution') {
  const added = queue.add({
    type: 'email_draft',
    summary: 'Borrador preparado',
    requiresApproval: true,
  }, { interactionId }, {
    to: null,
    subject: 'Asunto aprobado',
    body: 'Cuerpo aprobado',
    replyMessageId: null,
    threadId: null,
  });

  return added.id;
}

test('stores email execution payload internally and exposes only public proposal metadata', () => {
  withTemporaryQueue((queue, dataFile) => {
    const publicProposal = {
      type: 'email_draft',
      summary: 'Borrador preparado',
      requiresApproval: true,
    };
    const executionPayload = {
      to: null,
      subject: 'Respuesta pendiente',
      body: 'Contenido del borrador',
      replyMessageId: null,
      threadId: null,
    };
    const context = { interactionId: 'interaction-1', source: 'executive-orchestrator' };

    const added = queue.add(publicProposal, context, executionPayload);
    const [internalItem] = queue.listPendingInternal();
    const [publicItem] = queue.listPending();
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8')).pending[0];

    assert.equal(added.interactionId, 'interaction-1');
    assert.deepEqual(internalItem.executionPayload, normalizeExecutionPayload(executionPayload));
    assert.equal(internalItem.payloadHash, calculatePayloadHash(executionPayload));
    assert.deepEqual(persisted.executionPayload, normalizeExecutionPayload(executionPayload));
    assert.equal(persisted.payloadHash, calculatePayloadHash(executionPayload));
    assert.deepEqual(publicItem.publicProposal, publicProposal);
    assert.deepEqual(publicItem.proposal, publicProposal);
    assert.equal(Object.hasOwn(publicItem, 'executionPayload'), false);
    assert.equal(Object.hasOwn(publicItem, 'payloadHash'), false);
    assert.equal(JSON.stringify(added).includes('Contenido del borrador'), false);
  });
});

test('normalizes missing recipient to null and calculates stable payload hashes', () => {
  const base = {
    subject: 'Asunto',
    body: 'Cuerpo',
    replyMessageId: null,
    threadId: null,
  };
  const normalized = normalizeExecutionPayload({ ...base });

  assert.equal(normalized.to, null);
  assert.equal(calculatePayloadHash(base), calculatePayloadHash({ ...base, to: null }));
  assert.notEqual(calculatePayloadHash({ ...base, to: null }), calculatePayloadHash({ ...base, to: 'a@example.com' }));
  assert.notEqual(calculatePayloadHash({ ...base, to: null }), calculatePayloadHash({ ...base, subject: 'Otro' }));
  assert.notEqual(calculatePayloadHash({ ...base, to: null }), calculatePayloadHash({ ...base, body: 'Otro cuerpo' }));
});

test('does not accept execution payload or payload hash embedded in public proposal', () => {
  withTemporaryQueue((queue) => {
    queue.add({
      type: 'email_draft',
      summary: 'Visible',
      requiresApproval: true,
      executionPayload: { to: 'attacker@example.com', subject: 'Injected', body: 'Injected' },
      payloadHash: 'client-controlled',
    }, { interactionId: 'interaction-2' });

    const [internalItem] = queue.listPendingInternal();
    const [publicItem] = queue.listPending();

    assert.equal(internalItem.executionPayload, null);
    assert.equal(internalItem.payloadHash, null);
    assert.equal(Object.hasOwn(publicItem.publicProposal, 'executionPayload'), false);
    assert.equal(Object.hasOwn(publicItem.publicProposal, 'payloadHash'), false);
  });
});

test('reads, lists, approves, and reads history for legacy records without rewriting them', () => {
  const legacyData = {
    pending: [{
      id: 'legacy-1',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      proposal: {
        type: 'email_draft',
        summary: 'Legacy',
        requiresApproval: true,
        to: 'legacy@example.com',
        subject: 'Legacy subject',
        body: 'Legacy body',
      },
      context: { interactionId: 'legacy-interaction' },
    }],
    history: [{
      id: 'legacy-history',
      status: 'approved',
      createdAt: '2025-12-01T00:00:00.000Z',
      resolvedAt: '2025-12-01T00:01:00.000Z',
      proposal: { type: 'email_draft', summary: 'Legacy history', requiresApproval: true },
      context: {},
    }],
  };

  withTemporaryQueue((queue, dataFile) => {
    const beforeRead = fs.readFileSync(dataFile, 'utf8');
    const [pending] = queue.listPending();
    const initialHistory = queue.getHistory();

    assert.equal(fs.readFileSync(dataFile, 'utf8'), beforeRead);
    assert.equal(pending.interactionId, 'legacy-interaction');
    assert.equal(pending.publicProposal.summary, 'Legacy');
    assert.equal(Object.hasOwn(pending.publicProposal, 'to'), false);
    assert.equal(Object.hasOwn(pending.publicProposal, 'subject'), false);
    assert.equal(Object.hasOwn(pending.publicProposal, 'body'), false);
    assert.equal(Object.hasOwn(pending, 'executionPayload'), false);
    assert.equal(queue.listPendingInternal()[0].proposal.body, 'Legacy body');
    assert.equal(initialHistory[0].publicProposal.summary, 'Legacy history');

    const approval = queue.approve('legacy-1');
    assert.equal(approval.ok, true);
    assert.equal(approval.item.interactionId, 'legacy-interaction');
    assert.equal(Object.hasOwn(approval.item, 'executionPayload'), false);
    assert.equal(queue.getHistory().some((item) => item.id === 'legacy-1'), true);
  }, legacyData);
});

test('implements pending to approved and pending to rejected with persisted timestamps', () => {
  withTemporaryQueue((queue, dataFile) => {
    const approvedId = addEmailApproval(queue, 'interaction-approved');
    const rejectedId = addEmailApproval(queue, 'interaction-rejected');

    assert.equal(queue.listPending().every((item) => item.status === 'pending'), true);

    const approved = queue.approve(approvedId);
    const rejected = queue.reject(rejectedId);
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

    assert.equal(approved.item.status, 'approved');
    assert.equal(typeof approved.item.approvedAt, 'string');
    assert.equal(rejected.item.status, 'rejected');
    assert.equal(typeof rejected.item.rejectedAt, 'string');
    assert.equal(persisted.history.find((item) => item.id === approvedId).status, 'approved');
    assert.equal(persisted.history.find((item) => item.id === rejectedId).status, 'rejected');
  });
});

test('keeps internal approval compatibility without serializing context or execution', () => {
  withTemporaryQueue((queue, dataFile) => {
    const id = addEmailApproval(queue, 'interaction-compatibility');
    const approval = queue.approve(id);

    assert.equal(approval.item.context.interactionId, 'interaction-compatibility');
    approval.item.execution = { ingested: true, externalId: 'knowledge-object-id' };
    queue.save();

    const serializedResponse = JSON.stringify(approval.item);
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8')).history[0];
    assert.equal(serializedResponse.includes('context'), false);
    assert.equal(serializedResponse.includes('execution'), false);
    assert.deepEqual(persisted.execution, { ingested: true, externalId: 'knowledge-object-id' });
  });
});

test('begins one persisted execution with internal payload, hash, UUID, and correlation', () => {
  withTemporaryQueue((queue, dataFile) => {
    const id = addEmailApproval(queue, 'interaction-begin');
    queue.approve(id);

    const begun = queue.beginExecution(id);
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8')).history.find((item) => item.id === id);
    const publicItem = queue.getHistory().find((item) => item.id === id);

    assert.equal(begun.ok, true);
    assert.equal(begun.approvalId, id);
    assert.equal(begun.interactionId, 'interaction-begin');
    assert.match(begun.executionId, UUID_PATTERN);
    assert.equal(begun.status, 'executing');
    assert.equal(begun.executionPayload.body, 'Cuerpo aprobado');
    assert.equal(begun.payloadHash, calculatePayloadHash(begun.executionPayload));
    assert.equal(persisted.status, 'executing');
    assert.equal(persisted.executionId, begun.executionId);
    assert.equal(Object.hasOwn(publicItem, 'executionPayload'), false);
    assert.equal(Object.hasOwn(publicItem, 'payloadHash'), false);
    assert.equal(JSON.stringify(publicItem).includes('Cuerpo aprobado'), false);
  });
});

test('blocks missing or manipulated execution payload without changing persisted state', () => {
  withTemporaryQueue((queue, dataFile) => {
    const validId = addEmailApproval(queue);
    queue.approve(validId);
    const item = queue.history.find((candidate) => candidate.id === validId);
    item.executionPayload.subject = 'Manipulado después de aprobar';
    const beforeInvalidHash = fs.readFileSync(dataFile, 'utf8');

    const integrityFailure = queue.beginExecution(validId);

    assert.equal(integrityFailure.ok, false);
    assert.equal(integrityFailure.code, 'execution_payload_integrity_failed');
    assert.equal(queue.history.find((candidate) => candidate.id === validId).status, 'approved');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), beforeInvalidHash);
  });

  const legacyData = {
    pending: [],
    history: [{
      id: 'legacy-approved',
      status: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      proposal: { type: 'email_draft', summary: 'Legacy', requiresApproval: true },
      context: {},
    }],
  };

  withTemporaryQueue((queue, dataFile) => {
    const before = fs.readFileSync(dataFile, 'utf8');
    const unavailable = queue.beginExecution('legacy-approved');

    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.code, 'execution_payload_unavailable');
    assert.equal(unavailable.error, 'execution payload unavailable');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  }, legacyData);
});

test('rejects invalid states and allows at most one beginExecution call', () => {
  withTemporaryQueue((queue, dataFile) => {
    const pendingId = addEmailApproval(queue, 'pending');
    const rejectedId = addEmailApproval(queue, 'rejected');
    queue.reject(rejectedId);
    const beforePendingAttempt = fs.readFileSync(dataFile, 'utf8');

    assert.equal(queue.beginExecution(pendingId).code, 'invalid_transition');
    assert.equal(queue.beginExecution(rejectedId).code, 'invalid_transition');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), beforePendingAttempt);

    queue.approve(pendingId);
    const first = queue.beginExecution(pendingId);
    const afterFirst = fs.readFileSync(dataFile, 'utf8');
    const second = queue.beginExecution(pendingId);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'invalid_transition');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), afterFirst);
  });
});

test('completes only the matching active execution and persists safe result metadata', () => {
  withTemporaryQueue((queue, dataFile) => {
    const id = addEmailApproval(queue, 'interaction-complete');
    assert.equal(queue.completeExecution(id, { executionId: 'external' }).code, 'invalid_transition');
    queue.approve(id);
    assert.equal(queue.completeExecution(id, { executionId: 'external' }).code, 'invalid_transition');
    const begun = queue.beginExecution(id);
    const beforeMismatch = fs.readFileSync(dataFile, 'utf8');

    assert.equal(queue.completeExecution(id, { executionId: 'wrong' }).code, 'execution_id_mismatch');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), beforeMismatch);

    const completed = queue.completeExecution(id, {
      executionId: begun.executionId,
      result: {
        type: 'email_draft',
        mode: 'SAFE_DRAFT_ONLY',
        externalId: 'draft-safe-id',
        secondaryExternalId: 'message-safe-id',
        body: 'must-not-persist',
        token: 'must-not-persist',
      },
    });
    const afterCompleted = fs.readFileSync(dataFile, 'utf8');
    const repeated = queue.completeExecution(id, {
      executionId: begun.executionId,
      result: { type: 'email_draft' },
    });
    const publicItem = queue.getHistory().find((item) => item.id === id);

    assert.equal(completed.status, 'executed');
    assert.deepEqual(completed.result, {
      type: 'email_draft',
      mode: 'SAFE_DRAFT_ONLY',
      externalId: 'draft-safe-id',
      secondaryExternalId: 'message-safe-id',
    });
    assert.equal(repeated.code, 'invalid_transition');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), afterCompleted);
    assert.equal(JSON.stringify(publicItem).includes('must-not-persist'), false);
    assert.equal(queue.beginExecution(id).code, 'invalid_transition');
  });
});

test('fails safely, strips sensitive errors, and retries once with a new executionId', () => {
  withTemporaryQueue((queue, dataFile) => {
    const id = addEmailApproval(queue, 'interaction-retry');
    queue.approve(id);
    const first = queue.beginExecution(id);
    const failed = queue.failExecution(id, {
      executionId: first.executionId,
      error: {
        code: 'provider_temporarily_unavailable',
        retryable: true,
        stack: 'sensitive stack',
        message: 'sensitive provider response',
        token: 'secret',
      },
    });
    const persistedFailure = fs.readFileSync(dataFile, 'utf8');

    assert.equal(failed.status, 'execution_failed');
    assert.deepEqual(failed.error, {
      code: 'provider_temporarily_unavailable',
      retryable: true,
    });
    assert.equal(persistedFailure.includes('sensitive stack'), false);
    assert.equal(persistedFailure.includes('sensitive provider response'), false);
    assert.equal(persistedFailure.includes('secret'), false);
    assert.equal(queue.failExecution(id, {
      executionId: first.executionId,
      error: { code: 'again', retryable: true },
    }).code, 'invalid_transition');

    const retried = queue.retryExecution(id);
    const afterRetry = fs.readFileSync(dataFile, 'utf8');
    const repeatedRetry = queue.retryExecution(id);

    assert.equal(retried.ok, true);
    assert.match(retried.executionId, UUID_PATTERN);
    assert.notEqual(retried.executionId, first.executionId);
    assert.equal(retried.interactionId, 'interaction-retry');
    assert.equal(repeatedRetry.code, 'invalid_transition');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), afterRetry);
  });
});

test('does not retry a non-retryable failure', () => {
  withTemporaryQueue((queue, dataFile) => {
    const id = addEmailApproval(queue);
    queue.approve(id);
    const begun = queue.beginExecution(id);
    queue.failExecution(id, {
      executionId: begun.executionId,
      error: { code: 'invalid_recipient', retryable: false },
    });
    const beforeRetry = fs.readFileSync(dataFile, 'utf8');
    const retry = queue.retryExecution(id);

    assert.equal(retry.code, 'execution_not_retryable');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), beforeRetry);
  });
});

test('rejects arbitrary persisted states without rewriting the legacy file', () => {
  const invalidStateData = {
    pending: [],
    history: [{
      id: 'arbitrary-state',
      status: 'custom_state',
      createdAt: '2026-01-01T00:00:00.000Z',
      publicProposal: { type: 'email_draft', summary: 'Invalid', requiresApproval: true },
      executionPayload: {
        to: null,
        subject: 'Asunto',
        body: 'Cuerpo',
        replyMessageId: null,
        threadId: null,
      },
      payloadHash: 'unused',
      context: {},
    }],
  };

  withTemporaryQueue((queue, dataFile) => {
    const before = fs.readFileSync(dataFile, 'utf8');

    assert.equal(queue.beginExecution('arbitrary-state').code, 'invalid_transition');
    assert.equal(queue.completeExecution('arbitrary-state', { executionId: 'x' }).code, 'invalid_transition');
    assert.equal(queue.failExecution('arbitrary-state', { executionId: 'x' }).code, 'invalid_transition');
    assert.equal(queue.retryExecution('arbitrary-state').code, 'invalid_transition');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
  }, invalidStateData);
});
