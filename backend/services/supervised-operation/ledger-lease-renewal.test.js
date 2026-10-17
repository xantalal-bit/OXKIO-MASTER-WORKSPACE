'use strict';
// Reaudit P2 (17/10/2026): the lease renewal of a live async holder is atomic.
// A renewal that fails (ENOSPC, EPERM, EBUSY, EACCES) or crashes at any point
// never leaves the live lock truncated, so recover() can never break that
// holder and a second writer can never enter while it lives.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto'); const { spawn } = require('node:child_process');
const { createMemoryStoreFactory } = require('./memory-store');
const { createHmacIntegrity } = require('./integrity');

function fixture(t, storeOptions = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-renew-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const key = randomBytes(32);
 const openStore = (more = {}) => createMemoryStoreFactory({ root, integrity: createHmacIntegrity({ key }), ...storeOptions, ...more })({ key: h => h });
 return { root, key, openStore };
}
const lockFile = root => path.join(root, fs.readdirSync(root).find(n => /^[0-9a-f]{64}\.json$/.test(n))) + '.lock';
const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms = 15000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };
const values = f => f.openStore().list('owner', 'note').map(n => n.v).sort();
// Raw read of the lock as another process sees it (Windows may refuse a read
// that collides with the rename: retried, never judged).
function rawLock(file) { for (;;) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; } } }
// Renewal temp files: <lock>.<uuid>.tmp. `hooks` patch fs inside the child.
const RENEW = `const isRenew=p=>/\\.lock\\.[0-9a-f-]{36}\\.tmp$/.test(String(p));const renewFds=new Set();const open=fs.openSync;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(isRenew(p))renewFds.add(fd);return fd;};const close=fs.closeSync;fs.closeSync=fd=>{renewFds.delete(fd);return close(fd);};let inPlace=0;const wfs=fs.writeFileSync;`;
const FAULT = {
 write: errno => RENEW + `fs.writeFileSync=(p,d,...a)=>{if(typeof p==='number'&&renewFds.has(p)&&armed){fs.writeSync(p,String(d).slice(0,7));throw Object.assign(new Error(${JSON.stringify(errno)}),{code:${JSON.stringify(errno)}});}if(String(p).endsWith('.lock'))inPlace++;return wfs(p,d,...a);};`,
 publish: errno => RENEW + `const ren=fs.renameSync;fs.renameSync=(a,b)=>{if(isRenew(a)&&armed)throw Object.assign(new Error(${JSON.stringify(errno)}),{code:${JSON.stringify(errno)}});return ren(a,b);};fs.writeFileSync=(p,...a)=>{if(String(p).endsWith('.lock'))inPlace++;return wfs(p,...a);};`,
 // The reaudit's original vector: an in-place write of the lock that truncates and fails.
 inPlace: () => RENEW + `fs.writeFileSync=(p,d,...a)=>{if(armed&&String(p).endsWith('.lock')){inPlace++;wfs(p,'');throw Object.assign(new Error('ENOSPC'),{code:'ENOSPC'});}return wfs(p,d,...a);};`,
};
function child(f, hooks, body, storeOptions) {
 const src = `const fs=require('node:fs');const path=require('node:path');const so=${JSON.stringify(__dirname)};let armed=false;${hooks}
 const {createMemoryStoreFactory}=require(path.join(so,'memory-store'));const {createHmacIntegrity}=require(path.join(so,'integrity'));
 const s=createMemoryStoreFactory({root:${JSON.stringify(f.root)},integrity:createHmacIntegrity({key:Buffer.from('${f.key.toString('hex')}','hex')}),...${JSON.stringify(storeOptions)}})({key:h=>h});
 (async()=>{${body}})().catch(e=>{console.log('FATAL '+(e.code||e.message));});`;
 const c = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
 c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
 return { c, done: new Promise(r => c.on('exit', status => r({ status, out }))) };
}
const HOLD = sig => `await s.transaction('owner',async tx=>{tx.put('owner','note','holder',{v:1});armed=true;fs.writeFileSync(${JSON.stringify(sig)},'');await new Promise(r=>setTimeout(r,2500));});console.log('END '+Date.now()+' inPlace='+(typeof inPlace==='number'?inPlace:0));`;

