'use strict';
// Post-reaudit P1 corrections of the V3 store lock (17/10/2026, second pass):
// a reclaim claim (.won) is crash-safe and retakable, and a holder that may be
// alive is never broken (a live pid + an expired lease prove nothing).
// Real child processes, real crashes (process.exit) at each boundary.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto'); const { spawn } = require('node:child_process');
const { createMemoryStoreFactory } = require('./memory-store');
const { createHmacIntegrity } = require('./integrity');

function fixture(t, storeOptions = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-holder-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const key = randomBytes(32);
 const openStore = (more = {}) => createMemoryStoreFactory({ root, integrity: createHmacIntegrity({ key }), ...storeOptions, ...more })({ key: h => h });
 return { root, key, openStore };
}
const dataFile = root => path.join(root, fs.readdirSync(root).find(n => /^[0-9a-f]{64}\.json$/.test(n)));
const lockFile = root => dataFile(root) + '.lock';
const guardFile = root => lockFile(root) + '.reclaim';
const claimFile = (root, n = 0) => guardFile(root) + '-' + createHash('sha256').update('id:' + JSON.parse(fs.readFileSync(guardFile(root), 'utf8')).id).digest('hex').slice(0, 32) + '.' + n + '.won';
const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
const meta = (pid, more = {}) => JSON.stringify({ id: randomUUID(), pid, host: os.hostname(), acquiredAt: Date.now() - 60000, expiresAt: Date.now() - 30000, state: 'held', ...more });
const deadPid = async () => { const c = spawn(process.execPath, ['-e', '0']); const pid = c.pid; await new Promise(r => c.on('exit', r)); return pid; };
const sleeper = t => { const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']); t.after(() => c.kill()); return c; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const notes = f => f.openStore().list('owner', 'note').length;
const leftovers = root => fs.readdirSync(root).filter(n => n.endsWith('.lock') || n.endsWith('.reclaim') || n.endsWith('.won'));
// A child process with the same store; `body` runs with `s`, `fs`, `pause`.
function child(f, body, storeOptions = {}) {
 const src = `const fs=require('node:fs');const path=require('node:path');const so=${JSON.stringify(__dirname)};
 const {createMemoryStoreFactory}=require(path.join(so,'memory-store'));const {createHmacIntegrity}=require(path.join(so,'integrity'));
 const pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
 const s=createMemoryStoreFactory({root:${JSON.stringify(f.root)},integrity:createHmacIntegrity({key:Buffer.from('${f.key.toString('hex')}','hex')}),...${JSON.stringify(storeOptions)}})({key:h=>h});
 (async()=>{${body}})().catch(e=>{console.log('FATAL '+(e.code||e.message));});`;
 const c = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
 c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
 return { c, out: () => out, done: new Promise(r => c.on('exit', status => r({ status, out }))) };
}
const until = async (cond, ms = 15000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };
// Stale lock + stale guard, both of a dead process.
async function staleLockAndGuard(f) { const pid = await deadPid(); fs.writeFileSync(lockFile(f.root), meta(pid)); fs.writeFileSync(guardFile(f.root), meta(pid)); }

// ---------- P1-1: the claim is crash-safe and retakable ----------
// The crash hooks: the child dies (process.exit) at one boundary of clearing
// the stale guard under its claim.
const BOUNDARY = {
 after_claim: `const link=fs.linkSync;fs.linkSync=(a,b)=>{link(a,b);if(String(b).endsWith('.won'))process.exit(9);};`,
 before_rename: `const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(String(a).endsWith('.reclaim'))process.exit(9);return rename(a,b);};`,
 after_rename: `const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(String(a).endsWith('.reclaim'))process.exit(9);};`,
 before_unlink: `const unlink=fs.unlinkSync;fs.unlinkSync=p=>{if(/\\.reclaim\\.[^.]+\\.stale$/.test(String(p)))process.exit(9);return unlink(p);};`,
 before_claim_cleanup: `const unlink=fs.unlinkSync;fs.unlinkSync=p=>{if(String(p).endsWith('.won'))process.exit(9);return unlink(p);};`,
};
test('probe A: stale lock + stale guard, claim taken, recoverer killed before the rename; a new process recovers, writes, restart confirms', { timeout: 60000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', { v: 0 }); await staleLockAndGuard(f);
 const crash = await child(f, BOUNDARY.before_rename + `s.put('owner','note','lost',{});console.log('NO_CRASH');`, { lockLeaseMs: 200 }).done;
 assert.equal(crash.status, 9, crash.out); assert.ok(fs.existsSync(claimFile(f.root)), 'claim of the dead recoverer left behind'); assert.ok(fs.existsSync(guardFile(f.root)));
 await wait(300); // the claim's lease ends; its holder is proven gone
 const s = f.openStore({ lockLeaseMs: 200 });
 const owner = s.recover('owner', { decidedBy: 'owner' });
 assert.equal(owner.recovered, true, JSON.stringify(owner));
 assert.deepEqual(s.recover('owner', { decidedBy: 'supervisor' }), { recovered: false, reason: 'no_lock' });
 assert.equal(code(() => s.put('owner', 'note', 'n-1', { v: 1 })), 'ok');
 const restart = f.openStore(); assert.deepEqual(restart.list('owner', 'note').map(n => n.v).sort(), [0, 1]);
 assert.deepEqual(leftovers(f.root), [], 'no lock, guard or claim left');
});
for (const boundary of Object.keys(BOUNDARY)) for (const next of ['automatic write', 'owner recover', 'supervisor recover']) {
 test('crash ' + boundary + ' while clearing a stale guard; then ' + next + ': converges, no write lost', { timeout: 60000 }, async t => {
  const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
  const crash = await child(f, BOUNDARY[boundary] + `s.put('owner','note','crash-write',{});console.log('NO_CRASH');`, { lockLeaseMs: 200 }).done;
  assert.equal(crash.status, 9, crash.out);
  await wait(300);
  const s = f.openStore({ lockLeaseMs: 200 });
  if (next !== 'automatic write') { const r = s.recover('owner', { decidedBy: next.split(' ')[0] }); assert.ok(r.recovered === true || r.reason === 'no_lock', JSON.stringify(r)); }
  assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok');
  assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'ok');
  assert.equal(notes(f), 3, 'restart sees every committed write');
  assert.deepEqual(leftovers(f.root), []);
 });
}
test('a live claim (its recoverer still running) is never passed over; once that process dies it is', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 300 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
 const holder = sleeper(t); fs.writeFileSync(claimFile(f.root), meta(holder.pid));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'store_busy');
 for (const who of ['owner', 'supervisor']) assert.equal(s.recover('owner', { decidedBy: who }).recovered, false, who);
 assert.ok(fs.existsSync(guardFile(f.root)) && fs.existsSync(claimFile(f.root)), 'guard and live claim untouched');
 holder.kill('SIGKILL'); await new Promise(r => holder.on('exit', r));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2); assert.deepEqual(leftovers(f.root), []);
});
test('a dead claim is passed over at once (next generation)', async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
 fs.writeFileSync(claimFile(f.root, 0), meta(await deadPid())); fs.writeFileSync(claimFile(f.root, 1), meta(await deadPid()));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2); assert.deepEqual(leftovers(f.root), []);
});
test('a corrupt claim: never passed over automatically; recover() passes over it once older than a lease', async t => {
 for (const who of ['owner', 'supervisor']) {
  // A 200 ms lease can expire while a saturated CI runner schedules this test.
  // Give the fresh corrupt claim a realistic lease; make the stale case explicit.
  const f = fixture(t, { lockLeaseMs: 10000, acquireMs: 300 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
  const claim = claimFile(f.root); fs.writeFileSync(claim, '{"id":');
  assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live', 'a recent unreadable claim is not passed over');
  const old = new Date(Date.now() - 60000); fs.utimesSync(claim, old, old);
  assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'store_recovery_required', 'never automatic');
  assert.equal(s.recover('owner', { decidedBy: who }).recovered, true, who);
  assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2);
 }
});
test('a claim of another host: its holder may be alive; nobody passes over it (external review)', async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 300 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
 fs.writeFileSync(claimFile(f.root), meta(4242, { host: 'other-host' }));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'store_busy');
 for (const who of ['owner', 'supervisor']) assert.equal(s.recover('owner', { decidedBy: who }).recovered, false, who);
 assert.ok(fs.existsSync(guardFile(f.root)) && fs.existsSync(lockFile(f.root)));
});
for (const errno of ['EPERM', 'EBUSY', 'EACCES']) test('Windows ' + errno + ' on the claim (create, guard move, cleanup) never blocks for good', async t => {
 const f = fixture(t, { lockLeaseMs: 200, retryMs: 50 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
 const { linkSync, renameSync, unlinkSync } = fs; t.after(() => Object.assign(fs, { linkSync, renameSync, unlinkSync }));
 const refuse = () => { throw Object.assign(new Error(errno), { code: errno }); };
 let links = 0; let renames = 0;
 fs.linkSync = (a, b) => (String(b).endsWith('.won') && links++ < 3 ? refuse() : linkSync(a, b));
 fs.renameSync = (a, b) => (String(a).endsWith('.reclaim') && renames++ < 2 ? refuse() : renameSync(a, b));
 fs.unlinkSync = p => (String(p).endsWith('.won') ? refuse() : unlinkSync(p));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.ok(links >= 3 && renames >= 2);
 assert.ok(fs.readdirSync(f.root).some(n => n.endsWith('.won')), 'the claim whose unlink was refused stays');
 Object.assign(fs, { linkSync, renameSync, unlinkSync });
 await staleLockAndGuard(f); await wait(300);
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'ok'); assert.equal(notes(f), 3);
 assert.deepEqual(leftovers(f.root), [], 'the leftover claim is swept once its holder is gone');
});
test('a guard move refused beyond the retry budget keeps the claims (no early cleanup); once possible, it converges', async t => {
 const f = fixture(t, { lockLeaseMs: 200, retryMs: 50 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
 const { renameSync } = fs; t.after(() => { fs.renameSync = renameSync; });
 fs.renameSync = (a, b) => { if (String(a).endsWith('.reclaim')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return renameSync(a, b); };
 assert.notEqual(code(() => s.put('owner', 'note', 'n-1', {})), 'ok');
 assert.ok(fs.existsSync(guardFile(f.root)) && fs.existsSync(claimFile(f.root)), 'guard still there, its claim kept');
 fs.renameSync = renameSync; await wait(300);
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2); assert.deepEqual(leftovers(f.root), []);
});
for (const n of [2, 4, 8]) test(n + ' concurrent recoverers (processes) over a stale lock, stale guard and dead claim: each writes, nothing lost', { timeout: 180000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', {}); await staleLockAndGuard(f);
 fs.writeFileSync(claimFile(f.root), meta(await deadPid()));
 const runs = await Promise.all(Array.from({ length: n }, (_, p) => child(f, `const out={recover:[],put:0};
  for(const who of ['owner','supervisor']){try{const r=s.recover('owner',{decidedBy:who});out.recover.push(r.recovered===true||r.reason==='no_lock'||r.recovered===false);}catch(e){out.recover.push(e.code);}}
  for(let i=0;i<5;i++){try{s.put('owner','note','p${p}-'+i,{});out.put++;}catch(e){out.put=e.code;break;}}console.log(JSON.stringify(out));`, { lockLeaseMs: 200, acquireMs: 60000 }).done));
 for (const r of runs) { const out = JSON.parse(r.out.trim().split('\n').pop()); assert.equal(out.put, 5, r.out); assert.ok(out.recover.every(v => v === true || v === 'store_lock_live'), r.out); }
 assert.equal(notes(f), 1 + n * 5); assert.deepEqual(leftovers(f.root), []);
});

// ---------- P1-2: a holder that may be alive is never broken ----------
test('auditor probe: live child in a synchronous transaction past its lease; recovery refused, the second writer waits, both writes kept in order', { timeout: 60000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', { order: 0 }); const signal = path.join(f.root, 'held.signal');
 const holder = child(f, `await s.transaction('owner',tx=>{tx.put('owner','note','holder',{order:1});fs.writeFileSync(${JSON.stringify(signal)},'');pause(3000);return 1;});console.log('RELEASED '+Date.now());`, { lockLeaseMs: 200 });
 t.after(() => holder.c.kill());
 await until(() => fs.existsSync(signal)); await wait(800);
 const lock = JSON.parse(fs.readFileSync(lockFile(f.root), 'utf8')); assert.ok(lock.expiresAt < Date.now() - 400, 'lease expired, not renewed (sync holder)');
 const s = f.openStore({ lockLeaseMs: 200, acquireMs: 300 });
 assert.equal(code(() => s.recover('owner', { decidedBy: 'supervisor', lockId: lock.id, evidenceRef: 'pid-reused-check' })), 'store_lock_live');
 assert.equal(code(() => s.recover('owner', { decidedBy: 'owner' })), 'store_lock_live');
 assert.equal(code(() => s.put('owner', 'note', 'intruder', {})), 'store_busy', 'no second writer while the holder lives');
 const second = child(f, `await s.transaction('owner',tx=>{const seen=tx.list('owner','note').map(n=>n.order).sort();tx.put('owner','note','second',{order:2});console.log('SEEN '+JSON.stringify(seen));});`, { lockLeaseMs: 200, acquireMs: 20000 });
 const [h, w] = await Promise.all([holder.done, second.done]);
 assert.match(h.out, /RELEASED/);
 assert.equal(/SEEN (.*)/.exec(w.out)[1], '[0,1]', 'the second writer entered only after the holder committed');
 assert.deepEqual(f.openStore().list('owner', 'note').map(n => n.order).sort(), [0, 1, 2], 'zero lost update after restart');
 assert.deepEqual(leftovers(f.root), []);
});
test('long async holder: recovery refused, the second writer waits, both writes kept', { timeout: 60000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', { order: 0 }); const signal = path.join(f.root, 'held.signal');
 const holder = child(f, `await s.transaction('owner',async tx=>{tx.put('owner','note','holder',{order:1});fs.writeFileSync(${JSON.stringify(signal)},'');await new Promise(r=>setTimeout(r,2000));});console.log('RELEASED '+Date.now());`, { lockLeaseMs: 200 });
 t.after(() => holder.c.kill());
 await until(() => fs.existsSync(signal)); await wait(800);
 const s = f.openStore({ lockLeaseMs: 200, acquireMs: 300 });
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live');
 assert.equal(code(() => s.put('owner', 'note', 'intruder', {})), 'store_busy');
 const second = child(f, `await s.transaction('owner',tx=>{const seen=tx.list('owner','note').map(n=>n.order).sort();tx.put('owner','note','second',{order:2});console.log('SEEN '+JSON.stringify(seen));});`, { lockLeaseMs: 200, acquireMs: 20000 });
 const [h, w] = await Promise.all([holder.done, second.done]);
 assert.match(h.out, /RELEASED/); assert.equal(/SEEN (.*)/.exec(w.out)[1], '[0,1]', 'the second writer entered only after the holder committed');
 assert.deepEqual(f.openStore().list('owner', 'note').map(n => n.order).sort(), [0, 1, 2]);
});
test('a holder really dead: recovered by evidence (no pid_reused), writes resume, restart sees them', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', {}); const signal = path.join(f.root, 'held.signal');
 const holder = child(f, `await s.transaction('owner',async()=>{fs.writeFileSync(${JSON.stringify(signal)},'');await new Promise(()=>{});});`, { lockLeaseMs: 200 });
 await until(() => fs.existsSync(signal)); holder.c.kill('SIGKILL'); await holder.done;
 const r = f.openStore().recover('owner', { decidedBy: 'supervisor' }); assert.deepEqual(r, { recovered: true, previousState: 'held' });
 assert.equal(code(() => f.openStore().put('owner', 'note', 'n-1', {})), 'ok'); assert.equal(notes(f), 2);
});
test('reused pid only with robust identity: an earlier process with this pid (other nonce, main thread) is gone; another thread, a legacy lock or an unprovable live pid is not', async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 // An earlier process that had this very pid: the pid now belongs to us.
 fs.writeFileSync(lockFile(f.root), meta(process.pid, { instance: 'an-earlier-process', thread: 0 }));
 assert.deepEqual(s.recover('owner', { decidedBy: 'supervisor' }), { recovered: true, previousState: 'held', reason: 'pid_reused' });
 fs.writeFileSync(lockFile(f.root), meta(process.pid, { instance: 'an-earlier-process', thread: 0 }));
 assert.equal(code(() => s.put('owner', 'note', 'n-1', {})), 'ok', 'reclaimed automatically too');
 // Same pid, another thread (or a lock without identity): cannot be told apart.
 for (const more of [{ instance: 'a-worker', thread: 3 }, {}]) {
  fs.writeFileSync(lockFile(f.root), meta(process.pid, more));
  assert.equal(code(() => s.put('owner', 'note', 'n-x', {})), 'store_busy');
  for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live');
  fs.unlinkSync(lockFile(f.root));
 }
 // A live pid of another process with another recorded start identity: proven
 // reused only where the OS exposes start identity (Linux); elsewhere fail closed.
 const other = sleeper(t); fs.writeFileSync(lockFile(f.root), meta(other.pid, { instance: 'x', thread: 0, start: 'boot:1' }));
 if (fs.existsSync('/proc/self/stat')) assert.equal(s.recover('owner', { decidedBy: 'supervisor' }).reason, 'pid_reused');
 else for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live');
});
test('suspend/resume: a stopped holder is alive; nothing breaks it; on resume it ends and the next writer follows', { timeout: 60000, skip: process.platform === 'win32' && 'SIGSTOP/SIGCONT do not exist on Windows; a frozen holder is covered by the synchronous holder probe' }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); f.openStore().put('owner', 'note', 'n-0', { order: 0 }); const signal = path.join(f.root, 'held.signal');
 const holder = child(f, `await s.transaction('owner',async tx=>{tx.put('owner','note','holder',{order:1});fs.writeFileSync(${JSON.stringify(signal)},'');await new Promise(r=>setTimeout(r,300));});console.log('RELEASED '+Date.now());`, { lockLeaseMs: 200 });
 t.after(() => holder.c.kill());
 await until(() => fs.existsSync(signal)); holder.c.kill('SIGSTOP'); await wait(1000);
 const s = f.openStore({ lockLeaseMs: 200, acquireMs: 300 });
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live');
 assert.equal(code(() => s.put('owner', 'note', 'intruder', {})), 'store_busy');
 holder.c.kill('SIGCONT'); await holder.done;
 assert.equal(code(() => f.openStore().put('owner', 'note', 'second', { order: 2 })), 'ok');
 assert.deepEqual(f.openStore().list('owner', 'note').map(n => n.order).sort(), [0, 1, 2]);
});
