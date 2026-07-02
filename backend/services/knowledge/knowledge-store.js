'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storeDirectory = path.resolve(__dirname, '../../data/knowledge-store/objects');

function ensureStoreDirectory() {
  fs.mkdirSync(storeDirectory, { recursive: true });
}

function buildKnowledgeObjectId(knowledgeObject) {
  const identityPath = knowledgeObject && knowledgeObject.identity
    ? knowledgeObject.identity.path
    : null;

  return crypto
    .createHash('sha1')
    .update(String(identityPath || (knowledgeObject && knowledgeObject.path) || ''))
    .digest('hex');
}

function getKnowledgeObjectPath(id) {
  return path.join(storeDirectory, `${id}.json`);
}

function saveKnowledgeObject(knowledgeObject) {
  ensureStoreDirectory();

  const id = buildKnowledgeObjectId(knowledgeObject);
  const storedKnowledgeObject = {
    ...knowledgeObject,
    id,
    storedAt: new Date().toISOString(),
  };
  const filePath = getKnowledgeObjectPath(id);

  fs.writeFileSync(filePath, JSON.stringify(storedKnowledgeObject, null, 2), 'utf8');

  return {
    saved: true,
    id,
    path: filePath,
  };
}

function getKnowledgeObject(id) {
  const filePath = getKnowledgeObjectPath(id);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function knowledgeObjectExists(id) {
  return fs.existsSync(getKnowledgeObjectPath(id));
}

module.exports = {
  saveKnowledgeObject,
  getKnowledgeObject,
  knowledgeObjectExists,
};
