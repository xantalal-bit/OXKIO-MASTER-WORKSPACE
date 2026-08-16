'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable, Writable } = require('stream');
const ProposalEngine = require('../../core/proposalEngine');
const {
  createExecutiveRuntime,
} = require('./executive-runtime-factory');
const {
  handleExecutiveChatRequest,
} = require('../../api/routes/executive-chat');

function createRequest(payload) {
  const request = Readable.from([JSON.stringify(payload)]);
  request.method = 'POST';
  request.url = '/api/executive/chat';
  return request;
}

function createResponse() {
  const chunks = [];
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.writeHead = (statusCode, headers) => {
    response.statusCode = statusCode;
    response.headers = headers;
  };
  response.getJson = () => JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return response;
}

async function executeQuery(runtime, query, extraBody = {}) {
  const response = createResponse();
  await handleExecutiveChatRequest(createRequest({ query, ...extraBody }), response, {
    dependencies: {
      memory: runtime.memory,
      proposalEngine: new ProposalEngine(),
      approvalQueue: runtime.approvalQueue,
    },
  });
  assert.equal(response.statusCode, 200);
  return response.getJson();
}

test('production reuses injected stores and cleanup is a no-op', () => {
  const memory = {};
  const approvalQueue = {};
  const runtime = createExecutiveRuntime({
    mode: 'production',
    productionMemory: memory,
    productionApprovalQueue: approvalQueue,
  });

  assert.equal(runtime.mode, 'production');
  assert.equal(runtime.memory, memory);
  assert.equal(runtime.approvalQueue, approvalQueue);
  assert.doesNotThrow(() => runtime.cleanup());
});

test('sandbox uses valid temporary stores and removes them on cleanup', () => {
  const runtime = createExecutiveRuntime({ mode: 'sandbox' });
  const directory = path.dirname(runtime.memory.memoryPath);

  assert.equal(runtime.mode, 'sandbox');
  assert.equal(fs.existsSync(runtime.memory.memoryPath), true);
  assert.equal(fs.existsSync(runtime.approvalQueue.dataFile), true);
  assert.notEqual(runtime.memory.memoryPath, path.resolve('backend/memory/memory.json'));
  assert.notEqual(runtime.approvalQueue.dataFile, path.resolve('backend/core/approvalQueue.json'));

  runtime.cleanup();
  assert.equal(fs.existsSync(directory), false);
  assert.doesNotThrow(() => runtime.cleanup());
});

test('sandbox construction failure removes its temporary directory', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-runtime-test-'));

  try {
    assert.throws(() => createExecutiveRuntime({
      mode: 'sandbox',
      temporaryRoot,
      createMemory() {
        throw new Error('controlled construction failure');
      },
    }), /controlled construction failure/);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('sandbox informational queries write only temporary memory', async () => {
  const runtime = createExecutiveRuntime({ mode: 'sandbox' });

  try {
    for (const query of [
      '¿Cuál es el estado general de mi día?',
      '¿Tengo correos pendientes?',
      '¿Qué tengo hoy en la agenda?',
    ]) {
      const result = await executeQuery(runtime, query);
      assert.equal(result.proposal, null);
      assert.equal(result.approval, null);
      assert.equal(typeof result.interactionId, 'string');
    }

    assert.equal(runtime.memory.getRecentMemory().length, 3);
    assert.equal((await runtime.approvalQueue.listPending()).length, 0);
  } finally {
    runtime.cleanup();
  }
});

test('sandbox keeps email, meeting and task approvals temporary and correlated', async () => {
  const runtime = createExecutiveRuntime({ mode: 'sandbox' });

  try {
    const cases = [
      // Un borrador de email exige una señal de destinatario real (nunca se
      // inventa uno): dirección de correo + "asunto: X y cuerpo: Y" en la
      // propia consulta, el mecanismo que emailPreparationFromQuery ya
      // soporta. Una consulta sin esa señal (ni contexto Gmail) deja
      // deliberadamente executionPayload.to en null y approval en null en
      // ProposalEngine/enqueueApprovalSafely/addPreparedEmailDraft — no es
      // un fallo, es el contrato de "nunca fabricar destinatario".
      ['Prepara un borrador para piloto@example.com asunto: Seguimiento y cuerpo: Confirmo que avanzamos con la propuesta.', 'email_draft'],
      ['Programa una reunion', 'meeting_proposal'],
      ['Crea una tarea', 'task_proposal'],
    ];

    for (const [query, type] of cases) {
      const result = await executeQuery(runtime, query);
      const pending = (await runtime.approvalQueue.listPending()).at(-1);
      const memoryEntry = runtime.memory.getRecentMemory().at(-1).data;

      assert.equal(result.proposal.type, type);
      assert.equal(result.approval.status, 'pending');
      assert.equal(pending.interactionId, result.interactionId);
      assert.equal(memoryEntry.interactionId, result.interactionId);
      assert.equal(result.approval.id, pending.id);
    }
  } finally {
    runtime.cleanup();
  }
});

test('HTTP fields cannot select stores or expose sandbox paths', async () => {
  const runtime = createExecutiveRuntime({ mode: 'sandbox' });

  try {
    const result = await executeQuery(runtime, 'Consulta informativa', {
      runtimeMode: 'production',
      sandbox: false,
      memoryPath: 'backend/memory/memory.json',
      approvalQueuePath: 'backend/core/approvalQueue.json',
      dependencies: { memory: 'client' },
      diagnostics: { expose: true },
    });
    const serialized = JSON.stringify(result);

    assert.equal(runtime.memory.getRecentMemory().length, 1);
    assert.equal(serialized.includes('oxkio-executive-sandbox-'), false);
    assert.equal(serialized.includes('memoryPath'), false);
    assert.equal(serialized.includes('approvalQueuePath'), false);
    assert.equal(serialized.includes('executionPayload'), false);
    assert.equal(serialized.includes('payloadHash'), false);
  } finally {
    runtime.cleanup();
  }
});
