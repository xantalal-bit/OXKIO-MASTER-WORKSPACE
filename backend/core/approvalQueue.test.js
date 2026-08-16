'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ApprovalQueue = require('./approvalQueue');
const {
  APPROVAL_TTL_MS,
  PREPARATION_TTL_MS,
  calculatePayloadHash,
  normalizeExecutionPayload,
} = ApprovalQueue;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// FASE A2: ApprovalQueue ya no cachea un snapshot en memoria (no hay
// `queue.pending`/`queue.history`) — cada operación relevante lee el backend
// V2 en fresco. Por eso este archivo ya no puede simular expiración
// mutando arrays internos: inyecta un reloj (`now`) en su lugar. Tampoco
// puede seguir probando "tolerancia a snapshots V1 legados", porque el
// backend por defecto ya no es el snapshot V1 — esa cobertura se retira
// aquí deliberadamente (no es una regresión silenciosa, está documentada
// en el informe de este turno).

function tempDataFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-approval-queue-'));
  return path.join(directory, 'approvalQueue.v2.json');
}

async function withTemporaryQueue(run, { now } = {}) {
  const dataFile = tempDataFile();
  const queue = new ApprovalQueue({ dataFile, ...(now ? { now } : {}) });
  return run(queue, dataFile);
}

async function addEmailApproval(queue, interactionId = 'interaction-execution') {
  const added = await queue.add({
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

test('stores email execution payload internally and exposes only public proposal metadata', async () => {
  await withTemporaryQueue(async (queue) => {
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

    const added = await queue.add(publicProposal, context, executionPayload);
    const [internalItem] = await queue.listPendingInternal();
    const [publicItem] = await queue.listPending();

    assert.equal(added.interactionId, 'interaction-1');
    assert.deepEqual(internalItem.executionPayload, normalizeExecutionPayload(executionPayload));
    assert.equal(internalItem.payloadHash, calculatePayloadHash(executionPayload));
    assert.deepEqual(publicItem.publicProposal, publicProposal);
    assert.deepEqual(publicItem.proposal, publicProposal);
    assert.equal(Object.hasOwn(publicItem, 'executionPayload'), false);
    assert.equal(Object.hasOwn(publicItem, 'payloadHash'), false);
    assert.equal(JSON.stringify(added).includes('Contenido del borrador'), false);
  });
});

test('creates one exact approvable email preparation with an internal id and immutable payload hash', async () => {
  await withTemporaryQueue(async (queue) => {
    const added = await queue.addPreparedEmailDraft({
      recipient: 'pilot@example.com',
      subject: 'Piloto OXKIO',
      body: 'Mensaje seguro para el piloto.',
      risk: 'low',
    }, { interactionId: 'pilot-interaction' });

    assert.equal(added.status, 'pending');
    assert.match(added.publicProposal.preparationId, UUID_PATTERN);
    assert.deepEqual(added.publicProposal, {
      preparationId: added.publicProposal.preparationId,
      actionType: 'prepare-email-draft',
      type: 'email_draft',
      status: 'prepared',
      recipient: 'pilot@example.com',
      subject: 'Piloto OXKIO',
      body: 'Mensaje seguro para el piloto.',
      summary: 'Borrador preparado para aprobación humana.',
      risk: 'low',
      requiresApproval: true,
      executionEnabled: false,
    });
    const internal = await queue.getInternalById(added.id);
    assert.equal(internal.context.preparationId, added.publicProposal.preparationId);
    assert.equal(internal.executionPayload.to, added.publicProposal.recipient);
    assert.equal(internal.payloadHash, calculatePayloadHash(internal.executionPayload));
    assert.equal(typeof internal.expiresAt, 'string');
  });
});

test('incomplete or active HTML preparations cannot be approved', async () => {
  await withTemporaryQueue(async (queue) => {
    for (const preparation of [
      { recipient: '', subject: 'Asunto', body: 'Cuerpo' },
      { recipient: 'pilot@example.com', subject: '', body: 'Cuerpo' },
      { recipient: 'pilot@example.com', subject: 'Asunto', body: '<script>alert(1)</script>' },
    ]) {
      assert.equal((await queue.addPreparedEmailDraft(preparation)).code, 'preparation_not_ready');
    }
  });
});

test('an expired preparation cannot be approved and is reported as expired', async () => {
  let clock = Date.now();
  await withTemporaryQueue(async (queue) => {
    const added = await queue.addPreparedEmailDraft({
      recipient: 'pilot@example.com',
      subject: 'Caducado',
      body: 'No debe aprobarse.',
    });
    clock += PREPARATION_TTL_MS + 60_000;

    const result = await queue.approve(added.id, { clientId: 'cliente-cero', userId: 'pilot-user' });
    assert.equal(result.code, 'approval_expired');
    assert.equal((await queue.getInternalById(added.id)).status, 'expired');
  }, { now: () => clock });
});

test('uses a two-hour preparation window and a separate thirty-minute approval window', async () => {
  let clock = Date.now();
  await withTemporaryQueue(async (queue) => {
    const before = clock;
    const added = await queue.addPreparedEmailDraft({
      recipient: 'pilot@example.com',
      subject: 'Ventana humana',
      body: 'Revisión controlada.',
    });
    const prepared = await queue.getInternalById(added.id);

    assert.equal(PREPARATION_TTL_MS, 2 * 60 * 60 * 1000);
    assert.equal(APPROVAL_TTL_MS, 30 * 60 * 1000);
    assert.equal(Date.parse(prepared.expiresAt), before + PREPARATION_TTL_MS);

    await queue.approve(added.id, { clientId: 'cliente-cero', userId: 'pilot-user' });
    const approved = await queue.getInternalById(added.id);
    assert.equal(Date.parse(approved.approvalExpiresAt), Date.parse(approved.approvedAt) + APPROVAL_TTL_MS);
  }, { now: () => clock });
});

test('expired preparations leave pending automatically and expose no operational content', async () => {
  let clock = Date.now();
  await withTemporaryQueue(async (queue) => {
    const added = await queue.addPreparedEmailDraft({
      recipient: 'pilot@example.com',
      subject: 'Caducidad automática',
      body: 'No debe seguir accionable.',
    });
    clock += PREPARATION_TTL_MS + 60_000;

    assert.equal((await queue.listPending()).some((item) => item.id === added.id), false);
    const expired = (await queue.getHistory()).find((item) => item.id === added.id);
    assert.equal(expired.status, 'expired');
    assert.equal(Object.hasOwn(expired.publicProposal, 'recipient'), false);
    assert.equal(Object.hasOwn(expired.publicProposal, 'subject'), false);
    assert.equal(Object.hasOwn(expired.publicProposal, 'body'), false);
    assert.equal((await queue.beginExecution(added.id)).code, 'invalid_transition');
  }, { now: () => clock });
});

test('expired approval cannot execute and a repeated preparation is independent', async () => {
  let clock = Date.now();
  await withTemporaryQueue(async (queue) => {
    const first = await queue.addPreparedEmailDraft({
      recipient: 'pilot@example.com',
      subject: 'Primera preparación',
      body: 'Contenido uno.',
    });
    await queue.approve(first.id, { clientId: 'cliente-cero', userId: 'pilot-user' });
    clock += APPROVAL_TTL_MS + 60_000;

    assert.equal((await queue.beginExecution(first.id)).code, 'approval_expired');
    assert.equal((await queue.getInternalById(first.id)).status, 'expired');

    const second = await queue.addPreparedEmailDraft({
      recipient: 'pilot@example.com',
      subject: 'Segunda preparación',
      body: 'Contenido dos.',
    });
    const firstInternal = await queue.getInternalById(first.id);
    const secondInternal = await queue.getInternalById(second.id);
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.publicProposal.preparationId, first.publicProposal.preparationId);
    assert.notEqual(secondInternal.payloadHash, firstInternal.payloadHash);
    assert.equal(secondInternal.status, 'pending');
    assert.equal(secondInternal.approvedAt, null);
    assert.equal(secondInternal.executionId, null);
  }, { now: () => clock });
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

test('does not accept execution payload or payload hash embedded in public proposal', async () => {
  await withTemporaryQueue(async (queue) => {
    await queue.add({
      type: 'email_draft',
      summary: 'Visible',
      requiresApproval: true,
      executionPayload: { to: 'attacker@example.com', subject: 'Injected', body: 'Injected' },
      payloadHash: 'client-controlled',
    }, { interactionId: 'interaction-2' });

    const [internalItem] = await queue.listPendingInternal();
    const [publicItem] = await queue.listPending();

    assert.equal(internalItem.executionPayload, null);
    assert.equal(internalItem.payloadHash, null);
    assert.equal(Object.hasOwn(publicItem.publicProposal, 'executionPayload'), false);
    assert.equal(Object.hasOwn(publicItem.publicProposal, 'payloadHash'), false);
  });
});

test('implements pending to approved and pending to rejected with persisted timestamps', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const approvedId = await addEmailApproval(queue, 'interaction-approved');
    const rejectedId = await addEmailApproval(queue, 'interaction-rejected');

    assert.equal((await queue.listPending()).every((item) => item.status === 'pending'), true);

    const approved = await queue.approve(approvedId);
    const rejected = await queue.reject(rejectedId);
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8')).records;

    assert.equal(approved.item.status, 'approved');
    assert.equal(typeof approved.item.approvedAt, 'string');
    assert.equal(rejected.item.status, 'rejected');
    assert.equal(typeof rejected.item.rejectedAt, 'string');
    assert.equal(persisted.find((item) => item.id === approvedId).status, 'approved');
    assert.equal(persisted.find((item) => item.id === rejectedId).status, 'rejected');
  });
});

test('exposes context to internal callers without serializing it, and has no execution setter to bypass CAS', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addEmailApproval(queue, 'interaction-compatibility');
    const approval = await queue.approve(id);

    assert.equal(approval.item.context.interactionId, 'interaction-compatibility');

    const serializedResponse = JSON.stringify(approval.item);
    assert.equal(serializedResponse.includes('context'), false);

    // FASE A2: ya no existe attachInternalCompatibility con setter de
    // `execution`. Asignar la propiedad crea, como mucho, una propiedad
    // enumerable normal en el objeto público devuelto — nunca muta el
    // estado persistido, y nunca hay un `queue.save()` público que lo
    // escriba. Esta es exactamente la puerta lateral que se eliminó.
    assert.equal(typeof queue.save, 'undefined');
    approval.item.execution = { ingested: true, externalId: 'must-not-persist' };
    const reread = await queue.getInternalById(id);
    assert.equal(JSON.stringify(reread).includes('must-not-persist'), false);
  });
});