const CASES = [['ENOSPC', 'write'], ['EPERM', 'write'], ['EBUSY', 'write'], ['EACCES', 'write'], ['ENOSPC', 'publish'], ['EPERM', 'publish'], ['EBUSY', 'publish'], ['EACCES', 'publish'], ['ENOSPC', 'inPlace']];
for (const [errno, phase] of CASES) test('reaudit probe: ' + errno + ' on every renewal (' + phase + ') of a live async holder past its lease: lock stays valid, recovery refused, second writer waits, zero lost update', { timeout: 60000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 150 }); f.openStore().put('owner', 'note', 'n-0', { v: 0 }); const sig = path.join(f.root, 'held.signal');
 const holder = child(f, FAULT[phase](errno), HOLD(sig), { lockLeaseMs: 150 }); t.after(() => holder.c.kill());
 await until(() => fs.existsSync(sig)); await wait(800); // > 5 leases: every renewal has failed
 const lock = rawLock(lockFile(f.root));
 assert.equal(lock.pid, holder.c.pid, 'the original lock is intact and readable'); assert.equal(lock.state, 'held'); if (phase !== 'inPlace') assert.ok(lock.expiresAt < Date.now(), 'lease not renewed (renewals failed)');
 const s = f.openStore({ acquireMs: 200 });
 assert.equal(code(() => s.recover('owner', { decidedBy: 'owner' })), 'store_lock_live');
 assert.equal(code(() => s.recover('owner', { decidedBy: 'supervisor' })), 'store_lock_live');
 assert.equal(code(() => s.put('owner', 'note', 'intruder', { v: 9 })), 'store_busy');
 assert.equal(rawLock(lockFile(f.root)).id, lock.id);
 // What the second writer sees on entering proves the order: the holder's write already committed.
 const second = child(f, '', `await s.transaction('owner',tx=>{const seen=tx.list('owner','note').map(n=>n.v).sort();tx.put('owner','note','second',{v:2});console.log('SEEN '+JSON.stringify(seen));});`, { lockLeaseMs: 150, acquireMs: 20000 });
 const [h, w] = await Promise.all([holder.done, second.done]);
 const [, , inPlace] = /END (\d+) inPlace=(\d+)/.exec(h.out);
 assert.equal(Number(inPlace), 0, 'the live lock is never written in place');
 assert.equal(/SEEN (.*)/.exec(w.out)[1], '[0,1]', 'second writer entered only after the holder committed');
 assert.deepEqual(values(f), [0, 1, 2], 'every committed write kept, restart included');
 assert.deepEqual(fs.readdirSync(f.root).filter(n => n.endsWith('.lock') || /\.lock\.[0-9a-f-]{36}\.tmp$/.test(n)), [], 'no lock and no renewal temp left');
});

const CRASH = {
 during_temp_write: RENEW + `fs.writeFileSync=(p,d,...a)=>{if(typeof p==='number'&&renewFds.has(p)&&armed){fs.writeSync(p,String(d).slice(0,7));process.exit(9);}return wfs(p,d,...a);};`,
 before_publish: RENEW + `const ren=fs.renameSync;fs.renameSync=(a,b)=>{if(isRenew(a)&&armed)process.exit(9);return ren(a,b);};`,
 after_publish: RENEW + `const ren=fs.renameSync;fs.renameSync=(a,b)=>{ren(a,b);if(isRenew(a)&&armed)process.exit(9);};`,
};
for (const boundary of Object.keys(CRASH)) test('crash ' + boundary + ' of a renewal: the lock left is whole; the dead holder is recovered by evidence, its uncommitted write never appears', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 150 }); f.openStore().put('owner', 'note', 'n-0', { v: 0 }); const sig = path.join(f.root, 'held.signal');
 const holder = child(f, CRASH[boundary], HOLD(sig), { lockLeaseMs: 150 });
 const r = await holder.done; assert.equal(r.status, 9, r.out);
 const lock = rawLock(lockFile(f.root)); assert.equal(lock.pid, holder.c.pid); assert.equal(lock.state, 'held');
 if (boundary === 'after_publish') assert.ok(lock.expiresAt > lock.acquiredAt + 150, 'renewed record published whole');
 await wait(Math.max(0, lock.expiresAt - Date.now()) + 100);
 assert.deepEqual(f.openStore().recover('owner', { decidedBy: 'owner' }), { recovered: true, previousState: 'held' });
 assert.equal(code(() => f.openStore().put('owner', 'note', 'after', { v: 2 })), 'ok');
 assert.deepEqual(values(f), [0, 2]);
});

test('consecutive renewals: the lock is always whole, the same holder, and its lease moves forward', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 150 }); f.openStore().put('owner', 'note', 'n-0', { v: 0 }); const sig = path.join(f.root, 'held.signal');
 const holder = child(f, '', HOLD(sig), { lockLeaseMs: 150 }); t.after(() => holder.c.kill());
 await until(() => fs.existsSync(sig)); const file = lockFile(f.root); const seen = []; const end = Date.now() + 1800;
 while (Date.now() < end) { seen.push(rawLock(file)); await wait(5); }
 assert.equal(new Set(seen.map(l => l.id)).size, 1, 'one holder throughout');
 const leases = [...new Set(seen.map(l => l.expiresAt))]; assert.ok(leases.length >= 10, 'renewed ' + leases.length + ' times');
 assert.ok(leases.every((v, i) => i === 0 || v > leases[i - 1]), 'lease only moves forward');
 const s = f.openStore({ acquireMs: 200 }); assert.equal(code(() => s.recover('owner', { decidedBy: 'supervisor' })), 'store_lock_live');
 await holder.done; assert.deepEqual(values(f), [0, 1]);
 assert.deepEqual(fs.readdirSync(f.root).filter(n => n.endsWith('.tmp') || n.endsWith('.lock')), []);
});

test('ABA: a renewal never publishes over a lock that is no longer exactly this holder\'s', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 60 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', { v: 0 });
 let release; const gate = new Promise(r => { release = r; }); let entered; const inside = new Promise(r => { entered = r; });
 const held = s.transaction('owner', async () => { entered(); await gate; });
 await inside; const file = lockFile(f.root); const mine = rawLock(file);
 for (const other of [{ ...mine, id: randomUUID() }, { ...mine, instance: 'another-instance' }, { ...mine, thread: 7 }, { ...mine, pid: mine.pid + 1 }]) {
  const text = JSON.stringify(other); fs.writeFileSync(file, text); await wait(200); // > 3 renewal periods
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'not overwritten: ' + JSON.stringify(Object.keys(other).filter(k => other[k] !== mine[k])));
 }
 fs.writeFileSync(file, JSON.stringify(mine)); release(); await held;
 assert.ok(!fs.existsSync(file)); assert.deepEqual(fs.readdirSync(f.root).filter(n => n.endsWith('.tmp')), []);
});
