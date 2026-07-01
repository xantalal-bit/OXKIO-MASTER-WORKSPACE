'use strict';

let knowledgeSources;
let knowledgeIndexer;
let knowledgeClassifier;
let knowledgeRegistry;

const initialRegistrySources = [
  {
    id: 'onedrive',
    name: 'OneDrive',
    type: 'cloud-storage',
    category: 'documents',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 80,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    type: 'cloud-storage',
    category: 'documents',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 80,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'google-one',
    name: 'Google One',
    type: 'cloud-storage',
    category: 'backups',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 60,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    type: 'email',
    category: 'communications',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 70,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'discord',
    name: 'Discord',
    type: 'chat',
    category: 'communications',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 50,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    type: 'chat',
    category: 'communications',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 50,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'local-documents',
    name: 'Local Documents',
    type: 'local-storage',
    category: 'documents',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 70,
    sensitivity: 'private',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'learning-heroes',
    name: 'Learning Heroes',
    type: 'knowledge-base',
    category: 'education',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 65,
    sensitivity: 'internal',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'university',
    name: 'University',
    type: 'knowledge-base',
    category: 'education',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 65,
    sensitivity: 'internal',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'prompts',
    name: 'Prompts',
    type: 'repository',
    category: 'ai-operations',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 75,
    sensitivity: 'internal',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'github',
    name: 'GitHub',
    type: 'code-hosting',
    category: 'development',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 75,
    sensitivity: 'internal',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'lucushost',
    name: 'LucusHost',
    type: 'hosting',
    category: 'infrastructure',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 70,
    sensitivity: 'confidential',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'business-hunter',
    name: 'Business Hunter',
    type: 'business-system',
    category: 'operations',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 70,
    sensitivity: 'confidential',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'ecosoft',
    name: 'Ecosoft',
    type: 'business-system',
    category: 'operations',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 70,
    sensitivity: 'confidential',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'oxkio',
    name: 'OXKIO',
    type: 'workspace',
    category: 'project',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 90,
    sensitivity: 'internal',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
  {
    id: 'xantalal-governance',
    name: 'XANTALAL Governance',
    type: 'governance',
    category: 'policy',
    owner: 'xantalal',
    scope: 'registered-only',
    priority: 95,
    sensitivity: 'confidential',
    enabled: false,
    status: 'registered',
    agent: 'knowledge-runtime',
    lastSync: null,
  },
];

function createRuntimeMock(name) {
  return {
    version: '1.0',
    status: 'ready',
    name,
  };
}

function getKnowledgeSources() {
  if (!knowledgeSources) {
    knowledgeSources = {
      version: '1.0',
      status: 'ready',
      sources: [],
    };
  }

  return knowledgeSources;
}

function getKnowledgeIndexer() {
  if (!knowledgeIndexer) {
    knowledgeIndexer = createRuntimeMock('knowledge-indexer');
  }

  return knowledgeIndexer;
}

function getKnowledgeClassifier() {
  if (!knowledgeClassifier) {
    knowledgeClassifier = createRuntimeMock('knowledge-classifier');
  }

  return knowledgeClassifier;
}

function getKnowledgeRegistry() {
  if (!knowledgeRegistry) {
    knowledgeRegistry = {
      version: '1.0',
      status: 'ready',
      registry: initialRegistrySources,
    };
  }

  return knowledgeRegistry;
}

module.exports = {
  getKnowledgeSources,
  getKnowledgeIndexer,
  getKnowledgeClassifier,
  getKnowledgeRegistry,
};
