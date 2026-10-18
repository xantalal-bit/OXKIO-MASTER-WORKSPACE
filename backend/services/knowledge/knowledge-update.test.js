'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processKnowledgeDocument, runKnowledgePipeline } = require('./knowledge-pipeline');
const { runBusinessHunterConnector } = require('./connectors/business-hunter-connector');

const storeDirectory = path.resolve(__dirname, '../../data/knowledge-store/objects');
const ASSET = 'KO Update Fixture';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getStorePathForDocument(documentPath) {
  const id = crypto.createHash('sha1').update(documentPath).digest('hex');
  return path.join(storeDirectory, `${id}.json`);
}

function createFixture(folderName = ASSET, fileName = 'guide.md', content = '# Guide\n\nVersion uno.\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-update-'));
  const folder = path.join(root, folderName);
  fs.mkdirSync(folder, { recursive: true });
  const documentPath = path.join(folder, fileName);
  fs.writeFileSync(documentPath, content, 'utf8');

  return {
    root,
    folder,
    documentPath,
    storePath: getStorePathForDocument(documentPath),
    document: {
      name: fileName,
      type: 'file',
      extension: path.extname(fileName),
      path: documentPath,
    },
  };
}

function cleanupFixture(fixture) {
  if (fs.existsSync(fixture.storePath)) fs.rmSync(fixture.storePath);
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

// Objetos del almacén que representan este documento. Otros tests escriben y borran en paralelo
// en el mismo directorio, así que se ignoran los archivos que desaparecen o cambian durante la lectura.
function storedObjectsForDocument(documentPath) {
  return fs.readdirSync(storeDirectory)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => {
      try {
        const stored = JSON.parse(fs.readFileSync(path.join(storeDirectory, name), 'utf8'));
        return Boolean(stored && stored.identity && stored.identity.path === documentPath);
      } catch (error) {
        return false;
      }
    });
}

function tempFilesFor(storePath) {
  const base = path.basename(storePath);
  return fs.readdirSync(storeDirectory).filter((name) => name.startsWith(`${base}.`) && name.endsWith('.tmp'));
}

test('creation stores a local document with a sha256 content hash and path identity', () => {
  const fixture = createFixture();

  try {
    const result = processKnowledgeDocument(fixture.document);

    assert.equal(result.persistence.saved, true);
    assert.equal(result.persistence.path, fixture.storePath);
    const stored = JSON.parse(fs.readFileSync(fixture.storePath, 'utf8'));
    assert.equal(stored.identity.hash, sha256(fs.readFileSync(fixture.documentPath, 'utf8')));
    assert.equal(stored.revision, undefined);
  } finally {
    cleanupFixture(fixture);
  }
});

test('unchanged content with allowUpdate does not rewrite the stored object', () => {
  const fixture = createFixture();

  try {
    processKnowledgeDocument(fixture.document);
    const before = fs.readFileSync(fixture.storePath);

    const result = processKnowledgeDocument(fixture.document, { allowUpdate: true });

    assert.equal(result.persistence.persisted, false);
    assert.equal(result.persistence.reason, 'unchanged');
    assert.deepEqual(fs.readFileSync(fixture.storePath), before);
  } finally {
    cleanupFixture(fixture);
  }
});

test('changed content with allowUpdate updates the same object with revision traceability', () => {
  const fixture = createFixture();

  try {
    processKnowledgeDocument(fixture.document);
    const first = JSON.parse(fs.readFileSync(fixture.storePath, 'utf8'));
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');

    const result = processKnowledgeDocument(fixture.document, { allowUpdate: true });

    assert.equal(result.persistence.updated, true);
    assert.equal(result.persistence.previousHash, first.identity.hash);
    assert.equal(result.persistence.id, first.id);
    assert.deepEqual(storedObjectsForDocument(fixture.documentPath), [path.basename(fixture.storePath)]);
    assert.deepEqual(tempFilesFor(fixture.storePath), []);
    const updated = JSON.parse(fs.readFileSync(fixture.storePath, 'utf8'));
    assert.equal(updated.content.raw, '# Guide\n\nVersion dos.\n');
    assert.equal(updated.identity.hash, sha256('# Guide\n\nVersion dos.\n'));
    assert.equal(updated.revision.number, 1);
    assert.equal(updated.revision.previousHash, first.identity.hash);
    assert.equal(updated.revision.previousHashSource, 'identity');
    assert.equal(updated.revision.previousStoredAt, first.storedAt);
    assert.ok(updated.revision.updatedAt);
  } finally {
    cleanupFixture(fixture);
  }
});

