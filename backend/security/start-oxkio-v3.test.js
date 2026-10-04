'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// scripts/Start-OxkioV3.ps1 is exercised exactly as an autostart task runs it:
// no -LauncherPath, so it must find the canonical launcher next to itself. A
// stub Start-Oxkio.ps1 stands in for the real one (no secret, no server).
const WRAPPER = path.join(__dirname, '../../scripts/Start-OxkioV3.ps1');
const probe = process.platform === 'win32' ? spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0']) : { error: new Error('not windows') };
const powershellBlocked = Boolean(probe.error) || probe.status !== 0;
const STUB = [
  'param([switch]$ValidateOnly)',
  "foreach ($n in 'PORT','OXKIO_V3_ENABLED','OXKIO_V3_MEMORY_ROOT','OXKIO_V3_COHORT_UIDS') { $v = [Environment]::GetEnvironmentVariable($n, 'Process'); Write-Host (\"STUB {0} set={1}\" -f $n, (-not [string]::IsNullOrEmpty($v))) }",
  'Write-Host "STUB validateOnly=$ValidateOnly"',
  'exit 0',
].join('\r\n');
const CONFIG = { logDirectory: 'C:\\oxkio-test\\logs', environment: { PORT: '3999', OXKIO_V3_ENABLED: 'true', OXKIO_V3_MEMORY_ROOT: 'C:\\oxkio-test\\v3', OXKIO_V3_REASONING_BASE_URL: 'https://api.openai.com/v1' } };
const UID = 'synthetic-admin-uid-0001';

function run(environment = CONFIG.environment) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-v3-wrapper-'));
  try {
    fs.copyFileSync(WRAPPER, path.join(dir, 'Start-OxkioV3.ps1'));
    fs.writeFileSync(path.join(dir, 'Start-Oxkio.ps1'), STUB, 'utf8');
    const config = path.join(dir, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ ...CONFIG, environment }), 'utf8');
    const r = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'Start-OxkioV3.ps1'), '-ConfigPath', config, '-ValidateOnly'],
      { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, OXKIO_ADMIN_FIREBASE_UIDS: UID } });
    return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('without -LauncherPath the wrapper finds the launcher next to itself (Windows PowerShell 5.1)', (t) => {
  if (powershellBlocked) { t.skip('powershell.exe no disponible.'); return; }
  const r = run();
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /STUB validateOnly=True/);
  for (const name of ['PORT', 'OXKIO_V3_ENABLED', 'OXKIO_V3_MEMORY_ROOT', 'OXKIO_V3_COHORT_UIDS']) assert.match(r.output, new RegExp(`STUB ${name} set=True`));
  assert.equal(r.output.includes(UID), false, 'the cohort uid is never printed');
});

test('a secret-like or unknown variable in the config is refused before the launcher runs', (t) => {
  if (powershellBlocked) { t.skip('powershell.exe no disponible.'); return; }
  for (const [extra, message] of [[{ OXKIO_REASONING_API_KEY: 'x' }, /Variable no permitida/], [{ OXKIO_V3_COHORT_UIDS: UID }, /Variable no permitida/], [{ FOO: 'x' }, /Variable desconocida/]]) {
    const r = run({ ...CONFIG.environment, ...extra });
    assert.notEqual(r.status, 0); assert.match(r.output, message); assert.doesNotMatch(r.output, /STUB/);
  }
});
