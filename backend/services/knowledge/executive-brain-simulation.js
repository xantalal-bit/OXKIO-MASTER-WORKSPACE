'use strict';

const fs = require('fs');
const path = require('path');
const { rankKnowledgeObjects } = require('./knowledge-ranking-engine');

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

const stopWords = new Set([
  'a',
  'al',
  'como',
  'con',
  'de',
  'del',
  'el',
  'en',
  'es',
  'esa',
  'ese',
  'eso',
  'esta',
  'este',
  'esto',
  'existe',
  'existen',
  'la',
  'las',
  'lo',
  'los',
  'me',
  'para',
  'por',
  'que',
  'sin',
  'sobre',
  'un',
  'una',
  'y',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractQueryTerms(query) {
  return normalizeText(query)
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .filter((term) => !stopWords.has(term));
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

function getKnowledgeObjectId(knowledgeObject) {
  const identity = knowledgeObject && knowledgeObject.identity ? knowledgeObject.identity : {};

  return knowledgeObject.id
    || identity.id
    || identity.path
    || null;
}

function buildRankingOptions(query, profile) {
  return {
    query,
    documentTypes: profile && Array.isArray(profile.documentTypes) ? profile.documentTypes : [],
    keywords: profile && Array.isArray(profile.keywords) ? profile.keywords : [],
    structureTerms: profile && Array.isArray(profile.keywords) ? profile.keywords : [],
  };
}

function buildSource(rankedEntry, knowledgeObject) {
  const identity = knowledgeObject.identity || {};

  return {
    id: rankedEntry.id || getKnowledgeObjectId(knowledgeObject),
    name: identity.name || null,
    path: identity.path || null,
    type: getDocumentType(knowledgeObject) || 'Unknown',
    score: rankedEntry.score,
    rankingPosition: rankedEntry.rankingPosition,
    reasons: rankedEntry.reasons,
  };
}

function buildAnswer(query, profile, rankedMatches) {
  if (rankedMatches.length === 0) {
    return `No se encontraron Knowledge Objects relevantes para "${query}" en el Knowledge Store.`;
  }

  const topSources = rankedMatches.slice(0, 3).map((match) => match.source);
  const names = topSources.map((source) => source.name).filter(Boolean).join(', ');

  return `Consulta simulada sobre ${profile.type}. Se encontraron ${rankedMatches.length} Knowledge Objects relevantes. Fuentes principales: ${names || 'sin nombre disponible'}.`;
}

function calculateConfidence(rankedMatches) {
  if (rankedMatches.length === 0) {
    return 0.2;
  }

  const topScore = rankedMatches[0].score;
  const confidence = 0.35 + Math.min(topScore, 10) * 0.05 + Math.min(rankedMatches.length, 5) * 0.03;

  return Number(Math.min(confidence, 0.9).toFixed(2));
}

function simulateExecutiveBrainQuery(query, options) {
  const knowledgeObjects = readKnowledgeObjects(options);
  const profile = detectQueryProfile(query);
  const rankedObjects = rankKnowledgeObjects(knowledgeObjects, buildRankingOptions(query, profile));
  const knowledgeObjectById = new Map(
    knowledgeObjects.map((knowledgeObject) => [getKnowledgeObjectId(knowledgeObject), knowledgeObject]),
  );
  const rankedMatches = rankedObjects
    .filter((entry) => entry.score > 0)
    .map((entry) => ({
      ...entry,
      source: buildSource(entry, knowledgeObjectById.get(entry.id) || {}),
    }));
  const sources = rankedMatches.slice(0, 5).map((entry) => entry.source);

  return {
    query,
    answer: buildAnswer(query, profile, rankedMatches),
    confidence: calculateConfidence(rankedMatches),
    sources,
    reasoningSummary: {
      queryType: profile.type,
      knowledgeObjectsRead: knowledgeObjects.length,
      matchesFound: rankedMatches.length,
      rankingSignals: [
        'knowledge-ranking-engine',
        'documentTypeClassification',
        'identity.name',
        'content.raw',
        'metadata.documentStructure',
      ],
    },
    limitations: [
      ...(rankedMatches.length === 0 ? ['No sufficient evidence was found in the Knowledge Store.'] : []),
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