test('begins one persisted execution with internal payload, hash, UUID, and correlation', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const id = await addEmailApproval(queue, 'interaction-begin');
    await queue.approve(id);

    const begun = await queue.beginExecution(id);
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8')).records.find((item) => item.id === id);
    const publicItem = (await queue.getHistory()).find((item) => item.id === id);

    assert.equal(begun.ok, true);
    assert.equal(begun.approvalId, id);
    assert.equal(begun.interactionId, 'interaction-begin');
    assert.match(begun.executionId, UUID_PATTERN);
    assert.equal(begun.actionType, 'propose_email');
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

test('maps persisted proposal types to internal actionTypes without accepting external overrides', async () => {
  const cases = [
    ['email_draft', 'propose_email'],
    ['meeting_proposal', 'propose_meeting'],
    ['task_proposal', 'create_task_proposal'],
  ];

  for (const [proposalType, expectedActionType] of cases) {
    await withTemporaryQueue(async (queue) => {
      const added = await queue.add({
        type: proposalType,
        summary: 'Propuesta persistida',
        requiresApproval: true,
      }, {
        interactionId: `interaction-${proposalType}`,
        actionType: 'client_context_override',
      }, {
        to: 'recipient@example.com',
        subject: 'Forma de payload email que no determina el tipo',
        body: 'Contenido interno',
        replyMessageId: null,
        threadId: null,
      });
      await queue.approve(added.id);

      const begun = await queue.beginExecution(added.id);

      assert.equal(begun.ok, true);
      assert.equal(begun.actionType, expectedActionType);
      assert.equal((await queue.getInternalById(added.id)).status, 'executing');
    });
  }
});

test('keeps actionType internal to beginExecution and leaves public queue views unchanged', async () => {
  await withTemporaryQueue(async (queue) => {
    const approvedId = await addEmailApproval(queue, 'public-approved');
    const rejectedId = await addEmailApproval(queue, 'public-rejected');
    const pendingId = await addEmailApproval(queue, 'public-pending');
    const approved = await queue.approve(approvedId);
    const rejected = await queue.reject(rejectedId);
    const begun = await queue.beginExecution(approvedId);
    const pending = (await queue.listPending()).find((item) => item.id === pendingId);
    const history = await queue.getHistory();

    assert.equal(begun.actionType, 'propose_email');
    [pending, approved.item, rejected.item, ...history].forEach((publicItem) => {
      assert.equal(Object.hasOwn(publicItem, 'actionType'), false);
      assert.equal(Object.hasOwn(publicItem, 'executionPayload'), false);
      assert.equal(Object.hasOwn(publicItem, 'payloadHash'), false);
    });
    assert.equal(pending.publicProposal.type, 'email_draft');
  });
});

test('blocks missing and unknown persisted proposal types before mutating approved state', async () => {
  const cases = [
    { summary: 'Sin tipo' },
    { type: 'unknown_proposal', summary: 'Tipo desconocido' },
  ];

  for (const publicProposal of cases) {
    await withTemporaryQueue(async (queue, dataFile) => {
      const added = await queue.add({
        ...publicProposal,
        requiresApproval: true,
      }, {
        interactionId: 'interaction-unavailable-type',
        actionType: 'propose_email',
      }, {
        to: 'recipient@example.com',
        subject: 'Payload con forma de email',
        body: 'No debe inferirse el tipo desde este payload',
        replyMessageId: null,
        threadId: null,
      });
      await queue.approve(added.id);
      const before = fs.readFileSync(dataFile, 'utf8');

      const result = await queue.beginExecution(added.id);
      const stored = await queue.getInternalById(added.id);

      assert.deepEqual(result, {
        ok: false,
        code: 'execution_action_type_unavailable',
        message: 'Execution action type is unavailable.',
      });
      assert.equal(stored.status, 'approved');
      assert.equal(stored.executionId, null);
      assert.equal(Object.hasOwn(result, 'executionPayload'), false);
      assert.equal(fs.readFileSync(dataFile, 'utf8'), before);
    });
  }
});

test('blocks execution when the persisted payload hash no longer matches the payload (tamper/corruption guard)', async () => {
  await withTemporaryQueue(async (queue, dataFile) => {
    const validId = await addEmailApproval(queue);
    await queue.approve(validId);

    // Simula corrupcion/edicion externa del fichero V2 (p. ej. una escritura
    // parcial de otra instancia) alterando el payload sin recalcular su hash.
    const state = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const record = state.records.find((item) => item.id === validId);
    record.record.executionPayload.subject = 'Manipulado después de aprobar';
    fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
    const beforeInvalidHash = fs.readFileSync(dataFile, 'utf8');

    const integrityFailure = await queue.beginExecution(validId);

    assert.equal(integrityFailure.ok, false);
    assert.equal(integrityFailure.code, 'execution_payload_integrity_failed');
    assert.equal((await queue.getInternalById(validId)).status, 'approved');
    assert.equal(fs.readFileSync(dataFile, 'utf8'), beforeInvalidHash);
  });
});

test('rejects invalid states and allows at most one active beginExecution call', async () => {
  await withTemporaryQueue(async (queue) => {
    const pendingId = await addEmailApproval(queue, 'pending');
    const rejectedId = await addEmailApproval(queue, 'rejected');
    await queue.reject(rejectedId);

    assert.equal((await queue.beginExecution(pendingId)).code, 'invalid_transition');
    assert.equal((await queue.beginExecution(rejectedId)).code, 'invalid_transition');

    await queue.approve(pendingId);
    const first = await queue.beginExecution(pendingId);
    const second = await queue.beginExecution(pendingId);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'invalid_transition');
  });
});

