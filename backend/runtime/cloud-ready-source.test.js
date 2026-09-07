'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('server exposes portable lifecycle and unauthenticated probes', () => {
  const source = read('backend/api/server.js');
  const oauthSource = read('backend/integrations/googleOAuth.js');
  assert.match(source, /^require\(["']dotenv["']\)\.config\(\);/);
  assert.doesNotMatch(oauthSource, /dotenv/);
  assert.match(source, /readRuntimeConfig\(\)/);
  assert.match(source, /getRuntimeProbe/);
  assert.match(source, /server\.listen\(PORT,\s*HOST/);
  assert.match(source, /createShutdownController/);
  assert.doesNotMatch(source, /const PORT\s*=\s*3000/);
});

test('server keeps execution fail-closed and exposes only safe diagnostics', () => {
  const source = read('backend/api/server.js');
  assert.match(source, /executionEnabled:\s*false/);
  assert.match(source, /safeDiagnostic/);
  assert.doesNotMatch(source, /error:\s*error\.message/);
  assert.doesNotMatch(source, /console\.error\([^\r\n]*,\s*error\s*\)/);

  const runtimeContract = read('backend/runtime/cloud-ready-contract.js');
  assert.match(runtimeContract, /safeDraftOnly:\s*true/);
});

test('runtime sources contain no absolute Windows or mandatory OneDrive defaults', () => {
  const sources = [
    'backend/api/server.js',
    'backend/ecosystem/ecosystemConfig.js',
    'backend/services/knowledge/connectors/onedrive-connector.js',
    'backend/runtime/cloud-ready-contract.js',
  ].map(read).join('\n');
  assert.doesNotMatch(sources, /[A-Za-z]:\\\\Users\\\\/);
  assert.doesNotMatch(sources, /OneDrive\\\\Documentos/);
});

test('container excludes secrets and runtime stores and runs as non-root', () => {
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /HEALTHCHECK/);
  [
    '.env',
    'backend/auth',
    'backend/core/approvalQueue.json',
    'backend/core/executionLog.json',
    'backend/memory/memory.json',
  ].forEach((entry) => assert.match(dockerignore, new RegExp(entry.replace(/\./g, '\\.'))));
  assert.doesNotMatch(dockerfile, /GOOGLE_CLIENT_SECRET|refresh_token|private_key/i);
});

test('container grants owner write on backend directories before dropping to node', () => {
  const dockerfile = read('Dockerfile');
  const copyIndex = dockerfile.indexOf('COPY --chown=node:node backend ./backend');
  const chmodIndex = dockerfile.indexOf('chmod u+w');
  const userIndex = dockerfile.indexOf('USER node');
  assert.ok(copyIndex >= 0, 'Dockerfile must copy backend with node ownership');
  assert.match(dockerfile, /RUN find \/app\/backend -type d -exec chmod u\+w \{\} \+/);
  assert.ok(
    copyIndex < chmodIndex && chmodIndex < userIndex,
    'chmod u+w on backend directories must run after the backend COPY and before USER node'
  );
  assert.doesNotMatch(dockerfile, /chmod\s+(-R\s+)?777/);
  assert.doesNotMatch(dockerfile, /chmod\s+-R\s+[ugo]?\+?rwx/);
  assert.doesNotMatch(dockerfile, /chown\s+-R.*\/app\b(?!\/backend)/);
});
