'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rankKnowledgeObjects } = require('./knowledge-ranking-engine');

function createKnowledgeObject({
  id,
  name,
  project,
  documentType,
  keywords = [],
  headings = [],
  raw = '',
}) {
  return {
    id,
    identity: {
      id,
      name,
      path: `fixtures/${name}`,
    },
    content: {
      raw,
      keywords,
    },
    strategy: {
      primaryProject: project,
      secondaryProjects: [],
    },
    metadata: {
      documentTypeClassification: {
        type: documentType,
      },
      documentStructure: {
        headings: headings.map((title) => ({ title })),
        lists: [],
        links: [],
        tables: [],
        codeBlocks: [],
      },
    },
  };
}

test('returns an empty list for empty input', () => {
  assert.deepEqual(rankKnowledgeObjects([]), []);
});

test('orders objects by score from highest to lowest', () => {
  const ranked = rankKnowledgeObjects([
    createKnowledgeObject({
      id: 'low',
      name: 'Notes',
      project: 'Oxkio',
      documentType: 'Notes',
      keywords: ['general'],
      raw: 'general content',
    }),
    createKnowledgeObject({
      id: 'high',
      name: 'Learning Heroes Roadmap',
      project: 'Learning Heroes',
      documentType: 'Roadmap',
      keywords: ['learning heroes', 'roadmap'],
      headings: ['Learning Heroes Roadmap'],
      raw: 'Learning Heroes roadmap strategy and milestones.',
    }),
  ], {
    query: 'Learning Heroes roadmap',
    project: 'Learning Heroes',
    documentTypes: ['Roadmap'],
    keywords: ['learning heroes', 'roadmap'],
    structureTerms: ['Learning Heroes Roadmap'],
  });

  assert.equal(ranked[0].id, 'high');
  assert.equal(ranked[0].rankingPosition, 1);
  assert.equal(ranked[1].id, 'low');
  assert.equal(ranked[1].rankingPosition, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('breaks ties deterministically by id', () => {
  const ranked = rankKnowledgeObjects([
    createKnowledgeObject({
      id: 'b-object',
      name: 'Shared Note',
      project: 'Oxkio',
      documentType: 'Notes',
      raw: 'shared note content',
    }),
    createKnowledgeObject({
      id: 'a-object',
      name: 'Shared Note',
      project: 'Oxkio',
      documentType: 'Notes',
      raw: 'shared note content',
    }),
  ], {
    query: 'shared note',
  });

  assert.equal(ranked[0].id, 'a-object');
  assert.equal(ranked[1].id, 'b-object');
  assert.equal(ranked[0].score, ranked[1].score);
});

test('handles exact matches with the strongest score', () => {
  const ranked = rankKnowledgeObjects([
    createKnowledgeObject({
      id: 'partial',
      name: 'Learning Heroes Notes',
      project: 'Learning Heroes',
      documentType: 'Notes',
      keywords: ['training'],
      raw: 'Learning content',
    }),
    createKnowledgeObject({
      id: 'exact',
      name: 'Learning Heroes',
      project: 'Learning Heroes',
      documentType: 'Learning',
      keywords: ['learning heroes', 'curso'],
      headings: ['Learning Heroes'],
      raw: 'Learning Heroes curso modulo entrenamiento.',
    }),
  ], {
    query: 'Learning Heroes',
    project: 'Learning Heroes',
    documentTypes: ['Learning'],
    keywords: ['learning heroes'],
    structureTerms: ['Learning Heroes'],
  });

  assert.equal(ranked[0].id, 'exact');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].reasons.length > 0);
});

test('handles partial matches and records reasons', () => {
  const ranked = rankKnowledgeObjects([
    createKnowledgeObject({
      id: 'partial-match',
      name: 'Oxkio Executive Notes',
      project: 'Oxkio',
      documentType: 'Documentation',
      keywords: ['governance', 'roadmap'],
      headings: ['Execution Notes'],
      raw: 'Oxkio roadmap governance summary.',
    }),
  ], {
    query: 'roadmap governance',
    keywords: ['roadmap'],
    structureTerms: ['Execution Notes'],
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'partial-match');
  assert.ok(ranked[0].score > 0);
  assert.ok(ranked[0].reasons.some((reason) => reason.includes('partial match')));
});