test('completes only the matching active execution and persists safe result metadata', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addEmailApproval(queue, 'interaction-complete');
    assert.equal((await queue.completeExecution(id, { executionId: 'external' })).code, 'invalid_transition');
    await queue.approve(id);
    assert.equal((await queue.completeExecution(id, { executionId: 'external' })).code, 'invalid_transition');
    const begun = await queue.beginExecution(id);

    assert.equal((await queue.completeExecution(id, { executionId: 'wrong' })).code, 'execution_id_mismatch');

    const completed = await queue.completeExecution(id, {
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
    const repeated = await queue.completeExecution(id, {
      executionId: begun.executionId,
      result: { type: 'email_draft' },
    });
    const publicItem = (await queue.getHistory()).find((item) => item.id === id);

    assert.equal(completed.status, 'executed');
    assert.deepEqual(completed.result, {
      type: 'email_draft',
      mode: 'SAFE_DRAFT_ONLY',
      externalId: 'draft-safe-id',
      secondaryExternalId: 'message-safe-id',
    });
    assert.equal(repeated.code, 'invalid_transition');
    assert.equal(JSON.stringify(publicItem).includes('must-not-persist'), false);
    assert.equal((await queue.beginExecution(id)).code, 'invalid_transition');
  });
});

test('fails safely, strips sensitive errors, and retries once with a new executionId', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addEmailApproval(queue, 'interaction-retry');
    await queue.approve(id);
    const first = await queue.beginExecution(id);
    const failed = await queue.failExecution(id, {
      executionId: first.executionId,
      error: {
        code: 'provider_temporarily_unavailable',
        retryable: true,
        stack: 'sensitive stack',
        message: 'sensitive provider response',
        token: 'secret',
      },
    });

    assert.equal(failed.status, 'execution_failed');
    assert.deepEqual(failed.error, {
      code: 'provider_temporarily_unavailable',
      retryable: true,
    });
    assert.equal((await queue.failExecution(id, {
      executionId: first.executionId,
      error: { code: 'again', retryable: true },
    })).code, 'invalid_transition');

    const retried = await queue.retryExecution(id);
    const repeatedRetry = await queue.retryExecution(id);

    assert.equal(retried.ok, true);
    assert.match(retried.executionId, UUID_PATTERN);
    assert.notEqual(retried.executionId, first.executionId);
    assert.equal(retried.interactionId, 'interaction-retry');
    assert.equal(repeatedRetry.code, 'invalid_transition');
  });
});

