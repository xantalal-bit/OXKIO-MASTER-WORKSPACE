'use strict';

// Boots the real server: GET /app/release.json is public and loaded by the UI
// on every page, so a fault in that route takes the whole runtime down.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const port = 39000 + Math.floor(Math.random() * 1000);

async function waitFor(url, child, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { const r = await fetch(url); if (r.status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server not ready');
}

test('public release metadata is served and the server survives the request', async (t) => {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, PORT: String(port) };
  const child = spawn(process.execPath, ['backend/api/server.js'], { cwd: root, env, stdio: 'ignore', windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(`http://127.0.0.1:${port}/ready`, child);

  const release = await fetch(`http://127.0.0.1:${port}/app/release.json`);
  assert.equal(release.status, 200);
  assert.match(release.headers.get('content-type'), /^application\/json/);
  assert.equal(typeof (await release.json()), 'object');

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal(child.exitCode, null);
});
