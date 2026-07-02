'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { simulateExecutiveBrainQuery } = require('./executive-brain-simulation');

function createKnowledgeObjectFixture({ id, name, type, raw, headings, lists }) {
  return {
    id,
    storedAt: '2026-07-02T10:00:00.000Z',
    identity: {
      id: null,
      source: null,
      sourceType: null,
      path: `fixtures/${name}`,
      name,
      extension: '.md',
      hash: null,
      version: '2.0',
    },
    technical: {
      size: raw.length,
      createdAt: '2026-07-02T10:00:00.000Z',
      modifiedAt: '2026-07-02T10:00:00.000Z',
      indexedAt: null,
      language: null,
      encoding: 'utf8',
    },
    content: {
      raw,
      summary: null,
      keywords: [],
    },
    strategy: {
      ecosystem: null,
      primaryProject: null,
      secondaryProjects: [],
      strategicArea: null,
      priority: null,
      roadmapPhase: null,
    },
    metadata: {
      generatedBy: 'test-fixture',
      generatedAt: '2026-07-02T10:00:00.000Z',
      reviewed: false,
      reviewer: null,
      documentTypeClassification: {
        type,
        confidence: 0.9,
        reasons: [],
        signals: {},
      },
      documentStructure: {
        headings: headings.map((title, index) => ({ level: index + 1, title })),
        lists: lists.map((text) => ({ text })),
        links: [],
        tables: [],
        codeBlocks: [],
      },
    },
  };
}

function createStoreFixture() {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'executive-brain-simulation-'));
  const fixtures = [
    createKnowledgeObjectFixture({
      id: 'learning-1',
      name: 'learning-heroes-module.md',
      type: 'Learning',
      raw: 'Learning Heroes curso modulo estrategia entrenamiento.',
      headings: ['Learning Heroes Module'],
      lists: ['Curso de estrategia'],
    }),
    createKnowledgeObjectFixture({
      id: 'roadmap-1',
      name: 'MASTER-ROADMAP-XANTALAL.md',
      type: 'Roadmap',
      raw: 'Roadmap fase 1 estado en curso tareas pendientes.',
      headings: ['Master Roadmap', 'Fase 1'],
      lists: ['Tarea pendiente de Knowledge Platform'],
    }),
    createKnowledgeObjectFixture({
      id: 'governance-1',
      name: 'KNOWLEDGE_OBJECT_STANDARD.md',
      type: 'Governance',
      raw: 'Gobierno regla estandar decision compatibilidad.',
      headings: ['Knowledge Object Standard'],
      lists: ['Regla de compatibilidad'],
    }),
    createKnowledgeObjectFixture({
      id: 'documentation-1',
      name: 'README.md',
      type: 'Documentation',
      raw: 'Documentacion guia README uso configuracion.',
      headings: ['README'],
      lists: ['Guia de uso'],
    }),
  ];

  fixtures.forEach((fixture) => {
    fs.writeFileSync(
      path.join(storeDirectory, `${fixture.id}.json`),
      JSON.stringify(fixture, null, 2),
      'utf8',
    );
  });

  return storeDirectory;
}

function cleanupStoreFixture(storeDirectory) {
  fs.rmSync(storeDirectory, { recursive: true, force: true });
}

test('returns the required simulation response contract', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('Learning Heroes', { storeDirectory });

    assert.equal(result.query, 'Learning Heroes');
    assert.equal(typeof result.answer, 'string');
    assert.equal(typeof result.confidence, 'number');
    assert.ok(Array.isArray(result.sources));
    assert.equal(typeof result.reasoningSummary, 'object');
    assert.ok(Array.isArray(result.limitations));
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('supports Learning Heroes queries', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('Que sabemos de Learning Heroes?', { storeDirectory });

    assert.equal(result.reasoningSummary.queryType, 'Learning Heroes');
    assert.equal(result.sources[0].type, 'Learning');
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('orders sources by ranking when multiple documents match', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('Learning Heroes roadmap', { storeDirectory });

    assert.ok(result.sources.length >= 2);
    assert.equal(result.sources[0].type, 'Learning');
    assert.equal(result.sources[0].rankingPosition, 1);
    assert.ok(result.sources[0].score >= result.sources[1].score);
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('supports Roadmap queries', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('Resumen del roadmap', { storeDirectory });

    assert.equal(result.reasoningSummary.queryType, 'Roadmap');
    assert.equal(result.sources[0].type, 'Roadmap');
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('supports Governance queries', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('Reglas de governance', { storeDirectory });

    assert.equal(result.reasoningSummary.queryType, 'Governance');
    assert.equal(result.sources[0].type, 'Governance');
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('supports pending task queries', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('tareas pendientes', { storeDirectory });

    assert.equal(result.reasoningSummary.queryType, 'Pending Tasks');
    assert.equal(result.sources[0].type, 'Roadmap');
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('supports documentation queries', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('documentacion tecnica', { storeDirectory });

    assert.equal(result.reasoningSummary.queryType, 'Documentation');
    assert.equal(result.sources[0].type, 'Documentation');
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});

test('returns low confidence and no sources when no results are found', () => {
  const storeDirectory = createStoreFixture();

  try {
    const result = simulateExecutiveBrainQuery('consulta inexistente para validar respuesta sin resultados', { storeDirectory });

    assert.equal(result.query, 'consulta inexistente para validar respuesta sin resultados');
    assert.equal(typeof result.answer, 'string');
    assert.equal(result.confidence, 0.2);
    assert.deepEqual(result.sources, []);
    assert.equal(typeof result.reasoningSummary, 'object');
    assert.equal(result.reasoningSummary.matchesFound, 0);
    assert.ok(Array.isArray(result.limitations));
    assert.ok(result.limitations.some((limitation) => (
      limitation.toLowerCase().includes('no sufficient evidence')
    )));
  } finally {
    cleanupStoreFixture(storeDirectory);
  }
});