test('does not retry a non-retryable failure', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addEmailApproval(queue);
    await queue.approve(id);
    const begun = await queue.beginExecution(id);
    await queue.failExecution(id, {
      executionId: begun.executionId,
      error: { code: 'invalid_recipient', retryable: false },
    });
    const retry = await queue.retryExecution(id);

    assert.equal(retry.code, 'execution_not_retryable');
  });
});

test('exhausts the single retry budget even after a second retryable failure', async () => {
  await withTemporaryQueue(async (queue) => {
    const id = await addEmailApproval(queue);
    await queue.approve(id);
    const begun = await queue.beginExecution(id);
    await queue.failExecution(id, {
      executionId: begun.executionId,
      error: { code: 'provider_temporarily_unavailable', retryable: true },
    });
    const retried = await queue.retryExecution(id);
    await queue.failExecution(id, {
      executionId: retried.executionId,
      error: { code: 'provider_temporarily_unavailable', retryable: true },
    });

    const secondRetry = await queue.retryExecution(id);
    assert.equal(secondRetry.code, 'execution_retry_exhausted');
  });
});

// FASE A2: dos instancias de ApprovalQueue apuntando al mismo fichero V2
// deben verse mutuamente sin reconstruirse — la misma propiedad que ya
// demuestra la suite de contrato de ApprovalRepositoryV2, verificada aquí a
// nivel de negocio completo (con TTL, redacción y actionType incluidos).
test('two ApprovalQueue instances on the same JSON V2 backend observe each other through fresh reads', async () => {
  const dataFile = tempDataFile();
  const queueA = new ApprovalQueue({ dataFile });
  const queueB = new ApprovalQueue({ dataFile });

  const added = await queueA.add({
    type: 'email_draft',
    summary: 'Cruzado entre instancias',
    requiresApproval: true,
  }, { interactionId: 'cross-instance' }, {
    to: 'demo@example.invalid',
    subject: 'S',
    body: 'B',
    replyMessageId: null,
    threadId: null,
  });

  assert.equal((await queueB.listPending()).some((item) => item.id === added.id), true);

  const approvedByB = await queueB.approve(added.id);
  assert.equal(approvedByB.ok, true);

  const seenByA = await queueA.getInternalById(added.id);
  assert.equal(seenByA.status, 'approved');

  const begunByA = await queueA.beginExecution(added.id);
  assert.equal(begunByA.ok, true);

  const completedByB = await queueB.completeExecution(added.id, {
    executionId: begunByA.executionId,
    result: { type: 'email_draft', externalId: 'cross-instance-draft' },
  });
  assert.equal(completedByB.ok, true);
  assert.equal(completedByB.status, 'executed');
});
