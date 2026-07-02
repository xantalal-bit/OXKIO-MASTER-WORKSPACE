'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runLearningHeroesConnector } = require('./learning-heroes-connector');
const { searchKnowledge } = require('../knowledge-query-service');

const storeDirectory = path.resolve(__dirname, '../../../data/knowledge-store/objects');

function createTempLearningHeroesRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-heroes-'));
  const repository = path.join(root, 'Learning Heroes');

  fs.mkdirSync(repository, { recursive: true });
  fs.writeFileSync(
    path.join(repository, 'module-01.md'),
    '# Learning Heroes Module 01\n\nCurso de estrategia y entrenamiento.',
    'utf8',
  );
  fs.writeFileSync(
    path.join(repository, 'notes.txt'),
    'Learning Heroes lesson notes and training material.',
    'utf8',
  );
  fs.writeFileSync(path.join(repository, 'image.png'), 'not supported', 'utf8');

  return {
    root,
    repository,
    documents: [
      path.join(repository, 'module-01.md'),
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

test('Learning Heroes is discovered through the official Knowledge Query Service chain', () => {
  const fixture = createTempLearningHeroesRepository();

  try {
    const result = searchKnowledge('Learning Heroes', {
      root: fixture.root,
    });

    assert.equal(result.found, true);
    assert.equal(result.asset.name, 'Learning Heroes');
    assert.equal(result.asset.recognized, true);
    assert.equal(result.pipeline.folder.path, fixture.repository);
    assert.equal(result.pipeline.knowledgeObjects.length, 2);
  } finally {
    cleanupFixture(fixture);
  }
});

test('runs Learning Heroes documents through the existing Knowledge Pipeline idempotently', () => {
  const fixture = createTempLearningHeroesRepository();

  try {
    const firstRun = runLearningHeroesConnector({
      root: fixture.root,
    });

    assert.equal(firstRun.found, true);
    assert.equal(firstRun.asset.name, 'Learning Heroes');
    assert.equal(firstRun.pipeline.knowledgeObjects.length, 2);
    assert.equal(firstRun.pipeline.persistedKnowledge.length, 2);
    assert.ok(firstRun.pipeline.persistedKnowledge.every((result) => result.saved === true));
    assert.ok(firstRun.pipeline.knowledgeObjects.every((knowledgeObject) => (
      knowledgeObject.identity.version === '2.0'
    )));
    assert.ok(firstRun.pipeline.knowledgeObjects.every((knowledgeObject) => (
      knowledgeObject.metadata.documentTypeClassification.type === 'Learning'
    )));
    assert.ok(firstRun.pipeline.knowledgeObjects.every((knowledgeObject) => (
      knowledgeObject.metadata.documentStructure
    )));

    const secondRun = runLearningHeroesConnector({
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
