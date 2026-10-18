'use strict';

const crypto = require('crypto');
const { saveKnowledgeObject, getKnowledgeObject, knowledgeObjectExists } = require('./knowledge-store');

function buildKnowledgeObjectId(knowledgeObject) {
  const identityPath = knowledgeObject && knowledgeObject.identity
    ? knowledgeObject.identity.path
    : null;

  return crypto
    .createHash('sha1')
    .update(String(identityPath || (knowledgeObject && knowledgeObject.path) || ''))
    .digest('hex');
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
}

// Objetos antiguos sin identity.hash: el hash se deriva de content.raw para no reescribirlos sin cambios.
function resolveStoredHash(existing) {
  if (existing && existing.identity && existing.identity.hash) {
    return { hash: existing.identity.hash, source: 'identity' };
  }

  if (existing && existing.content && typeof existing.content.raw === 'string') {
    return { hash: hashContent(existing.content.raw), source: 'content' };
  }

  return { hash: null, source: null };
}

function readExisting(id) {
  try {
    return { existing: getKnowledgeObject(id), readable: true };
  } catch (error) {
    return { existing: null, readable: false };
  }
}

function persistKnowledgeObject(knowledgeObject, options = {}) {
  const id = buildKnowledgeObjectId(knowledgeObject);

  if (knowledgeObjectExists(id)) {
    const incomingHash = knowledgeObject && knowledgeObject.identity
      ? knowledgeObject.identity.hash
      : null;
    const { existing, readable } = readExisting(id);
    const stored = resolveStoredHash(existing);
    const changeDetected = readable && incomingHash && stored.hash
      ? stored.hash !== incomingHash
      : null;

    if (options.allowUpdate !== true) {
      return {
        persisted: false,
        reason: 'already-exists',
        changeDetected,
      };
    }

    if (!readable) {
      return {
        persisted: false,
        reason: 'existing-unreadable',
      };
    }

    if (!incomingHash || stored.hash === incomingHash) {
      return {
        persisted: false,
        reason: 'unchanged',
        id,
      };
    }

    const previousRevision = existing.revision && Number.isInteger(existing.revision.number)
      ? existing.revision.number
      : 0;

    return {
      ...saveKnowledgeObject({
        ...knowledgeObject,
        revision: {
          number: previousRevision + 1,
          previousHash: stored.hash,
          previousHashSource: stored.source,
          previousStoredAt: existing.storedAt || null,
          updatedAt: new Date().toISOString(),
        },
      }),
      updated: true,
      previousHash: stored.hash,
    };
  }

  return saveKnowledgeObject(knowledgeObject);
}

module.exports = {
  persistKnowledgeObject,
};
