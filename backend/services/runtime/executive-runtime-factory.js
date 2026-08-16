'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const MemoryEngine = require('../../memory/memoryEngine');
const ApprovalQueue = require('../../core/approvalQueue');

const PRODUCTION_MODE = 'production';
const SANDBOX_MODE = 'sandbox';

function createExecutiveRuntime({
  mode = PRODUCTION_MODE,
  productionMemory,
  productionApprovalQueue,
  createMemory = (memoryPath) => new MemoryEngine({ memoryPath }),
  createApprovalQueue = (dataFile) => new ApprovalQueue({ dataFile }),
  temporaryRoot = os.tmpdir(),
} = {}) {
  if (mode === PRODUCTION_MODE) {
    if (!productionMemory || !productionApprovalQueue) {
      throw new Error('Production executive runtime dependencies are required.');
    }

    return {
      mode: PRODUCTION_MODE,
      memory: productionMemory,
      approvalQueue: productionApprovalQueue,
      cleanup() {},
    };
  }

  if (mode !== SANDBOX_MODE) {
    throw new Error('Unsupported executive runtime mode.');
  }

  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'oxkio-executive-sandbox-'));
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(directory, { recursive: true, force: true });
  };

  try {
    const memoryPath = path.join(directory, 'memory.json');
    const approvalQueuePath = path.join(directory, 'approvalQueue.json');

    fs.writeFileSync(memoryPath, JSON.stringify({
      shortTermMemory: [],
      longTermMemory: [],
    }, null, 2));
    // FASE A2: ApprovalQueue ahora usa ApprovalRepositoryV2 (forma
    // {records:[...]}), no el snapshot V1 {pending,history}.
    fs.writeFileSync(approvalQueuePath, JSON.stringify({
      records: [],
    }, null, 2));

    return {
      mode: SANDBOX_MODE,
      memory: createMemory(memoryPath),
      approvalQueue: createApprovalQueue(approvalQueuePath),
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

module.exports = {
  PRODUCTION_MODE,
  SANDBOX_MODE,
  createExecutiveRuntime,
};
