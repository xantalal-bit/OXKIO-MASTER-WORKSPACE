'use strict';

const crypto = require('crypto');
const { saveKnowledgeObject, knowledgeObjectExists } = require('./knowledge-store');

function buildKnowledgeObjectId(knowledgeObject) {
  const identityPath = knowledgeObject && knowledgeObject.identity
    ? knowledgeObject.identity.path
    : null;

  return crypto
    .createHash('sha1')
    .update(String(identityPath || (knowledgeObject && knowledgeObject.path) || ''))
    .digest('hex');
}

function persistKnowledgeObject(knowledgeObject) {
  const id = buildKnowledgeObjectId(knowledgeObject);

  if (knowledgeObjectExists(id)) {
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
