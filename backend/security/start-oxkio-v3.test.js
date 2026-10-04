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

// Supervision (04/10/2026): the task also fires periodically, so a start in
// service mode must be idempotent and must never rotate the live logs.
const net = require('node:net');
const { spawn } = require('node:child_process');
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const listening = (port) => new Promise((resolve) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); resolve(true); }); c.on('error', () => resolve(false)); });
async function waitFor(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; }
const SERVER = "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.argv[2]),'127.0.0.1');require('fs').writeFileSync(process.argv[3],String(process.pid));";
function serviceDir(port, launcher = STUB) {
  // Long path, as the task uses: CI temp dirs come as 8.3 short names
  // (RUNNER~1) while PowerShell resolves $PSScriptRoot to the long form.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-v3-supervise-')));
  fs.copyFileSync(WRAPPER, path.join(dir, 'Start-OxkioV3.ps1'));
  fs.writeFileSync(path.join(dir, 'Start-Oxkio.ps1'), typeof launcher === 'function' ? launcher(dir) : launcher, 'utf8');
  fs.writeFileSync(path.join(dir, 'server.js'), SERVER, 'utf8');
  const logs = path.join(dir, 'logs'); fs.mkdirSync(logs);
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ logDirectory: logs, environment: { ...CONFIG.environment, PORT: String(port) } }), 'utf8');
  return { dir, logs, config };
}
function runService({ dir, config }) {
  const r = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'Start-OxkioV3.ps1'), '-ConfigPath', config],
    { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, OXKIO_ADMIN_FIREBASE_UIDS: UID } });
  return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
}
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const killPidFile = (f) => { try { process.kill(Number(fs.readFileSync(f, 'utf8')), 'SIGKILL'); } catch { /* gone */ } };

test('service mode on a free port starts the launcher and records the start', async (t) => {
  if (powershellBlocked) { t.skip('powershell.exe no disponible.'); return; }
  const s = serviceDir(await freePort());
  try {
    const r = runService(s);
    assert.equal(r.status, 0, r.output);
    assert.match(read(path.join(s.logs, 'oxkio-v3.out.log')), /STUB validateOnly=False/);
    const supervisor = read(path.join(s.logs, 'oxkio-v3.supervisor.log'));
    assert.match(supervisor, /^\d{4}-\d\d-\d\dT[\d:]+ start\r?$/m); assert.equal(supervisor.charCodeAt(0) === 0xfeff, false, 'no BOM');
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('a foreign process on the port: nothing starts and the live logs are not rotated', async (t) => {
  if (powershellBlocked) { t.skip('powershell.exe no disponible.'); return; }
  const port = await freePort(); const s = serviceDir(port); const pidFile = path.join(s.dir, 'foreign.pid');
  const foreign = spawn(process.execPath, [path.join(s.dir, 'server.js'), String(port), pidFile], { stdio: 'ignore' });
  try {
    assert.equal(await waitFor(() => listening(port)), true);
    fs.writeFileSync(path.join(s.logs, 'oxkio-v3.out.log'), 'LIVE', 'utf8');
    const r = runService(s);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /ocupado por otro proceso/); assert.doesNotMatch(r.output, /STUB/);
    assert.equal(read(path.join(s.logs, 'oxkio-v3.out.log')), 'LIVE'); assert.equal(fs.existsSync(path.join(s.logs, 'oxkio-v3.out.log.1')), false);
    assert.match(read(path.join(s.logs, 'oxkio-v3.supervisor.log')), new RegExp(`port-busy owner=${foreign.pid}`));
  } finally { foreign.kill('SIGKILL'); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('OXKIO already running from this launcher: exits 0 without starting another instance or rotating logs', async (t) => {
  if (powershellBlocked) { t.skip('powershell.exe no disponible.'); return; }
  const port = await freePort();
  // A stand-in launcher that keeps a Node server as its child, like the real one.
  const RUNNING = (dir) => `& '${process.execPath}' '${path.join(dir, 'server.js')}' ${port} '${path.join(dir, 'node.pid')}'` + '\r\nexit 0';
  const s = serviceDir(port, RUNNING); const pidFile = path.join(s.dir, 'node.pid');
  const launcher = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(s.dir, 'Start-Oxkio.ps1')], { stdio: 'ignore' });
  try {
    assert.equal(await waitFor(() => listening(port)), true);
    fs.writeFileSync(path.join(s.logs, 'oxkio-v3.out.log'), 'LIVE', 'utf8');
    const r = runService(s);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /ya esta en ejecucion/);
    assert.equal(read(path.join(s.logs, 'oxkio-v3.out.log')), 'LIVE'); assert.equal(fs.existsSync(path.join(s.logs, 'oxkio-v3.out.log.1')), false);
    assert.match(read(path.join(s.logs, 'oxkio-v3.supervisor.log')), /already-running node=\d+/);
  } finally { killPidFile(pidFile); launcher.kill('SIGKILL'); fs.rmSync(s.dir, { recursive: true, force: true }); }
});