test('update is idempotent: a second authorised run reports unchanged', () => {
  const fixture = createFixture();

  try {
    processKnowledgeDocument(fixture.document);
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');
    assert.equal(processKnowledgeDocument(fixture.document, { allowUpdate: true }).persistence.updated, true);
    const afterUpdate = fs.readFileSync(fixture.storePath);

    const again = processKnowledgeDocument(fixture.document, { allowUpdate: true });

    assert.equal(again.persistence.reason, 'unchanged');
    assert.deepEqual(fs.readFileSync(fixture.storePath), afterUpdate);
  } finally {
    cleanupFixture(fixture);
  }
});

test('without authorisation a changed document is not updated but the change is reported', () => {
  const fixture = createFixture();

  try {
    processKnowledgeDocument(fixture.document);
    const before = fs.readFileSync(fixture.storePath);
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');

    for (const options of [undefined, {}, { allowUpdate: false }, { allowUpdate: 'true' }, { allowUpdate: 1 }]) {
      const result = processKnowledgeDocument(fixture.document, options);
      assert.equal(result.persistence.persisted, false);
      assert.equal(result.persistence.reason, 'already-exists');
      assert.equal(result.persistence.changeDetected, true);
    }
    assert.deepEqual(fs.readFileSync(fixture.storePath), before);
  } finally {
    cleanupFixture(fixture);
  }
});

test('runKnowledgePipeline forwards allowUpdate only when it is exactly true', () => {
  const fixture = createFixture();

  try {
    const created = runKnowledgePipeline({ name: ASSET }, { root: fixture.root });
    assert.equal(created.persistedKnowledge[0].saved, true);
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');

    const denied = runKnowledgePipeline({ name: ASSET }, { root: fixture.root, allowUpdate: 'yes' });
    assert.equal(denied.persistedKnowledge[0].reason, 'already-exists');
    assert.equal(denied.persistedKnowledge[0].changeDetected, true);

    const allowed = runKnowledgePipeline({ name: ASSET }, { root: fixture.root, allowUpdate: true });
    assert.equal(allowed.persistedKnowledge[0].updated, true);
    assert.equal(JSON.parse(fs.readFileSync(fixture.storePath, 'utf8')).content.raw, '# Guide\n\nVersion dos.\n');
  } finally {
    cleanupFixture(fixture);
  }
});

test('persist:false never writes, even with allowUpdate', () => {
  const fixture = createFixture();

  try {
    const result = processKnowledgeDocument(fixture.document, { persist: false, allowUpdate: true });
    assert.equal(result.persistence, null);
    assert.equal(fs.existsSync(fixture.storePath), false);

    const pipeline = runKnowledgePipeline({ name: ASSET }, { root: fixture.root, persist: false, allowUpdate: true });
    assert.deepEqual(pipeline.persistedKnowledge, []);
    assert.equal(fs.existsSync(fixture.storePath), false);
  } finally {
    cleanupFixture(fixture);
  }
});

test('legacy objects without identity.hash are compared through content.raw', () => {
  const fixture = createFixture();

  try {
    processKnowledgeDocument(fixture.document);
    const legacy = JSON.parse(fs.readFileSync(fixture.storePath, 'utf8'));
    legacy.identity.hash = null;
    fs.writeFileSync(fixture.storePath, JSON.stringify(legacy, null, 2), 'utf8');
    const legacyBytes = fs.readFileSync(fixture.storePath);

    const same = processKnowledgeDocument(fixture.document, { allowUpdate: true });
    assert.equal(same.persistence.reason, 'unchanged');
    assert.deepEqual(fs.readFileSync(fixture.storePath), legacyBytes);

    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');
    const changed = processKnowledgeDocument(fixture.document, { allowUpdate: true });
    assert.equal(changed.persistence.updated, true);
    const updated = JSON.parse(fs.readFileSync(fixture.storePath, 'utf8'));
    assert.equal(updated.revision.previousHashSource, 'content');
    assert.equal(updated.revision.previousHash, sha256(legacy.content.raw));
  } finally {
    cleanupFixture(fixture);
  }
});

