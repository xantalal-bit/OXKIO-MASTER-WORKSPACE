'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knowledgeSources = require('../../config/knowledgeSources');
const {
  GitHubReleasesConnector,
  normalizeRelease,
} = require('./connectors/github-releases-connector');
const { evaluateSourceQuality } = require('./source-quality-evaluator');
const { KnowledgeChangeDetector } = require('./knowledge-change-detector');
const { UniversalKnowledgeSupervisor } = require('./universal-knowledge-supervisor');
const { readKnowledgeObjects } = require('./executive-brain-simulation');

const storeDirectory = path.resolve(__dirname, '../../data/knowledge-store/objects');

function createRelease(overrides = {}) {
  return {
    id: 101,
    name: 'OXKIO V1.0.0',
    tag_name: 'v1.0.0',
    body: 'Official documentation README with usage, API and configuration notes for the first Universal Knowledge Supervisor pilot.',
    html_url: 'https://github.com/xantalal-bit/OXKIO-MASTER-WORKSPACE/releases/tag/v1.0.0',
    published_at: '2026-07-15T10:00:00.000Z',
    updated_at: '2026-07-15T10:00:00.000Z',
    draft: false,
    prerelease: false,
    author: { login: 'xantalal-bit' },
    ...overrides,
  };
}

class FakeApprovalQueue {
  constructor() {
    this.pending = [];
    this.history = [];
    this.sequence = 0;
  }

  async add(proposal, context) {
    this.sequence += 1;
    const item = { id: `approval-${this.sequence}`, status: 'pending', proposal, context };
    this.pending.push(item);
    return item;
  }

  async listPending() { return this.pending; }

  async approve(id) {
    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return { ok: false, error: 'not found' };
    const item = this.pending.splice(index, 1)[0];
    item.status = 'approved';
    this.history.push(item);
    return { ok: true, action: 'approved', item };
  }

  // FASE A2: la ingesta de conocimiento ya no muta el item directamente ni
  // llama a save() — pasa por begin/complete/failExecution como cualquier
  // otro consumidor de ApprovalQueue, así que el doble de test debe
  // ofrecerlos también.
  async beginExecution(id) {
    const item = this.history.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'approved') return { ok: false, code: 'invalid_transition' };
    item.status = 'executing';
    item.executionId = `execution-${id}`;
    return { ok: true, approvalId: id, executionId: item.executionId };
  }

  async completeExecution(id, { executionId, result } = {}) {
    const item = this.history.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'executing' || item.executionId !== executionId) {
      return { ok: false, code: 'invalid_transition' };
    }
    item.status = 'executed';
    item.result = result;
    return { ok: true, approvalId: id, executionId, status: 'executed', item };
  }

  async failExecution(id, { executionId, error } = {}) {
    const item = this.history.find((candidate) => candidate.id === id);
    if (!item) return { ok: false, code: 'invalid_transition' };
    item.status = 'execution_failed';
    item.error = error;
    return { ok: true, approvalId: id, executionId, status: 'execution_failed' };
  }

  save() {}
}

function getStoredObjectPath(sourceUrl) {
  const id = crypto.createHash('sha1').update(sourceUrl).digest('hex');
  return path.join(storeDirectory, `${id}.json`);
}

test('GitHub Releases connector uses the authorized endpoint and normalizes releases', async () => {
  let requestedUrl = null;
  const connector = new GitHubReleasesConnector(knowledgeSources.githubReleases, {
    fetch: async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => [createRelease()] };
    },
  });

  const releases = await connector.fetchReleases();

  assert.match(requestedUrl, /xantalal-bit\/OXKIO-MASTER-WORKSPACE\/releases/);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].sourceType, 'github-release');
  assert.equal(releases[0].repository, 'xantalal-bit/OXKIO-MASTER-WORKSPACE');
  assert.equal(releases[0].contentHash.length, 64);
});

test('source quality evaluator accepts only the configured official repository', () => {
  const candidate = normalizeRelease(createRelease(), knowledgeSources.githubReleases);
  const accepted = evaluateSourceQuality(candidate, knowledgeSources.githubReleases);
  const rejected = evaluateSourceQuality(
    { ...candidate, repository: 'someone/else' },
    knowledgeSources.githubReleases,
  );

  assert.equal(accepted.approved, true);
  assert.equal(accepted.confidence, 1);
  assert.equal(rejected.approved, false);
  assert.ok(rejected.reasons.includes('repository-not-authorized'));
});

test('change detector distinguishes new, unchanged and updated releases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-change-detector-'));
  const detector = new KnowledgeChangeDetector(path.join(root, 'state.json'));
  const candidate = normalizeRelease(createRelease(), knowledgeSources.githubReleases);

  assert.equal(detector.detect(candidate).changeType, 'new');
  detector.record(candidate, 'pending-approval');
  assert.equal(detector.detect(candidate).changeType, 'unchanged');
  assert.equal(detector.detect({ ...candidate, contentHash: 'changed' }).changeType, 'updated');

  fs.rmSync(root, { recursive: true, force: true });
});

test('supervisor queues first and enters Knowledge Engine only after approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-supervisor-'));
  const statePath = path.join(root, 'state.json');
  const release = createRelease();
  const candidate = normalizeRelease(release, knowledgeSources.githubReleases);
  const storedObjectPath = getStoredObjectPath(candidate.sourceUrl);
  const queue = new FakeApprovalQueue();
  const supervisor = new UniversalKnowledgeSupervisor({
    approvalQueue: queue,
    statePath,
    connector: { fetchReleases: async () => [candidate] },
  });

  try {
    if (fs.existsSync(storedObjectPath)) fs.rmSync(storedObjectPath);

    const discovery = await supervisor.discover();
    assert.equal(discovery.proposed, 1);
    assert.equal((await queue.listPending()).length, 1);
    assert.equal(fs.existsSync(storedObjectPath), false);

    const approval = await supervisor.approve(discovery.proposals[0].approvalId);
    assert.equal(approval.ok, true);
    assert.equal(approval.action, 'approved-and-ingested');
    assert.equal(approval.knowledgeObject.identity.version, '2.0');
    assert.equal(approval.knowledgeObject.identity.sourceType, 'github-release');
    assert.equal(approval.knowledgeObject.metadata.documentTypeClassification.type, 'Documentation');
    assert.ok(approval.knowledgeObject.metadata.documentStructure.headings.length > 0);
    assert.equal(fs.existsSync(storedObjectPath), true);

    const executiveKnowledge = readKnowledgeObjects();
    assert.ok(executiveKnowledge.some((knowledgeObject) => (
      knowledgeObject.id === approval.persistence.id
    )));

    const secondDiscovery = await supervisor.discover();
    assert.equal(secondDiscovery.proposed, 0);
    assert.equal(secondDiscovery.unchanged, 1);
  } finally {
    if (fs.existsSync(storedObjectPath)) fs.rmSync(storedObjectPath);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
