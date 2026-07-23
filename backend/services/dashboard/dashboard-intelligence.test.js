'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildBusinessHunterOperationView,
  buildEcosystemView,
} = require('./dashboard-intelligence');

const NOW = '2026-07-19T12:00:00.000Z';

function inventory(assets, generatedAt = NOW) {
  return {
    version: '1.0',
    generatedAt,
    summary: { totalFolders: assets.length, recognizedAssets: assets.length },
    assets,
    recommendation: { message: 'Internal recommendation' },
  };
}

function asset(name, overrides = {}) {
  return {
    name,
    recognized: true,
    status: 'recognized',
    domain: 'unknown',
    ...overrides,
  };
}

test('detects Business Hunter through supported aliases', () => {
  const aliases = [
    'BUSINESS-HUNTER',
    'Business Hunter',
    'Business',
    'captación',
    'leads',
    'prospección',
    'clientes',
  ];

  aliases.forEach((name) => {
    const view = buildEcosystemView(inventory([asset(name)]), { now: NOW });
    assert.equal(view.businessHunter.name, 'Business Hunter');
    assert.equal(view.businessHunter.items, 1);
    assert.equal(view.businessHunter.status, 'partial');
    assert.equal(view.businessHunter.available, true);
  });
});

test('detects Xose aliases while always exposing Xose as the public name', () => {
  const aliases = [
    'Xose',
    'Xose y OXI',
    'OXI',
    'divulgador IA',
    'comunicador IA',
    'comunicación IA',
    'contenido IA',
    'creador de contenido IA',
    'redes sociales',
  ];

  aliases.forEach((name) => {
    const view = buildEcosystemView(inventory([asset(name)]), { now: NOW });
    assert.equal(view.xose.name, 'Xose');
    assert.equal(view.xose.items, 1);
    assert.equal(view.xose.available, true);
    assert.match(view.xose.summary, /comunicación y divulgación IA/);
  });
});

test('legacy brand labels are excluded from detection and public output', () => {
  const retiredBusinessLabel = ['eco', 'Soft'].join('');
  const retiredXoseLabel = ['Pro', 'fesor IA'].join('');
  const view = buildEcosystemView(inventory([
    asset(retiredBusinessLabel),
    asset(retiredXoseLabel),
    asset('Xose divulgador IA'),
  ]), { now: NOW });
  const serialized = JSON.stringify(view);

  assert.equal(view.businessHunter.items, 0);
  assert.equal(view.xose.name, 'Xose');
  assert.equal(view.xose.items, 1);
  assert.equal(serialized.includes(retiredBusinessLabel), false);
  assert.equal(serialized.includes(retiredXoseLabel), false);
  assert.doesNotMatch(view.xose.summary, /docencia|enseñanza/i);
});

test('aggregates useful ecosystem items without returning inventory objects', () => {
  const view = buildEcosystemView(inventory([
    asset('OXKIO'),
    asset('XANTALAL'),
    asset('Business Hunter'),
    asset('Unclassified', { recognized: false, status: 'unclassified' }),
  ]), { now: NOW });

  assert.equal(view.ecosystem.name, 'XANTALAL');
  assert.equal(view.ecosystem.items, 3);
  assert.equal(typeof view.ecosystem.items, 'number');
  assert.ok(view.ecosystem.items >= 0);
  assert.deepEqual(Object.keys(view.ecosystem).sort(), [
    'available', 'items', 'name', 'source', 'status', 'summary', 'updatedAt',
  ]);
});

