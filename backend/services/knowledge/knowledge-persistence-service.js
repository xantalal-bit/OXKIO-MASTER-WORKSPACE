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

function persistKnowledgeObject(knowledgeObject, options = {}) {
  const id = buildKnowledgeObjectId(knowledgeObject);

  if (knowledgeObjectExists(id)) {
    if (options.allowUpdate === true) {
      const existing = getKnowledgeObject(id);
      const existingHash = existing && existing.identity ? existing.identity.hash : null;
      const incomingHash = knowledgeObject && knowledgeObject.identity
        ? knowledgeObject.identity.hash
        : null;

      if (incomingHash && existingHash !== incomingHash) {
        return {
          ...saveKnowledgeObject(knowledgeObject),
          updated: true,
          previousHash: existingHash,
        };
      }
    }

    return {
      persisted: false,
      reason: 'already-exists',
    };
  }

  return saveKnowledgeObject(knowledgeObject);
}

module.exports = {
  persistKnowledgeObject,
};
