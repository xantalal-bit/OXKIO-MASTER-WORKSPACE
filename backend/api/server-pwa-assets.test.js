'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appPath = path.join(__dirname, '..', '..', 'app');
const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function readPngSize(filePath) {
  const image = fs.readFileSync(filePath);
  assert.deepEqual([...image.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20)
  };
}

test('serves the single manifest and its public icons through exact routes', () => {
  assert.match(serverSource, /req\.url === "\/manifest\.webmanifest"/);
  assert.match(serverSource, /"Content-Type": "application\/manifest\+json; charset=utf-8"/);
  assert.match(serverSource, /req\.url === "\/icons\/icon-192\.png"/);
  assert.match(serverSource, /req\.url === "\/icons\/icon-512\.png"/);
  assert.match(serverSource, /req\.url === "\/icons\/apple-touch-icon\.png"/);
  assert.doesNotMatch(serverSource, /startsWith\("\/app\/"\)/);
});

test('manifest keeps authenticated entry flow and declares exact PNG sizes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(appPath, 'manifest.webmanifest'), 'utf8'));

  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#020617');
  assert.equal(manifest.background_color, '#020617');
  assert.deepEqual(manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })), [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
  ]);
  assert.deepEqual(readPngSize(path.join(appPath, 'icons', 'icon-192.png')), { width: 192, height: 192 });
  assert.deepEqual(readPngSize(path.join(appPath, 'icons', 'icon-512.png')), { width: 512, height: 512 });
  assert.deepEqual(readPngSize(path.join(appPath, 'icons', 'apple-touch-icon.png')), { width: 180, height: 180 });
});

test('keeps approvals inside the private app and runs no pre-auth memory diagnostic', () => {
  const entry = fs.readFileSync(path.join(appPath, 'index.html'), 'utf8');
  const normalizedEntry = entry.replace(/\r\n/g, '\n');
  const appStart = normalizedEntry.indexOf('<div id="app" class="app-shell">');
  const approvalCenter = normalizedEntry.indexOf('<section id="approvalCenter"');
  const appEnd = normalizedEntry.indexOf('</div>\n\n  </div><button id="floatingVoiceBtn"');

  assert.ok(appStart >= 0);
  assert.ok(approvalCenter > appStart);
  assert.ok(appEnd > approvalCenter);
  assert.match(entry, /#loginBox, #app\{ display:none; \}/);
  assert.match(entry, /function showLogin\([^)]*\).*appBox\.style\.display = "none"/);
  assert.doesNotMatch(entry, /testOxkioMemory|memory_api\.php/);
});