test('uses only valid existing dates and classifies recent, incomplete, old, inactive, and unknown data', () => {
  const recent = buildEcosystemView(inventory([
    asset('Business Hunter', { updatedAt: '2026-07-01T00:00:00.000Z' }),
  ]), { now: NOW });
  const old = buildEcosystemView(inventory([
    asset('Business Hunter', { updatedAt: '2020-01-01T00:00:00.000Z' }),
  ]), { now: NOW });
  const invalid = buildEcosystemView(inventory([
    asset('Business Hunter', { updatedAt: 'not-a-date' }),
  ]), { now: NOW });
  const inactive = buildEcosystemView(inventory([
    asset('Business Hunter', { recognized: false, status: 'inactive' }),
  ]), { now: NOW });
  const unknown = buildEcosystemView(inventory([asset('Unrelated')]), { now: NOW });

  assert.equal(recent.businessHunter.status, 'active');
  assert.equal(recent.businessHunter.updatedAt, '2026-07-01T00:00:00.000Z');
  assert.equal(old.businessHunter.status, 'partial');
  assert.equal(invalid.businessHunter.status, 'partial');
  assert.equal(invalid.businessHunter.updatedAt, null);
  assert.equal(inactive.businessHunter.status, 'inactive');
  assert.equal(unknown.businessHunter.status, 'unknown');
});

test('returns unavailable safe entries when knowledgeInventory is absent or invalid', () => {
  [null, undefined, {}, { assets: null }].forEach((value) => {
    const view = buildEcosystemView(value, { now: NOW });
    Object.values(view).forEach((entry) => {
      assert.equal(entry.available, false);
      assert.equal(entry.status, 'unknown');
      assert.equal(entry.summary, 'No disponible');
      assert.equal(entry.items, 0);
      assert.equal(entry.updatedAt, null);
      assert.equal(entry.source, 'unavailable');
    });
  });
});

test('preserves sanitized Business Hunter readonly findings for the Executive Dashboard', () => {
  const opportunity = {
    id: 'document-1',
    title: 'Documento relevante',
    summary: 'Elemento relevante identificado en el inventario local.',
    confidence: 0.75,
    evidenceCount: 2,
    source: 'knowledge-pipeline',
  };
  const view = buildBusinessHunterOperationView({
    activeOperation: null,
    recentOperations: [{
      status: 'completed',
      phase: 'completed',
      sourceStatus: 'real',
      resultSummary: 'Business Hunter ha devuelto evidencia local.',
      result: {
        opportunities: [opportunity],
        recommendations: ['Revisar la evidencia sanitizada.'],
      },
      errors: [],
    }],
  });

  assert.equal(view.sourceStatus, 'real');
  assert.equal(view.opportunitiesCount, 1);
  assert.deepEqual(view.opportunities, [opportunity]);
  assert.deepEqual(view.recommendations, ['Revisar la evidencia sanitizada.']);
});

test('marks missing Business Hunter source data unavailable and explains why', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      status: 'completed_with_warnings',
      phase: 'completed',
      sourceStatus: null,
      result: { opportunities: [], recommendations: [] },
    }],
  });

  assert.equal(view.sourceStatus, 'unavailable');
  assert.equal(view.opportunitiesCount, 0);
  assert.deepEqual(view.opportunities, []);
  assert.deepEqual(view.recommendations, []);
  assert.match(view.summary, /no ha proporcionado datos de fuente disponibles/i);
});

test('projects Knowledge results through the same operations view without exposing documents', () => {
  const view = buildBusinessHunterOperationView({
    activeOperation: null,
    recentOperations: [{
      worker: 'knowledge-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Conocimiento revisado.', durationMs: 20,
      result: { summary: 'Conocimiento revisado.', itemsCount: 3, topics: ['Gobernanza'], recommendations: ['Revisar temas.'] },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'knowledge-readonly');
  assert.equal(view.itemsCount, 3);
  assert.deepEqual(view.topics, ['Gobernanza']);
  assert.equal(JSON.stringify(view).includes('document'), false);
});

test('projects Memory results through the common operations view without exposing private records', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      worker: 'memory-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Memoria revisada.', durationMs: 20,
      result: { summary: 'Memoria revisada.', itemsCount: 2, topics: ['Decisiones'], recommendations: ['Revisar temas.'] },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'memory-readonly');
  assert.equal(view.itemsCount, 2);
  assert.deepEqual(view.topics, ['Decisiones']);
  assert.equal(JSON.stringify(view).includes('content'), false);
});

test('projects Gmail results through the common operations view without exposing provider metadata', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      worker: 'gmail-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Correo revisado.', durationMs: 20,
      result: {
        summary: 'Correo revisado.', emailsCount: 2,
        relevantItems: [{ sender: 'Equipo', subject: 'Revisión', summary: 'Requiere atención.' }],
        recommendations: ['Revisar asunto.'],
      },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'gmail-readonly');
  assert.equal(view.emailsCount, 2);
  assert.deepEqual(view.relevantItems, [{
    sender: 'Equipo', subject: 'Revisión', summary: 'Requiere atención.',
  }]);
  ['id', 'token', 'headers', 'body', 'attachment'].forEach(
    (forbidden) => assert.equal(JSON.stringify(view).includes(forbidden), false),
  );
});

