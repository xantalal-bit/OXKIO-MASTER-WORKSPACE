'use strict';

const fs = require('fs');
const path = require('path');

const defaultStoreDirectory = path.resolve(__dirname, '../../data/knowledge-store/objects');

const queryProfiles = [
  {
    type: 'Learning Heroes',
    keywords: ['learning heroes', 'learning', 'curso', 'modulo', 'leccion', 'training'],
    documentTypes: ['Learning'],
  },
  {
    type: 'Roadmap',
    keywords: ['roadmap', 'fase', 'hito', 'plan', 'prioridad'],
    documentTypes: ['Roadmap'],
  },
  {
    type: 'Governance',
    keywords: ['governance', 'gobierno', 'regla', 'decision', 'estandar'],
    documentTypes: ['Governance'],
  },
  {
    type: 'Pending Tasks',
    keywords: ['tarea', 'pendiente', 'pendientes', 'accion', 'action item', 'hacer'],
    documentTypes: ['Meeting', 'Roadmap', 'Notes', 'Governance'],
  },
  {
    type: 'Documentation',
    keywords: ['documentacion', 'documentation', 'docs', 'readme', 'guia', 'manual'],
    documentTypes: ['Documentation'],
  },
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function readKnowledgeObjects(options) {
  const storeDirectory = options && options.storeDirectory
    ? options.storeDirectory
    : defaultStoreDirectory;

  if (!fs.existsSync(storeDirectory)) {
    return [];
  }

  return fs
    .readdirSync(storeDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(storeDirectory, entry.name))
    .map((filePath) => {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function detectQueryProfile(query) {
  const normalizedQuery = normalizeText(query);
  const matchedProfile = queryProfiles.find((profile) => (
    profile.keywords.some((keyword) => normalizedQuery.includes(normalizeText(keyword)))
  ));

  return matchedProfile || {
    type: 'Generic',
    keywords: normalizedQuery.split(/\s+/).filter(Boolean),
    documentTypes: [],
  };
}

function getDocumentType(knowledgeObject) {
  return knowledgeObject
    && knowledgeObject.metadata
    && knowledgeObject.metadata.documentTypeClassification
    ? knowledgeObject.metadata.documentTypeClassification.type
    : null;
}

function flattenStructureText(knowledgeObject) {
  const structure = knowledgeObject
    && knowledgeObject.metadata
    ? knowledgeObject.metadata.documentStructure
    : null;

  if (!structure) {
    return '';
  }

  return [
    ...(Array.isArray(structure.headings) ? structure.headings.map((heading) => heading.title) : []),
    ...(Array.isArray(structure.lists) ? structure.lists.map((item) => item.text) : []),
    ...(Array.isArray(structure.links) ? structure.links.map((link) => link.url) : []),
    ...(Array.isArray(structure.codeBlocks) ? structure.codeBlocks.map((block) => block.code) : []),
  ].filter(Boolean).join(' ');
}

function scoreKnowledgeObject(knowledgeObject, query, profile) {
  const normalizedQuery = normalizeText(query);
  const queryTerms = normalizedQuery.split(/\s+/).filter((term) => term.length > 2);
  const documentType = getDocumentType(knowledgeObject);
  const name = normalizeText(knowledgeObject && knowledgeObject.identity ? knowledgeObject.identity.name : '');
  const raw = normalizeText(knowledgeObject && knowledgeObject.content ? knowledgeObject.content.raw : '');
  const structure = normalizeText(flattenStructureText(knowledgeObject));
  const reasons = [];
  let score = 0;

  if (documentType && profile.documentTypes.includes(documentType)) {
    score += 5;
    reasons.push(`documentTypeClassification matched ${documentType}`);
  }

  queryTerms.forEach((term) => {
    if (name.includes(term)) {
      score += 3;
      reasons.push(`identity.name matched "${term}"`);
    }

    if (raw.includes(term)) {
      score += 1;
      reasons.push(`content.raw matched "${term}"`);
    }

    if (structure.includes(term)) {
      score += 2;
      reasons.push(`metadata.documentStructure matched "${term}"`);
    }
  });

  return {
    knowledgeObject,
    score,
    reasons: Array.from(new Set(reasons)),
  };
}

function buildSource(match) {
  const knowledgeObject = match.knowledgeObject;
  const identity = knowledgeObject.identity || {};

  return {
    id: knowledgeObject.id || identity.id || null,
    name: identity.name || null,
    path: identity.path || null,
    type: getDocumentType(knowledgeObject) || 'Unknown',
    score: match.score,
    reasons: match.reasons,
  };
}

function buildAnswer(query, profile, matches) {
  if (matches.length === 0) {
    return `No se encontraron Knowledge Objects relevantes para "${query}" en el Knowledge Store.`;
  }

  const topSources = matches.slice(0, 3).map((match) => buildSource(match));
  const names = topSources.map((source) => source.name).filter(Boolean).join(', ');

  return `Consulta simulada sobre ${profile.type}. Se encontraron ${matches.length} Knowledge Objects relevantes. Fuentes principales: ${names || 'sin nombre disponible'}.`;
}

function calculateConfidence(matches) {
  if (matches.length === 0) {
    return 0.2;
  }

  const topScore = matches[0].score;
  const confidence = 0.35 + Math.min(topScore, 10) * 0.05 + Math.min(matches.length, 5) * 0.03;

  return Number(Math.min(confidence, 0.9).toFixed(2));
}

function simulateExecutiveBrainQuery(query, options) {
  const knowledgeObjects = readKnowledgeObjects(options);
  const profile = detectQueryProfile(query);
  const matches = knowledgeObjects
    .map((knowledgeObject) => scoreKnowledgeObject(knowledgeObject, query, profile))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
  const sources = matches.slice(0, 5).map(buildSource);

  return {
    query,
    answer: buildAnswer(query, profile, matches),
    confidence: calculateConfidence(matches),
    sources,
    reasoningSummary: {
      queryType: profile.type,
      knowledgeObjectsRead: knowledgeObjects.length,
      matchesFound: matches.length,
      rankingSignals: [
        'documentTypeClassification',
        'identity.name',
        'content.raw',
        'metadata.documentStructure',
      ],
    },
    limitations: [
      ...(matches.length === 0 ? ['No sufficient evidence was found in the Knowledge Store.'] : []),
      'Simulation only: this is not the definitive Executive Brain.',
      'No AI is used.',
      'Only persisted Knowledge Objects are read.',
      'Answers are based on deterministic keyword and metadata matching.',
    ],
  };
}

module.exports = {
  readKnowledgeObjects,
  simulateExecutiveBrainQuery,
};
