'use strict';
// V3 store lock, local gaps closed on 17/10/2026: a pid that cannot prove its
// holder gone (malformed, reused by another live process, or unanswerable)
// never lets a lock, guard or claim be taken; temp (.tmp) and aside (.stale)
// leftovers are removed only with evidence that nothing live is using them.
// Real child processes, real crashes (process.exit) at each boundary.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto'); const { spawn } = require('node:child_process');
const { createMemoryStoreFactory } = require('./memory-store');
const { createHmacIntegrity } = require('./integrity');

function fixture(t, storeOptions = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const key = randomBytes(32);
 const openStore = (more = {}) => createMemoryStoreFactory({ root, integrity: createHmacIntegrity({ key }), ...storeOptions, ...more })({ key: h => h });
 return { root, key, openStore };
}
const dataFile = root => path.join(root, fs.readdirSync(root).find(n => /^[0-9a-f]{64}\.json$/.test(n)));
const lockFile = root => dataFile(root) + '.lock';
const guardFile = root => lockFile(root) + '.reclaim';
const claimOf = (root, id, n = 0) => guardFile(root) + '-' + createHash('sha256').update('id:' + id).digest('hex').slice(0, 32) + '.' + n + '.won';
const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
const record = (pid, more = {}) => ({ id: randomUUID(), pid, host: os.hostname(), instance: 'another-process', thread: 0, start: null, acquiredAt: Date.now() - 60000, expiresAt: Date.now() - 30000, state: 'held', ...more });
const meta = (pid, more) => JSON.stringify(record(pid, more));
const deadPid = async () => { const c = spawn(process.execPath, ['-e', '0']); const pid = c.pid; await new Promise(r => c.on('exit', r)); return pid; };
const sleeper = t => { const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']); t.after(() => c.kill()); return c; };
const stop = async c => { c.kill('SIGKILL'); await new Promise(r => c.on('exit', r)); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms = 15000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };
const notes = f => f.openStore().list('owner', 'note').length;
const residues = root => fs.readdirSync(root).filter(n => /\.(tmp|stale)$/.test(n)).sort();
const leftovers = root => fs.readdirSync(root).filter(n => /\.(lock|reclaim|won|tmp|stale)$/.test(n));
function child(f, body, storeOptions = {}) {
 const src = `const fs=require('node:fs');const path=require('node:path');const so=${JSON.stringify(__dirname)};
 const {createMemoryStoreFactory}=require(path.join(so,'memory-store'));const {createHmacIntegrity}=require(path.join(so,'integrity'));
 const s=createMemoryStoreFactory({root:${JSON.stringify(f.root)},integrity:createHmacIntegrity({key:Buffer.from('${f.key.toString('hex')}','hex')}),...${JSON.stringify(storeOptions)}})({key:h=>h});
 (async()=>{${body}})().catch(e=>{console.log('FATAL '+(e.code||e.message));});`;
 const c = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
 c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
 return { c, done: new Promise(r => c.on('exit', status => r({ status, out }))) };
}
// Every way of taking or breaking a lock, guard or claim of this holder record.
function assertUntouchable(f, s, file, what) {
 const before = fs.readFileSync(file, 'utf8');
 assert.equal(code(() => s.put('owner', 'note', 'n-x', {})), 'store_busy', what + ': automatic write');
 for (const who of ['owner', 'supervisor']) {
  let r; try { r = s.recover('owner', { decidedBy: who }); } catch (e) { r = e.code; }
  assert.ok(r === 'store_lock_live' || r.recovered === false, what + ': ' + who + ' recover ' + JSON.stringify(r));
 }
 assert.equal(fs.readFileSync(file, 'utf8'), before, what + ': left byte for byte');
}

// ---------- 1. PID: fail closed unless the holder is proven gone ----------
test('malformed pid on an expired lock (beyond int32, negative, zero, fraction, text, missing): never reclaimed', async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 // Before the fix 2^31, 2^40 and -5 read as "gone" on Windows (type error / ESRCH) and were reclaimed.
 for (const pid of [2 ** 31, 2 ** 40, -5, -1, 0, 1.5, '4242', null]) {
  fs.writeFileSync(lockFile(f.root), meta(pid));
  assertUntouchable(f, s, lockFile(f.root), 'pid ' + pid);
  for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live', String(pid));
  fs.unlinkSync(lockFile(f.root));
 }
 assert.equal(notes(f), 1, 'no write slipped in');
});
test('malformed pid on a guard or a claim: never cleared or passed over', async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 fs.writeFileSync(lockFile(f.root), meta(await deadPid()));
 const guard = record(2 ** 40); fs.writeFileSync(guardFile(f.root), JSON.stringify(guard));
 assertUntouchable(f, s, guardFile(f.root), 'guard');
 fs.writeFileSync(guardFile(f.root), meta(await deadPid())); const g = JSON.parse(fs.readFileSync(guardFile(f.root), 'utf8'));
 fs.writeFileSync(claimOf(f.root, g.id), meta(-5));
 assertUntouchable(f, s, claimOf(f.root, g.id), 'claim');
 assert.ok(fs.existsSync(guardFile(f.root)) && fs.existsSync(lockFile(f.root)));
});
test('a pid whose liveness cannot be answered (EPERM, EACCES, EINVAL, unknown): may be the holder, never reclaimed; ESRCH alone proves it gone', async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 const other = await deadPid(); const { kill } = process; t.after(() => { process.kill = kill; });
 for (const errno of ['EPERM', 'EACCES', 'EINVAL', 'UNKNOWN', undefined]) {
  process.kill = (pid, sig) => { if (pid === other) throw Object.assign(new Error('kill'), { code: errno }); return kill.call(process, pid, sig); };
  fs.writeFileSync(lockFile(f.root), meta(other));
  assertUntouchable(f, s, lockFile(f.root), String(errno));
  fs.unlinkSync(lockFile(f.root));
 }
 process.kill = (pid, sig) => { if (pid === other) throw Object.assign(new Error('kill'), { code: 'ESRCH' }); return kill.call(process, pid, sig); };
 fs.writeFileSync(lockFile(f.root), meta(other));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok', 'ESRCH: proven gone, reclaimed');
 assert.equal(notes(f), 2);
});
test('pid reused by another live process (no start identity on Windows): lock, guard and claim untouched while it lives; reclaimed once it exits', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 const linux = fs.existsSync('/proc/self/stat');
 // The recorded holder ended; its pid now belongs to an unrelated live process.
 const reuser = sleeper(t); await wait(100);
 fs.writeFileSync(lockFile(f.root), meta(reuser.pid, { start: linux ? null : 'boot:1' }));
 assertUntouchable(f, s, lockFile(f.root), 'lock');
 fs.writeFileSync(lockFile(f.root), meta(await deadPid())); fs.writeFileSync(guardFile(f.root), meta(reuser.pid));
 assertUntouchable(f, s, guardFile(f.root), 'guard');
 fs.writeFileSync(guardFile(f.root), meta(await deadPid())); const g = JSON.parse(fs.readFileSync(guardFile(f.root), 'utf8'));
 fs.writeFileSync(claimOf(f.root, g.id), meta(reuser.pid));
 assertUntouchable(f, s, claimOf(f.root, g.id), 'claim');
 // Nothing proves it is not the holder; once the pid is gone, evidence does.
 await stop(reuser);
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2);
 assert.deepEqual(leftovers(f.root), [], 'lock, guard and claim cleared by evidence');
});

