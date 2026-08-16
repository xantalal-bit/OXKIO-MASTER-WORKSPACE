'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { orchestrateExecutiveQuery } = require('./executive-orchestrator');

const storeDirectory = path.resolve(__dirname, '../../data/knowledge-store/objects');

function createProjectDocument(root, projectFolder, fileName, content) {
  const folderPath = path.join(root, projectFolder);
  fs.mkdirSync(folderPath, { recursive: true });

  const filePath = path.join(folderPath, fileName);
  fs.writeFileSync(filePath, content, 'utf8');

  return filePath;
}

function createIntegrationFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'executive-brain-e2e-'));
  const documents = [
    createProjectDocument(
      root,
      'Learning Heroes',
      'learning-overview.md',
      '# Learning Heroes\n\nCurso de estrategia y entrenamiento.\n- Leccion 1\n- Tareas pendientes',
    ),
    createProjectDocument(
      root,
      'Learning Heroes',
      'learning-notes.txt',
      'Learning Heroes training notes and roadmap.',
    ),
    createProjectDocument(
      root,
      'Business Hunter',
      'business-hunter-roadmap.md',
      '# Business Hunter Roadmap\n\nDecisiones comerciales y prioridades.',
    ),
    createProjectDocument(
      root,
      'Business Hunter',
      'business-hunter-notes.txt',
      'Business Hunter tareas pendientes y action items.',
    ),
    createProjectDocument(
      root,
      'XANTALAL',
      'xantalal-governance.md',
      '# XANTALAL Governance\n\nReglas, estandares y compatibilidad.',
    ),
    createProjectDocument(
      root,
      'XANTALAL',
      'xantalal-registry.txt',
      'Governance registry and decision notes for XANTALAL.',
    ),
    createProjectDocument(
      root,
      'Oxkio',
      'oxkio-roadmap.md',
      '# Oxkio Roadmap\n\nFase 1, hito 1, plan y prioridades.',
    ),
    createProjectDocument(
      root,
      'Oxkio',
      'oxkio-notes.txt',
      'Oxkio roadmap notes and pending tasks.',
    ),
  ];

  return {
    root,
    documents,
  };
}

function getStorePathForDocument(documentPath) {
  const id = crypto
    .createHash('sha1')
    .update(documentPath)
    .digest('hex');

  return path.join(storeDirectory, `${id}.json`);
}

function cleanupIntegrationFixture(fixture) {
  fixture.documents
    .map(getStorePathForDocument)
    .forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
      }
    });

  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function assertOrderedSources(sources) {
  sources.forEach((source, index) => {
    assert.equal(source.rankingPosition, index + 1);
  });
}

function buildPrivateContext(overrides = {}) {
  return {
    clientId: 'client-alpha',
    userId: 'user-alpha',
    scope: 'private:user',
    sensitivity: 'confidential',
    sourceType: 'agenda-ficticia',
    sourceId: 'agenda-source-alpha',
    authorization: { status: 'granted' },
    purpose: 'executive-context',
    retentionPolicy: 'CLIENT_CONTROLLED',
    promotionPolicy: 'NEVER_PROMOTE',
    ...overrides,
  };
}

test('executes the full Executive Brain flow with ranking and response building', async () => {
  const fixture = createIntegrationFixture();

  try {
    const learningHeroes = await orchestrateExecutiveQuery('¿Qué aprendimos en Learning Heroes?', {
      knowledgeQueryOptions: {
        root: fixture.root,
      },
      simulationOptions: {
        storeDirectory,
      },
    });

    const businessHunter = await orchestrateExecutiveQuery('¿Qué decisiones existen sobre Business Hunter?', {
      knowledgeQueryOptions: {
        root: fixture.root,
      },
      simulationOptions: {
        storeDirectory,
      },
    });

    const xantalal = await orchestrateExecutiveQuery('¿Qué reglas de governance tiene XANTALAL?', {
      knowledgeQueryOptions: {
        root: fixture.root,
      },
      simulationOptions: {
        storeDirectory,
      },
    });

    const oxkio = await orchestrateExecutiveQuery('Muéstrame el roadmap de Oxkio', {
      knowledgeQueryOptions: {
        root: fixture.root,
      },
      simulationOptions: {
        storeDirectory,
      },
    });

    for (const result of [learningHeroes, businessHunter, xantalal, oxkio]) {
      assert.equal(typeof result.query, 'string');
      assert.equal(typeof result.response, 'string');
      assert.equal(typeof result.confidence, 'number');
      assert.ok(Array.isArray(result.sources));
      assert.ok(Array.isArray(result.limitations));
      assert.ok(result.response.includes('Evidencia principal'));
      assert.ok(result.response.includes('Confianza'));
      assert.ok(result.sources.length > 0);
      assert.equal(result.sources.some((source) => Object.hasOwn(source, 'path')), false);
      assertOrderedSources(result.sources);
      assert.ok(result.limitations.some((limitation) => limitation.includes('Simulation only')));
    }

    assert.equal(learningHeroes.analysis.project, 'Learning Heroes');
    assert.equal(businessHunter.analysis.project, 'Business Hunter');
    assert.equal(xantalal.analysis.project, 'XANTALAL');
    assert.equal(oxkio.analysis.project, 'Oxkio');

    assert.ok(learningHeroes.sources[0].type === 'Learning');
    assert.ok(businessHunter.sources[0].type === 'Roadmap' || businessHunter.sources[0].type === 'Notes');
    assert.equal(xantalal.sources[0].type, 'Governance');
    assert.equal(oxkio.sources[0].type, 'Roadmap');
  } finally {
    cleanupIntegrationFixture(fixture);
  }
});

test('executes Executive Brain flow with authorized private context without store writes', async () => {
  const emptyStore = fs.mkdtempSync(path.join(os.tmpdir(), 'executive-brain-private-store-'));
  const privatePayload = {
    events: [
      { title: 'Evento privado ficticio', date: '2026-07-04' },
      { title: 'Caducidad privada ficticia', date: '2026-07-05' },
    ],
  };

  try {
    const beforeFiles = fs.readdirSync(emptyStore);
    const result = await orchestrateExecutiveQuery('Prepara mi briefing privado de hoy', {
      privateContextMetadata: buildPrivateContext(),
      expectedClientId: 'client-alpha',
      privatePayload,
      simulationOptions: {
        storeDirectory: emptyStore,
      },
    });
    const afterFiles = fs.readdirSync(emptyStore);

    assert.equal(result.privateContextUsed, true);
    assert.ok(result.response.includes('Contexto privado autorizado considerado'));
    assert.equal(result.response.includes('Evento privado ficticio'), false);
    assert.equal(result.response.includes('Caducidad privada ficticia'), false);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(afterFiles, beforeFiles);
  } finally {
    fs.rmSync(emptyStore, { recursive: true, force: true });
  }
});
