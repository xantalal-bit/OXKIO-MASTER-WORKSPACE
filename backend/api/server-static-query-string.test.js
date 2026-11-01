'use strict';

// Boots the real server. The interface pages and their assets must be served
// when the URL carries a query string: a link pasted from a chat or an e-mail
// often gets "?utm_source=..." appended, and the exact match on req.url then
// answered {"ok":false,"error":"Endpoint no encontrado"} instead of the page.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const port = 40000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

async function waitFor(url, child, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { const r = await fetch(url); if (r.status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server not ready');
}

test('interface pages and assets are served with a query string, allowlists and API gate unchanged', async (t) => {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, PORT: String(port) };
  const child = spawn(process.execPath, ['backend/api/server.js'], { cwd: root, env, stdio: 'ignore', windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(`${base}/ready`, child);

  const pages = [
    ['/', /^text\/html/],
    ['/executive-chat.html', /^text\/html/],
    ['/executive-dashboard.html', /^text\/html/],
    ['/approvals', /^text\/html/],
    ['/js/executive-chat.js', /javascript/],
    ['/js/firebase-authenticated-fetch.js', /javascript/],
    ['/css/executive-chat.css', /^text\/css/],
    ['/manifest.webmanifest', /manifest\+json|json/],
    ['/icons/icon-192.png', /^image\/png/],
    ['/modules/projects/projectManager.js', /javascript/],
    ['/modules/strategic-intelligence/strategicAnalyzer.js', /javascript/]
  ];
  for (const [p, type] of pages) {
    const plain = await fetch(base + p);
    assert.equal(plain.status, 200, `${p} sin query`);
    const plainBody = Buffer.from(await plain.arrayBuffer());
    for (const q of ['?utm_source=chatgpt.com', '?a=1&b=2', '?']) {
      const r = await fetch(base + p + q);
      assert.equal(r.status, 200, `${p}${q}`);
      assert.match(r.headers.get('content-type') || '', type, `${p}${q} content-type`);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), plainBody, `${p}${q} mismo contenido`);
    }
  }

  // The query string never selects a file outside the allowlists.
  for (const p of ['/modules/strategic-intelligence/strategicAnalyzer.js/../../../package.json?x',
                   '/modules/memory/no-existe.js?utm_source=chatgpt.com',
                   '/index.html?utm_source=chatgpt.com']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }

  // The Firebase gate on /api/* is not affected.
  const api = await fetch(`${base}/api/status?utm_source=chatgpt.com`);
  assert.equal(api.status, 401);
  assert.equal(child.exitCode, null);
});
