'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CONTRACTS, assertRepository } = require('./repository-contracts');
const {
  JsonApprovalRepository,
  JsonAuditRepository,
  JsonMemoryRepository,
  JsonOAuthTokenRepository,
  JsonOperationRepository,
} = require('./json-repositories');
const {
  canTransition,
  createIdempotencyRecord,
} = require('./idempotency-contract');

test('declares five provider-neutral repository contracts', () => {
  assert.deepEqual(Object.keys(CONTRACTS), [
    'ApprovalRepository',
    'MemoryRepository',
    'OperationRepository',
    'AuditRepository',
    'OAuthTokenRepository',
  ]);
  Object.entries(CONTRACTS).forEach(([name, methods]) => {
    const repository = Object.fromEntries(methods.map((method) => [method, () => {}]));
    assert.equal(assertRepository(repository, name), repository);
  });
});

test('JSON adapters remain local_only and preserve snapshots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-json-repositories-'));
  try {
    const cases = [
      [JsonApprovalRepository, 'approvals.json', { pending: [{ id: '1' }], history: [] }],
      [JsonMemoryRepository, 'memory.json', { shortTermMemory: [], longTermMemory: [{ id: '2' }] }],
      [JsonOperationRepository, 'operations.json', { logs: [{ id: '3' }] }],
    ];
    cases.forEach(([Repository, filename, snapshot]) => {
      const repository = new Repository({ filePath: path.join(root, filename) });
      assert.equal(repository.persistence, 'local_only');
      repository.saveSnapshot(snapshot);
      assert.deepEqual(repository.loadSnapshot(), snapshot);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('idempotency contract closes uncertain external effects and permits one safe retry path', () => {
  const record = createIdempotencyRecord({
    idempotencyKey: 'gmail-draft:approval-123',
    subjectId: 'tenant:user',
    operationType: 'email_draft',
  });
  assert.equal(record.state, 'reserved');
  assert.equal(canTransition('reserved', 'executing'), true);
  assert.equal(canTransition('executing', 'failed_retryable'), true);
  assert.equal(canTransition('failed_retryable', 'executing'), true);
  assert.equal(canTransition('executing', 'external_effect_unknown'), true);
  assert.equal(canTransition('external_effect_unknown', 'executing'), false);
  assert.equal(canTransition('succeeded', 'executing'), false);
});

test('remaining local adapters satisfy audit and OAuth token contracts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-local-contracts-'));
  try {
    const audit = new JsonAuditRepository({ filePath: path.join(root, 'audit.json') });
    assertRepository(audit, 'AuditRepository');
    audit.append({ id: 'audit-1' });
    assert.deepEqual(audit.list(), [{ id: 'audit-1' }]);

    const oauth = new JsonOAuthTokenRepository({ filePath: path.join(root, 'oauth.json') });
    assertRepository(oauth, 'OAuthTokenRepository');
    oauth.saveForSubject('user-1', { access: 'test-only' });
    assert.deepEqual(oauth.loadForSubject('user-1'), { access: 'test-only' });
    oauth.deleteForSubject('user-1');
    assert.equal(oauth.loadForSubject('user-1'), null);

  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('domain persistence classes depend on repository contracts, not JSON adapters', () => {
  [
    'backend/core/approvalQueue.js',
    'backend/memory/memoryEngine.js',
    'backend/core/executionLogger.js',
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
    assert.match(source, /assertRepository/);
    assert.doesNotMatch(source, /json-repositories/);
  });
});
