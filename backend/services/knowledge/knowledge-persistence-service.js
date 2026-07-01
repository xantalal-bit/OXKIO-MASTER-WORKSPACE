'use strict';

const crypto = require('crypto');
const { saveKnowledgeObject, knowledgeObjectExists } = require('./knowledge-store');

function buildKnowledgeObjectId(knowledgeObject) {
  return crypto
    .createHash('sha1')
    .update(String(knowledgeObject && knowledgeObject.path ? knowledgeObject.path : ''))
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