// ---------- 2. .tmp / .stale leftovers: removed only with evidence ----------
const tmpName = () => '.' + randomUUID() + '.tmp'; const staleName = () => '.' + randomUUID() + '.stale';
test('crash leftovers of a dead holder (snapshot temp, renewal temp, claim temp, lock and guard moved aside): cleared when its lock is reclaimed; data intact', async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 const pid = await deadPid(); const g = record(pid); const snapshot = fs.readFileSync(dataFile(f.root), 'utf8');
 fs.writeFileSync(dataFile(f.root) + tmpName(), '{"partial":'); fs.writeFileSync(lockFile(f.root) + tmpName(), meta(pid));
 fs.writeFileSync(claimOf(f.root, g.id) + tmpName(), meta(pid)); fs.writeFileSync(lockFile(f.root) + staleName(), meta(pid));
 fs.writeFileSync(guardFile(f.root) + staleName(), JSON.stringify(g)); fs.writeFileSync(claimOf(f.root, g.id), meta(pid));
 fs.writeFileSync(lockFile(f.root), meta(pid));
 assert.equal(residues(f.root).length, 5);
 assert.equal(fs.readFileSync(dataFile(f.root), 'utf8'), snapshot, 'leftovers are never read');
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok');
 assert.deepEqual(leftovers(f.root), []); assert.equal(notes(f), 2);
});
test('leftovers that may be in use, or cannot be judged, stay: live holder, live claim of that guard, unreadable, unknown names', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 const live = sleeper(t); await wait(100); const dead = await deadPid(); const g = record(dead);
 const keep = [
  [lockFile(f.root) + staleName(), meta(live.pid)], // a live holder's lock moved aside
  [guardFile(f.root) + staleName(), meta(live.pid)], // a live holder's guard moved aside
  [guardFile(f.root) + staleName(), JSON.stringify(g)], // a dead guard still being moved by a live claim
  [claimOf(f.root, g.id), meta(live.pid)],
  [claimOf(f.root, randomUUID()) + tmpName(), meta(live.pid, { expiresAt: Date.now() + 60000 })], // a claim being created
  [lockFile(f.root) + staleName(), ''], [guardFile(f.root) + staleName(), '{"id":'], [claimOf(f.root, randomUUID()) + tmpName(), ''],
  [lockFile(f.root) + staleName(), meta(dead, { host: 'other-host' })],
  [lockFile(f.root) + '.not-a-uuid.stale', meta(dead)], [dataFile(f.root) + '.not-a-uuid.tmp', '{}'],
 ].map(([file, text]) => { fs.writeFileSync(file, text); return path.basename(file); }).sort();
 fs.writeFileSync(lockFile(f.root), meta(dead));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok', 'the dead lock is reclaimed');
 assert.deepEqual(fs.readdirSync(f.root).filter(n => keep.includes(n)).sort(), keep, 'every leftover in doubt is kept');
 for (const who of ['owner', 'supervisor']) assert.deepEqual(s.recover('owner', { decidedBy: who }), { recovered: false, reason: 'no_lock' });
 assert.deepEqual(fs.readdirSync(f.root).filter(n => keep.includes(n)).sort(), keep, 'recover() keeps them too');
 assert.equal(notes(f), 2);
});
test('temp files of a live holder are never removed: another process cannot sweep them while the owner lock is held', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', {}); const signal = path.join(f.root, 'held.signal');
 const holder = child(f, `await s.transaction('owner',async tx=>{tx.put('owner','note','holder',{});fs.writeFileSync(${JSON.stringify(signal)},'');await new Promise(r=>setTimeout(r,1500));});console.log('RELEASED');`, { lockLeaseMs: 200 });
 t.after(() => holder.c.kill());
 await until(() => fs.existsSync(signal));
 const inFlight = [dataFile(f.root) + tmpName(), lockFile(f.root) + tmpName()]; for (const file of inFlight) fs.writeFileSync(file, '{}');
 const s = f.openStore({ lockLeaseMs: 200, acquireMs: 300 });
 assert.equal(code(() => s.put('owner', 'note', 'intruder', {})), 'store_busy');
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live');
 assert.ok(inFlight.every(file => fs.existsSync(file)), 'temp files of the live holder untouched');
 const h = await holder.done; assert.match(h.out, /RELEASED/);
 assert.equal(notes(f), 2, 'the holder committed');
});
test('real crash between the snapshot temp and its rename: the lock and temp left; the next writer reclaims, sweeps, and the uncommitted write never appears', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', {});
 const crash = await child(f, `const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(String(a).endsWith('.tmp'))process.exit(9);return rename(a,b);};s.put('owner','note','lost',{});console.log('NO_CRASH');`, { lockLeaseMs: 200 }).done;
 assert.equal(crash.status, 9, crash.out);
 assert.ok(fs.existsSync(lockFile(f.root))); assert.equal(residues(f.root).length, 1, 'the snapshot temp of the crash');
 await wait(300);
 assert.equal(code(() => f.openStore().put('owner', 'note', 'n-1', {})), 'ok');
 assert.deepEqual(f.openStore().list('owner', 'note').length, 2, 'n-0 and n-1, never "lost"');
 assert.deepEqual(leftovers(f.root), []);
});
test('real crash after moving a dead lock aside, before deleting it: the lock name is free, the aside and guard stay inert; recover() clears both', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', {});
 fs.writeFileSync(lockFile(f.root), meta(await deadPid()));
 const crash = await child(f, `const unlink=fs.unlinkSync;fs.unlinkSync=p=>{if(/\\.lock\\.[0-9a-f-]{36}\\.stale$/.test(String(p)))process.exit(9);return unlink(p);};s.put('owner','note','crash-write',{});console.log('NO_CRASH');`, { lockLeaseMs: 200 }).done;
 assert.equal(crash.status, 9, crash.out);
 assert.ok(fs.existsSync(guardFile(f.root)), 'the guard of the dead recoverer'); assert.equal(residues(f.root).length, 1, 'the lock moved aside');
 const s = f.openStore({ lockLeaseMs: 200 });
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok', 'writes go on meanwhile: the leftovers are never read');
 await wait(300);
 assert.deepEqual(s.recover('owner', { decidedBy: 'owner' }), { recovered: false, reason: 'no_lock' });
 assert.deepEqual(leftovers(f.root), [], 'guard and aside cleared by evidence');
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'ok'); assert.equal(notes(f), 3);
});
test('an uncertain commit with a temp file left: recover() clears both and writes resume', async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 fs.writeFileSync(lockFile(f.root), meta(process.pid, { instance: 'x', state: 'uncertain' })); fs.writeFileSync(dataFile(f.root) + tmpName(), '{}');
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'store_recovery_required');
 assert.deepEqual(s.recover('owner', { decidedBy: 'owner' }), { recovered: true, previousState: 'uncertain' });
 assert.deepEqual(leftovers(f.root), []);
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2);
});
