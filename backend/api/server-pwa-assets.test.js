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

test('protects every API with the central Firebase authority and keeps public shells data-free', () => {
  assert.match(serverSource, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(serverSource, /authenticateFirebaseRequest\(req/);
  assert.match(serverSource, /createFirebaseAdminVerifier\(\)/);
  assert.match(serverSource, /createExecutiveAuthorizer\(\)/);
  assert.match(serverSource, /Object\.defineProperty\(req, "oxkioIdentity"/);
  assert.match(serverSource, /pathname === "\/oauth\/google"/);
  assert.doesNotMatch(serverSource, /AUTH_DISABLED|x-oxkio-identity|x-oxkio-role/);
});

test('private frontends send Firebase Bearer tokens only in headers and retry once', () => {
  const files = [
    'index.html',
    'executive-dashboard.html',
    'approvals.html',
    path.join('js', 'firebase-authenticated-fetch.js'),
    path.join('js', 'executive-chat.js'),
  ];
  const sources = files.map((file) => fs.readFileSync(path.join(appPath, file), 'utf8'));

  sources.slice(0, 4).forEach((source) => {
    assert.match(source, /getIdToken\(!retry\)/);
    assert.match(source, /headers\.set\(["']Authorization["'], `Bearer \$\{token\}`\)/);
    assert.match(source, /response\.status === 401 && retry/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /console\.[a-z]+\([^)]*token/i);
    assert.doesNotMatch(source, /[?&](token|idToken)=/i);
  });
  sources.slice(1, 4).forEach((source) => {
    assert.match(source, /onAuthStateChanged/);
    assert.match(source, /window\.location\.replace\("\/"\)/);
  });
  assert.match(sources[0], /authenticatedFetch\(executiveChatEndpoint/);
  assert.match(sources[1], /oxkioAuthenticatedFetch\("\/api\/dashboard"\)/);
  assert.match(sources[2], /oxkioAuthenticatedFetch\('\/api\/pending-approvals/);
  assert.match(sources[4], /oxkioAuthenticatedFetch\('\/api\/executive\/identity'\)/);
});

test('Business Hunter loads the shared Firebase bootstrap before its authenticated API client', () => {
  const html = fs.readFileSync(path.join(appPath, 'business-hunter-dashboard.html'), 'utf8');
  const bootstrapTag = '<script type="module" src="/js/firebase-authenticated-fetch.js"></script>';
  const dashboardTag = '<script type="module" src="/js/business-hunter-dashboard.js"></script>';
  const bootstrapIndex = html.indexOf(bootstrapTag);
  const dashboardIndex = html.indexOf(dashboardTag);
  const bootstrap = fs.readFileSync(
    path.join(appPath, 'js', 'firebase-authenticated-fetch.js'),
    'utf8'
  );

  assert.ok(bootstrapIndex >= 0);
  assert.ok(dashboardIndex > bootstrapIndex);
  assert.match(bootstrap, /firebase-app\.js/);
  assert.match(bootstrap, /firebase-auth\.js/);
  assert.ok(bootstrap.indexOf('firebase-app.js') < bootstrap.indexOf('firebase-auth.js'));
  assert.match(bootstrap, /onAuthStateChanged\(firebaseAuth/);
  assert.match(bootstrap, /window\.oxkioAuthReady = new Promise/);
  assert.match(bootstrap, /window\.oxkioAuthenticatedFetch = async function/);
  assert.doesNotMatch(html, /initializeApp\(|firebase-app\.js|firebase-auth\.js/);
  assert.match(serverSource, /req\.url === "\/js\/firebase-authenticated-fetch\.js"/);
  assert.match(serverSource, /app\/js\/firebase-authenticated-fetch\.js|app", "js", "firebase-authenticated-fetch\.js/);
});

test('frontend API calls cannot bypass the authenticated fetch helper', () => {
  const frontendFiles = [];
  const collectFrontendFiles = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collectFrontendFiles(entryPath);
      else if (/\.(?:html|js)$/.test(entry.name)) frontendFiles.push(entryPath);
    });
  };
  collectFrontendFiles(appPath);

  const directApiFetch = /\bfetch\s*\(\s*["'`]\/api\//;
  const offenders = frontendFiles
    .filter((file) => directApiFetch.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(appPath, file));

  assert.deepEqual(offenders, []);

  const projectManager = fs.readFileSync(
    path.join(appPath, 'modules', 'projects', 'projectManager.js'),
    'utf8'
  );
  const businessHunter = fs.readFileSync(
    path.join(appPath, 'js', 'business-hunter-dashboard.js'),
    'utf8'
  );
  [projectManager, businessHunter].forEach((source) => {
    assert.match(source, /typeof window\.oxkioAuthenticatedFetch !== ["']function["']/);
    assert.match(source, /window\.oxkioAuthenticatedFetch\(["']\/api\//);
  });
});