test('projects Calendar results through the common operations view without exposing provider metadata', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      worker: 'calendar-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Agenda revisada.', durationMs: 20,
      result: {
        summary: 'Agenda revisada.', eventsCount: 2,
        relevantItems: [{
          title: 'Reunión', date: '23 jul 2026', time: '10:00',
          location: 'Sala', conflict: true,
        }],
        recommendations: ['Revisar solapamiento.'],
      },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'calendar-readonly');
  assert.equal(view.eventsCount, 2);
  assert.deepEqual(view.relevantItems, [{
    title: 'Reunión', date: '23 jul 2026', time: '10:00',
    location: 'Sala', conflict: true,
  }]);
  ['id', 'token', 'link', 'description', 'attendees'].forEach(
    (forbidden) => assert.equal(JSON.stringify(view).includes(forbidden), false),
  );
});

test('never exposes paths, filenames, private content, or complete inventory assets', () => {
  const view = buildEcosystemView(inventory([asset('Business Hunter', {
    path: 'C:\\private\\Business Hunter\\secret.md',
    fileName: 'secret.md',
    content: 'private-content',
    updatedAt: '2026-07-01T00:00:00.000Z',
  })]), { now: NOW });
  const serialized = JSON.stringify(view);

  ['C:\\private', 'secret.md', 'private-content', 'path', 'fileName', 'content']
    .forEach((forbidden) => assert.equal(serialized.includes(forbidden), false));
});

test('dashboard reuses the existing inventory once and preserves its surrounding contract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard-intelligence.js'), 'utf8');
  const discoveryCalls = source.match(/discoverKnowledge\(\)/g) || [];

  assert.equal(discoveryCalls.length, 1);
  assert.match(source, /const ecosystem = buildEcosystemView\(knowledgeInventory\)/);
  assert.match(source, /knowledgeInventory,\s*ecosystem/);
  ['greeting', 'executiveStatus', 'agenda', 'gmail', 'memory', 'automations', 'executiveBriefing', 'morningBriefing']
    .forEach((field) => assert.match(source, new RegExp(`\\b${field}\\b`)));
});

test('frontend renders only the three ecosystem widgets with safe DOM operations', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function formatEcosystemStatus');
  const end = html.indexOf('function formatAgendaSourceBadge', start);
  const renderer = html.slice(start, end);

  assert.match(renderer, /active:\s*["']Activo["']/);
  assert.match(renderer, /partial:\s*["']Parcial["']/);
  assert.match(renderer, /inactive:\s*["']Inactivo["']/);
  assert.match(renderer, /unknown:\s*["']No disponible["']/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(html, /data-ecosystem-widget="businessHunter"[\s\S]*?<h2>Business Hunter<\/h2>/);
  assert.match(html, /data-ecosystem-widget="xose"[\s\S]*?<h2>Xose<\/h2>/);
  assert.match(html, /data-ecosystem-widget="ecosystem"[\s\S]*?<h2>Estado del Ecosistema<\/h2>/);
  assert.doesNotMatch(html, /data-ecosystem-widget="businessHunter"[\s\S]{0,200}<h2>Gmail<\/h2>/);
  assert.match(html, /<h2>Xose<\/h2>/);
  ['Gmail', 'Agenda', 'Memoria ejecutiva', 'Compromisos Ejecutivos']
    .forEach((heading) => assert.match(html, new RegExp(`<h2>${heading}<\\/h2>`)));
});
