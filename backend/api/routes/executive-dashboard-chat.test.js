'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html');

function readDashboard() {
  return fs.readFileSync(dashboardPath, 'utf8');
}

function getChatScript(html) {
  const start = html.indexOf('let executiveChatSending');
  const end = html.indexOf('function findPanelByTitle', start);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

test('uses only the official executive chat POST contract', () => {
  const source = getChatScript(readDashboard());

  assert.match(source, /oxkioAuthenticatedFetch\(["']\/api\/executive\/chat["']/);
  assert.match(source, /method:\s*["']POST["']/);
  assert.match(source, /["']Content-Type["']:\s*["']application\/json["']/);
  assert.match(source, /body:\s*JSON\.stringify\(\{ query \}\)/);
  assert.doesNotMatch(source, /["']\/api\/chat["']/);
  ['dependencies', 'diagnostics', 'executionEnabled', 'privatePayload', 'payloadHash']
    .forEach((field) => assert.doesNotMatch(source, new RegExp(`JSON\\.stringify\\([^)]*${field}`)));
});

test('registers both click listeners and supports Enter without Shift', () => {
  const source = getChatScript(readDashboard());
  const clickListeners = source.match(/addEventListener\(["']click["']/g) || [];

  assert.equal(clickListeners.length, 2);
  assert.match(source, /addEventListener\(["']keydown["']/);
  assert.match(source, /event\.key\s*===\s*["']Enter["']\s*&&\s*!event\.shiftKey/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test('blocks empty and duplicate submissions before fetch and restores the button', () => {
  const source = getChatScript(readDashboard());
  const emptyGuard = source.indexOf('if (!query)');
  const duplicateGuard = source.indexOf('if (executiveChatSending) return');
  const fetchCall = source.indexOf('await window.oxkioAuthenticatedFetch');

  assert.ok(emptyGuard >= 0 && emptyGuard < fetchCall);
  assert.ok(duplicateGuard >= 0 && duplicateGuard < fetchCall);
  assert.match(source, /executiveChatSending\s*=\s*true/);
  assert.match(source, /button\.disabled\s*=\s*true/);
  assert.match(source, /Procesando…/);
  assert.match(source, /finally\s*\{[\s\S]*executiveChatSending\s*=\s*false[\s\S]*button\.disabled\s*=\s*false/);
});

test('renders only safe optional response metadata with textContent', () => {
  const source = getChatScript(readDashboard());

  assert.match(source, /typeof data\.response === ["']string["']/);
  assert.match(source, /data\.analysis && typeof data\.analysis === ["']object["']/);
  assert.match(source, /const proposal = data && data\.proposal \? data\.proposal : null/);
  assert.match(source, /const approval = data && data\.approval \? data\.approval : null/);
  assert.match(source, /Interaction ID:/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML/);
  ['sources', 'limitations', 'memory', 'privateContext', 'executionPayload', 'payloadHash', 'diagnostics']
    .forEach((field) => assert.doesNotMatch(source, new RegExp(`data\\.${field}\\b`)));
});

test('handles HTTP, network, invalid JSON, and absent optional fields safely', () => {
  const source = getChatScript(readDashboard());

  assert.match(source, /if \(!response\.ok\)/);
  assert.match(source, /status === 400/);
  assert.match(source, /status === 503/);
  assert.match(source, /await response\.json\(\)/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /No se pudo conectar con el servicio ejecutivo/);
  assert.doesNotMatch(source, /error\.message|error\.stack|JSON\.stringify\(data\)/);
});

test('keeps chat state in memory and leaves existing widgets present', () => {
  const html = readDashboard();
  const source = getChatScript(html);

  assert.doesNotMatch(source, /localStorage|sessionStorage|X-OXKIO-CSRF/);
  ['Estado general', 'Agenda', 'Compromisos Ejecutivos', 'Gmail', 'Memoria ejecutiva', 'Business Hunter', 'Xose', 'Estado del Ecosistema']
    .forEach((heading) => assert.match(html, new RegExp(`<h2>${heading}<\\/h2>`)));
});
