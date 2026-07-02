'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runBusinessHunterConnector,
} = require('./business-hunter-connector');
const { searchKnowledge } = require('../knowledge-query-service');

const storeDirectory = path.resolve(__dirname, '../../../data/knowledge-store/objects');

function createTempBusinessHunterRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'business-hunter-'));
  const repository = path.join(root, 'Business Hunter');

  fs.mkdirSync(repository, { recursive: true });
  fs.writeFileSync(
    path.join(repository, 'lead-guide.md'),
    '# Business Hunter Lead Guide\n\nDocumentacion y estrategia comercial.',
    'utf8',
  );
  fs.writeFileSync(
    path.join(repository, 'notes.txt'),
    'Business Hunter tareas pendientes y decisiones comerciales.',
    'utf8',
  );

  return {
    root,
    repository,
    documents: [
      path.join(repository, 'lead-guide.md'),
      path.join(repository, 'notes.txt'),
    ],
  };
}

function getStorePathForDocument(documentPath) {
  const id = crypto
    .createHash('sha1')
    .update(documentPath)
    .digest('hex');

  return path.join(storeDirectory, `${id}.json`);
}

function cleanupFixture(fixture) {
  fixture.documents
    .map(getStorePathForDocument)
    .forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
      }
    });

  fs.rmSync(fixture.root, { recursive: true, force: true });
}

test('Business Hunter is discovered through the official Knowledge Query Service chain', () => {
  const fixture = createTempBusinessHunterRepository();

  try {
    const result = searchKnowledge('Business Hunter', {
      root: fixture.root,
    });

    assert.equal(result.found, true);
    assert.equal(result.asset.name, 'Business Hunter');
    assert.equal(result.asset.recognized, true);
    assert.equal(result.pipeline.folder.path, fixture.repository);
    assert.equal(result.pipeline.knowledgeObjects.length, 2);
  } finally {
    cleanupFixture(fixture);
  }
});

test('runs Business Hunter documents through the existing Knowledge Pipeline idempotently', () => {
  const fixture = createTempBusinessHunterRepository();

  try {
    const firstRun = runBusinessHunterConnector({
      root: fixture.root,
    });

    assert.equal(firstRun.found, true);
    assert.equal(firstRun.asset.name, 'Business Hunter');
    assert.equal(firstRun.pipeline.knowledgeObjects.length, 2);
    assert.equal(firstRun.pipeline.persistedKnowledge.length, 2);
    assert.ok(firstRun.pipeline.persistedKnowledge.every((result) => result.saved === true));

    const secondRun = runBusinessHunterConnector({
      root: fixture.root,
    });

    assert.equal(secondRun.pipeline.knowledgeObjects.length, 2);
    assert.ok(secondRun.pipeline.persistedKnowledge.every((result) => (
      result.persisted === false && result.reason === 'already-exists'
    )));
  } finally {
    cleanupFixture(fixture);
  }
});