test('an unreadable existing object is never overwritten', () => {
  const fixture = createFixture();

  try {
    processKnowledgeDocument(fixture.document);
    fs.writeFileSync(fixture.storePath, '{ corrupto', 'utf8');
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');

    const result = processKnowledgeDocument(fixture.document, { allowUpdate: true });

    assert.equal(result.persistence.reason, 'existing-unreadable');
    assert.equal(fs.readFileSync(fixture.storePath, 'utf8'), '{ corrupto');
  } finally {
    cleanupFixture(fixture);
  }
});

test('documents that bring their own contentHash keep it (GitHub Release path)', () => {
  const result = processKnowledgeDocument({
    name: 'release.md',
    type: 'file',
    extension: '.md',
    path: 'https://example.invalid/release',
    content: 'Release notes',
    contentHash: 'provided-hash',
  }, { persist: false });

  assert.equal(result.knowledgeObject.identity.hash, 'provided-hash');
});

test('connectors do not forward allowUpdate', () => {
  const fixture = createFixture('Business Hunter', 'notes.md', 'Business Hunter notas uno.\n');

  try {
    assert.equal(runBusinessHunterConnector({ root: fixture.root }).pipeline.persistedKnowledge[0].saved, true);
    fs.writeFileSync(fixture.documentPath, 'Business Hunter notas dos.\n', 'utf8');

    const result = runBusinessHunterConnector({ root: fixture.root, allowUpdate: true });

    assert.equal(result.pipeline.persistedKnowledge[0].reason, 'already-exists');
    assert.equal(JSON.parse(fs.readFileSync(fixture.storePath, 'utf8')).content.raw, 'Business Hunter notas uno.\n');
  } finally {
    cleanupFixture(fixture);
  }
});

test('a failed rename keeps the previous object intact and leaves no temporary file', () => {
  const fixture = createFixture();
  const originalRename = fs.renameSync;

  try {
    processKnowledgeDocument(fixture.document);
    const before = fs.readFileSync(fixture.storePath);
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');
    fs.renameSync = () => { throw Object.assign(new Error('simulated rename failure'), { code: 'EPERM' }); };

    assert.throws(() => processKnowledgeDocument(fixture.document, { allowUpdate: true }), /simulated rename failure/);
    fs.renameSync = originalRename;

    assert.deepEqual(fs.readFileSync(fixture.storePath), before);
    assert.deepEqual(tempFilesFor(fixture.storePath), []);
  } finally {
    fs.renameSync = originalRename;
    cleanupFixture(fixture);
  }
});

test('a failed temporary write keeps the previous object intact and leaves no temporary file', () => {
  const fixture = createFixture();
  const originalWrite = fs.writeFileSync;

  try {
    processKnowledgeDocument(fixture.document);
    const before = fs.readFileSync(fixture.storePath);
    fs.writeFileSync(fixture.documentPath, '# Guide\n\nVersion dos.\n', 'utf8');
    fs.writeFileSync = function failingWrite(target, ...rest) {
      if (String(target).endsWith('.tmp')) {
        originalWrite.call(fs, target, '{ parcial', 'utf8');
        throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
      }
      return originalWrite.call(fs, target, ...rest);
    };

    assert.throws(() => processKnowledgeDocument(fixture.document, { allowUpdate: true }), /simulated disk full/);
    fs.writeFileSync = originalWrite;

    assert.deepEqual(fs.readFileSync(fixture.storePath), before);
    assert.deepEqual(tempFilesFor(fixture.storePath), []);
  } finally {
    fs.writeFileSync = originalWrite;
    cleanupFixture(fixture);
  }
});
