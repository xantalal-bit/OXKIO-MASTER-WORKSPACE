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
  const status = getExecutiveStatus({ operational: true, sources: [] });

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
  assert.equal(getHealth(), 'unknown');
  assert.equal(getHealth({}), 'unknown');
});

test('dashboard composition derives health from existing source metadata', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'dashboard-intelligence.js'),
    'utf8',
  );

  assert.match(source, /getExecutiveStatus\(\{[\s\S]*operational:\s*true/);
  assert.match(source, /sources:\s*\[agenda, gmail, memory, automations\]/);
  ['greeting', 'agenda', 'gmail', 'memory', 'automations'].forEach((field) => {
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
