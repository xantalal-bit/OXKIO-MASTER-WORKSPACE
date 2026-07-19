'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  getExecutiveStatus,
  getHealth,
} = require('./executive-status-provider');

const VALID_HEALTH = new Set(['healthy', 'warning', 'critical', 'unknown']);

test('returns a stable executive status contract', () => {
  const status = getExecutiveStatus({ operational: true, sources: [{ source: 'system' }] });

  assert.equal(status.title, 'Estado general');
  assert.equal(typeof status.summary, 'string');
  assert.ok(status.summary.length > 0);
  assert.equal(status.source, 'system');
  assert.equal(status.health, 'healthy');
  assert.equal(VALID_HEALTH.has(status.health), true);
});

test('classifies complete, degraded, critical, and unknown availability safely', () => {
  assert.equal(getHealth({ operational: true, sources: [{ source: 'system' }] }), 'healthy');
  assert.equal(getHealth({ operational: true, sources: [{ source: 'mock' }] }), 'warning');
  assert.equal(getHealth({ operational: true, sources: [{ source: 'fallback' }] }), 'warning');
  assert.equal(getHealth({ operational: true, sources: [{ available: false }] }), 'warning');
  assert.equal(getHealth({ operational: false, sources: [] }), 'critical');
  assert.equal(getHealth({ operational: true, criticalError: true }), 'critical');
  assert.equal(getHealth({ operational: true, sources: [] }), 'unknown');
  assert.equal(getHealth(), 'unknown');
  assert.equal(getHealth({}), 'unknown');
});

test('includes the aggregate ecosystem without escalating secondary degradation to critical', () => {
  const entry = (status = 'active') => ({
    source: 'knowledge-inventory', available: true, status,
  });
  const real = {
    businessHunter: entry(), xose: entry('inactive'), ecosystem: entry(),
  };
  const partial = { ...real, xose: entry('partial') };
  const unavailable = {
    ...real,
    ecosystem: { source: 'unavailable', available: false, status: 'unknown' },
  };
  const realSources = [
    { source: 'calendar', available: true },
    { source: 'gmail', available: true },
    { source: 'approval-queue', available: true },
    { source: 'runtime-memory' },
    real,
  ];

  assert.equal(getHealth({ operational: true, sources: realSources }), 'healthy');
  assert.equal(getHealth({ operational: true, sources: [partial] }), 'warning');
  assert.equal(getHealth({ operational: true, sources: [unavailable] }), 'warning');
  assert.equal(getHealth({ operational: true, sources: [{}] }), 'warning');
  assert.equal(getHealth({ operational: false, sources: [partial] }), 'critical');
  assert.equal(getHealth(), 'unknown');
});

test('dashboard composition derives health from existing source metadata', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'dashboard-intelligence.js'),
    'utf8',
  );

  assert.match(source, /getExecutiveStatus\(\{[\s\S]*operational:\s*true/);
  assert.match(source, /sources:\s*\[agenda, gmail, memory, automations, ecosystem\]/);
  ['greeting', 'agenda', 'gmail', 'memory', 'automations', 'ecosystem'].forEach((field) => {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  });
});

test('frontend maps all health values safely and updates only the status widget', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );

  assert.match(html, /healthy:\s*["']Operativo["']/);
  assert.match(html, /warning:\s*["']Atención["']/);
  assert.match(html, /critical:\s*["']Crítico["']/);
  assert.match(html, /unknown:\s*["']No disponible["']/);
  assert.match(html, /badge\.classList\.remove\(["']ok["'],\s*["']warn["'],\s*["']danger["']\)/);
  assert.match(html, /badge\.textContent\s*=\s*formatStatus\(status\)/);
  assert.doesNotMatch(html, /READY:\s*["']Activo["']/);
  assert.doesNotMatch(html, /health:\s*["']UNAVAILABLE["']/);
});

test('frontend starts with neutral status and recommendation placeholders', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const status = html.slice(html.indexOf('<h2>Estado general</h2>'), html.indexOf('<h2>Recomendación ejecutiva del día</h2>'));
  const recommendation = html.slice(html.indexOf('<h2>Recomendación ejecutiva del día</h2>'), html.indexOf('<h2>Entrada conversacional</h2>'));

  assert.match(status, /Pendiente de cargar/);
  assert.match(status, /Información no disponible/);
  assert.match(recommendation, /Pendiente de cargar/);
  assert.match(recommendation, /Información no disponible/);
  assert.doesNotMatch(`${status}${recommendation}`, /continúa siendo|empieza por|sin incidencias|estable/i);
  assert.match(html, /state\.executiveStatus\s*&&\s*state\.executiveStatus\.summary/);
  assert.doesNotMatch(html, />undefined</i);
});
