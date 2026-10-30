'use strict';

// Precondition for any future allUsers invoker on Cloud Run: boots the real
// server and proves that every private route answers an anonymous caller with
// an authentication error and no data. Routes are read from the source on each
// run, so a new route is either covered by the central Firebase gate (/api/*,
// /oauth/google) or must be added to PUBLIC_ROUTES below with a reason.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const port = 41000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

// Reviewed public surface: static UI, PWA assets, allowlisted client modules,
// public release metadata, Cloud Run probes and Google's OAuth redirect target
// (protected by a single-use state issued only to Cliente Cero).
const PUBLIC_ROUTES = new Map([
  ['/', 'UI shell'], ['/approvals', 'UI shell'], ['/executive-dashboard.html', 'UI shell'],
  ['/executive-chat.html', 'UI shell'], ['/business-hunter-dashboard.html', 'UI shell'],
  ['/js/executive-chat.js', 'client code'], ['/js/business-hunter-dashboard.js', 'client code'],
  ['/js/firebase-authenticated-fetch.js', 'client code'], ['/css/executive-chat.css', 'style'],
  ['/css/business-hunter-dashboard.css', 'style'], ['/app/logo.png', 'asset'], ['/logo.png', 'asset'],
  ['/app/favicon.png', 'asset'], ['/favicon.png', 'asset'], ['/manifest.webmanifest', 'PWA'],
  ['/icons/icon-192.png', 'PWA'], ['/icons/icon-512.png', 'PWA'], ['/icons/apple-touch-icon.png', 'PWA'],
  ['/modules/projects/projectManager.js', 'client code'], ['/modules/strategic-intelligence/', 'allowlisted client code'],
  ['/modules/documents/', 'allowlisted client code'], ['/modules/memory/', 'allowlisted client code'],
  ['/app/release.json', 'public release metadata'], ['/health', 'Cloud Run probe'], ['/ready', 'Cloud Run probe'],
  ['/oauth/google/callback', 'Google redirect; single-use state required']
]);
const AUTH_STATUSES = new Set([401, 403, 503]);
// Strings that must never appear in anything served without authentication.
const SENSITIVE = [/BEGIN [A-Z ]*PRIVATE KEY/, /postgres(ql)?:\/\/[^\s"']*@/, /"refresh_token"/, /"client_secret"/, /ya29\.[0-9A-Za-z_-]{20}/];

function sourceRoutes() {
  const files = [path.join(root, 'backend/api/server.js'),
    ...fs.readdirSync(path.join(root, 'backend/api/routes')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .map((f) => path.join(root, 'backend/api/routes', f))];
  const routes = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:pathname|req\.url)(?:\.startsWith\(| === )["']([^"']+)["']/g)) routes.add(m[1]);
    for (const m of text.matchAll(/["'](\/(?:api|oauth)\/[A-Za-z0-9/_-]+)["']/g)) routes.add(m[1]);
  }
  routes.delete('/api/');
  return [...routes].sort();
}

async function waitFor(url, child, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { const r = await fetch(url); if (r.status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server not ready');
}

test('every route is either behind the Firebase gate or a reviewed public route', () => {
  const unreviewed = sourceRoutes().filter((r) => !(r.startsWith('/api/') || r === '/oauth/google') && !PUBLIC_ROUTES.has(r));
  assert.deepEqual(unreviewed, [], 'new non-/api route: review it and add it to PUBLIC_ROUTES with a reason');
});

test('anonymous callers get an authentication error and no data on every private route', async (t) => {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, PORT: String(port) };
  const child = spawn(process.execPath, ['backend/api/server.js'], { cwd: root, env, stdio: 'ignore', windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(`${base}/ready`, child);

  const privateRoutes = sourceRoutes().filter((r) => r.startsWith('/api/') || r === '/oauth/google');
  assert.ok(privateRoutes.length >= 30, `expected the full private surface, found ${privateRoutes.length}`);
  const failures = [];
  for (const route of privateRoutes) {
    for (const suffix of ['', '/', '?x=1']) {
      for (const [method, headers] of [['GET', {}], ['POST', { 'content-type': 'application/json' }],
        ['GET', { authorization: 'Bearer not-a-firebase-token' }], ['POST', { authorization: 'Basic YTpi', 'content-type': 'application/json' }]]) {
        const res = await fetch(base + route + suffix, { method, headers, body: method === 'POST' ? '{}' : undefined, redirect: 'manual' });
        const body = await res.text();
        // 405 is the pre-auth method check of the two mutable executive routes.
        // Outside /api/ an unmatched variant (e.g. "/oauth/google/") is a plain 404.
        const allowed = AUTH_STATUSES.has(res.status) || (res.status === 405 && ['/api/approve', '/api/execute-approved'].includes(route)) ||
          (res.status === 404 && !(route + suffix).startsWith('/api/'));
        if (!allowed || body.length > 400 || SENSITIVE.some((re) => re.test(body))) failures.push(`${method} ${route}${suffix} -> ${res.status}`);
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.equal(child.exitCode, null, 'the server survived every anonymous request');
});

test('path variants never bypass the gate into a 200 with data', async (t) => {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, PORT: String(port + 1) };
  const child = spawn(process.execPath, ['backend/api/server.js'], { cwd: root, env, stdio: 'ignore', windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(`http://127.0.0.1:${port + 1}/ready`, child);
  for (const variant of ['//api/status', '/API/status', '/%61pi/status', '/api%2Fstatus', '/./api/status', '/x/../api/memory',
    '/api/../api/memory', '/modules/memory/../../../backend/api/server.js', '/modules/memory/%2e%2e/%2e%2e/package.json']) {
    const res = await fetch(`http://127.0.0.1:${port + 1}${variant}`);
    const body = await res.text();
    assert.ok(res.status !== 200 || !/"ok":\s*true|require\(|"dependencies"/.test(body), `${variant} -> ${res.status}`);
  }
});

test('public routes serve no secrets', async (t) => {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, PORT: String(port + 2) };
  const child = spawn(process.execPath, ['backend/api/server.js'], { cwd: root, env, stdio: 'ignore', windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(`http://127.0.0.1:${port + 2}/ready`, child);
  const callback = await fetch(`http://127.0.0.1:${port + 2}/oauth/google/callback?code=attacker&state=forged`);
  assert.equal(callback.status, 403, 'callback without a state issued to Cliente Cero is refused');
  for (const route of PUBLIC_ROUTES.keys()) {
    if (route.endsWith('/')) continue;
    const res = await fetch(`http://127.0.0.1:${port + 2}${route}`);
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.ok(!SENSITIVE.some((re) => re.test(body)), `${route} serves sensitive content`);
  }
});
