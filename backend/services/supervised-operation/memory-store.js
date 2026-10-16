'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const MemoryEngine = require('../../memory/memoryEngine');
const { copy, fail } = require('./scope-session');
// Windows reports a rename, read or unlink that collides with another handle
// on the same file (a reader in another process, an indexer, an antivirus
// scan) as EPERM/EBUSY/EACCES. The operation did not happen; a bounded retry
// clears it. Any other error is returned at once.
const TRANSIENT_FS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const digest = text => createHash('sha256').update(text).digest('hex');
function retrying(fn, budgetMs) { const end = Date.now() + budgetMs; for (let i = 0; ; i++) { try { return fn(); } catch (e) { if (!TRANSIENT_FS.has(e.code) || Date.now() >= end) throw e; pause(Math.min(2 ** i, 50)); } } }
const storageError = (code, error) => Object.assign(new Error(code), { code, storageCode: (error && (error.code || error.name)) || null });
// Reuses the existing MemoryEngine/repository. One server-derived owner maps to
// one hashed filename, never to a path supplied by a user or agent. Every row
// is sealed over [owner, kind, id, value]: a row edited, moved to another owner
// or swapped between records fails closed instead of becoming canonical state.
// A snapshot is published by temp file + fsync + rename. When the rename still
// fails after the bounded retry, the file on disk decides: the snapshot that
// was loaded means nothing was published (store_write_failed, determinate);
// the new one means it was (success); anything else is commit_unknown.
// While a writer publishes, a marker asks readers to hold off briefly: on
// Windows a file kept open by readers cannot be replaced. It is only a hint
// (an old marker is ignored); correctness rests on the check after a rename.
const PUBLISH_HINT_MS = 1000;
function yieldToWriter(marker) { const end = Date.now() + PUBLISH_HINT_MS; for (let i = 0; Date.now() < end; i++) { let since; try { since = Date.now() - fs.statSync(marker).mtimeMs; } catch { return; } if (since > PUBLISH_HINT_MS) return; pause(Math.min(2 ** i, 10)); } }
function repositoryFor(file, { retryMs }) { let loaded = null; const marker = file + '.publish'; return {
 loadSnapshot() { yieldToWriter(marker); if (!fs.existsSync(file)) { loaded = null; return { shortTermMemory: [], longTermMemory: [] }; } const text = retrying(() => fs.readFileSync(file, 'utf8'), retryMs); loaded = digest(text); const snapshot = JSON.parse(text); if (!Array.isArray(snapshot.shortTermMemory) || !Array.isArray(snapshot.longTermMemory)) fail('stored_data_invalid'); return snapshot; },
 saveSnapshot(snapshot) {
  const text = JSON.stringify(snapshot); const temp = file + '.' + randomUUID() + '.tmp';
  try {
   try { const fd = fs.openSync(temp, 'wx'); try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (error) { throw storageError('store_write_failed', error); }
   try { fs.writeFileSync(marker, ''); } catch { /* only a hint */ }
   try { retrying(() => fs.renameSync(temp, file), retryMs); } catch (error) {
    let current;
    try { current = fs.existsSync(file) ? digest(retrying(() => fs.readFileSync(file, 'utf8'), retryMs)) : null; } catch { throw storageError('commit_unknown', error); }
    if (current === digest(text)) return;
    if (current === loaded) throw storageError('store_write_failed', error);
    throw storageError('commit_unknown', error);
   }
  } finally {
   try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* a leftover temp file is never read */ }
   try { fs.unlinkSync(marker); } catch { /* an old marker is ignored */ }
  }
 },
}; }
const ID=/^[A-Za-z0-9:_-]{3,128}$/;const KIND=/^[-a-z]{3,30}$/;
const HOST = os.hostname();
// Process-wide: locks held right now by this process (by lock id), and owners
// whose lock is held across an await (a synchronous writer cannot wait for
// those without blocking the very holder it waits for).
const holding = new Set(); const asyncHolders = new Map();
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function createMemoryStoreFactory({ root, integrity, maxRecords = 2000, lockLeaseMs = 10000, acquireMs = 3000, retryMs = 2000 }) {
 if(typeof root!=='string'||!path.isAbsolute(root))fail('memory_root_invalid');
 if(!integrity||typeof integrity.seal!=='function'||typeof integrity.verify!=='function')fail('integrity_required');
 return sessions => {
  fs.mkdirSync(root,{recursive:true});
  const fileOf = handle => path.join(root,createHash('sha256').update(sessions.key(handle)).digest('hex')+'.json');
  function load(handle) {
   const owner=sessions.key(handle); const e=new MemoryEngine({repository:repositoryFor(fileOf(handle),{retryMs})});
   const rows=new Map();
   for(const row of e.longTermMemory){const d=row&&row.data;
    if(!d||d.owner!==owner)fail('stored_scope_invalid');
    if(!integrity.verify([owner,d.kind,d.id,d.value],d.seal))fail('stored_integrity_invalid');
    rows.set(JSON.stringify([d.kind,d.id]),d);
   }
   return {e,rows,owner};
  }
  function view(handle,state) {
   const {rows,owner}=state;
   return {
    get(h,kind,id){if(sessions.key(h)!==owner)fail('stored_scope_invalid');const d=rows.get(JSON.stringify([kind,id]));if(!d)fail('resource_not_found');return copy(d.value);},
    list(h,kind){if(sessions.key(h)!==owner)fail('stored_scope_invalid');return [...rows.values()].filter(d=>d.kind===kind).map(d=>copy(d.value));},
    put(h,kind,id,value){if(sessions.key(h)!==owner)fail('stored_scope_invalid');if(!ID.test(id)||!KIND.test(kind))fail('resource_id_invalid');const k=JSON.stringify([kind,id]);if(rows.size>=maxRecords&&!rows.has(k))fail('store_capacity');const plain=JSON.parse(JSON.stringify(value));rows.set(k,{owner,kind,id,value:plain,seal:integrity.seal([owner,kind,id,plain])});return copy(plain);},
    remove(h,kind,id){if(sessions.key(h)!==owner)fail('stored_scope_invalid');rows.delete(JSON.stringify([kind,id]));},newId:randomUUID,capacity:maxRecords
   };
  }
  // Owner lock with a lease: { id, pid, host, acquiredAt, expiresAt, state }.
  // An abandoned lock is reclaimed only with evidence: its lease expired AND
  // its holder on this host no longer holds it (the process is gone, or it is
  // this process and no transaction of it holds that id). A live holder, a
  // holder on another host, an unreadable lock or one left by an uncertain
  // commit is never reclaimed here: that needs recover().
  const lockOf = handle => fileOf(handle) + '.lock';
  function readLock(file) { try { return JSON.parse(retrying(() => fs.readFileSync(file, 'utf8'), retryMs)); } catch (e) { return e.code === 'ENOENT' ? null : { corrupt: true }; } }
  function age(file) { try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return 0; } }
  function gone(m) { return m.host === HOST && Number.isInteger(m.pid) && (m.pid === process.pid ? !holding.has(m.id) : !alive(m.pid)); }
  function abandoned(m, now) { return !!m && !m.corrupt && m.state === 'held' && now > m.expiresAt && gone(m); }
  function create(file) {
   const now = Date.now(); const meta = { id: randomUUID(), pid: process.pid, host: HOST, acquiredAt: now, expiresAt: now + lockLeaseMs, state: 'held' };
   let fd; try { fd = fs.openSync(file, 'wx'); } catch (e) { if (e.code === 'EEXIST') return null; throw e; }
   try { fs.writeFileSync(fd, JSON.stringify(meta)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
   return meta;
  }
  // A lock being written is briefly empty; only an old unreadable one is stuck.
  function blocked(file, held) { if (held.state === 'uncertain' || (held.corrupt && age(file) > lockLeaseMs)) fail('store_recovery_required'); }
  // Reclaiming is serialized by a guard file, and the lock is removed only if
  // it is still the same abandoned one: a fresh lock is never removed.
  function reclaim(file, expected) {
   const guard = file + '.reclaim'; const own = create(guard);
   if (!own) { const g = readLock(guard); if (g && (g.corrupt ? age(guard) > lockLeaseMs : abandoned(g, Date.now()))) fail('store_recovery_required'); return false; }
   holding.add(own.id);
   try { const again = readLock(file); if (again && expected(again)) { retrying(() => fs.unlinkSync(file), retryMs); return true; } return false; }
   finally { holding.delete(own.id); retrying(() => fs.unlinkSync(guard), retryMs); }
  }
  function tryAcquire(handle) {
   const file = lockOf(handle); const meta = create(file); if (meta) { holding.add(meta.id); return meta; }
   const held = readLock(file); if (!held) return null;
   blocked(file, held);
   if (abandoned(held, Date.now())) reclaim(file, again => again.id === held.id && abandoned(again, Date.now()));
   return null;
  }
  function release(handle, meta) { holding.delete(meta.id); const file = lockOf(handle); const held = readLock(file); if (held && held.id === meta.id) retrying(() => fs.unlinkSync(file), retryMs); }
  // The lock stays, marked: nobody reclaims it automatically.
  function keepUncertain(handle, meta) { holding.delete(meta.id); try { fs.writeFileSync(lockOf(handle), JSON.stringify({ ...meta, state: 'uncertain' })); } catch { /* the held lock stays: still fail closed */ } }
  function save(state){state.e.longTermMemory=[...state.rows.values()].map(data=>({timestamp:new Date(),data}));try{state.e.persistMemory();}catch(e){if(['store_write_failed','commit_unknown'].includes(e.code))throw e;throw storageError('commit_unknown',e);}}
  function finish(handle, meta, error) { if (error && error.code === 'commit_unknown') keepUncertain(handle, meta); else release(handle, meta); }
  // All writers share one owner lock and wait for it a bounded time.
  function mutate(handle,operation){
   const end = Date.now() + acquireMs; let meta;
   for (let i = 0; !(meta = tryAcquire(handle)); i++) { if (asyncHolders.get(lockOf(handle)) || Date.now() >= end) fail('store_busy'); pause(Math.min(2 ** i, 20)); }
   let failure = null; try { const state = load(handle); const result = operation(view(handle, state)); save(state); return result; } catch (e) { failure = e; throw e; } finally { finish(handle, meta, failure); }
  }
  // A synchronous operation runs without yielding while the lock is held, so
  // writers of this same process never find it taken by an unfinished await.
  async function transaction(handle,operation){
   const end = Date.now() + acquireMs; let meta;
   for (let i = 0; !(meta = tryAcquire(handle)); i++) { if (Date.now() >= end) fail('store_busy'); await new Promise(r => setTimeout(r, Math.min(2 ** i, 20))); }
   let failure = null;
   try {
    const state = load(handle); let result = operation(view(handle, state));
    if (result && typeof result.then === 'function') { const file = lockOf(handle); asyncHolders.set(file, (asyncHolders.get(file) || 0) + 1); try { result = await result; } finally { asyncHolders.set(file, asyncHolders.get(file) - 1); } }
    save(state); return result;
   } catch (e) { failure = e; throw e; } finally { finish(handle, meta, failure); }
  }
  // Explicit recovery, owner-scoped, never automatic: after an uncertain
  // commit or an unreadable or foreign lock. A live holder on this host is
  // never broken; the lock is removed only once the snapshot on disk loads and
  // every seal verifies (a rename publishes the old or the new one, whole).
  function recover(handle, { decidedBy } = {}) {
   if (!['owner', 'supervisor'].includes(decidedBy)) fail('recovery_authority_required');
   const file = lockOf(handle); const held = readLock(file);
   if (!held) return Object.freeze({ recovered: false, reason: 'no_lock' });
   const live = m => !m.corrupt && m.state === 'held' && (m.host === HOST ? !gone(m) : decidedBy !== 'supervisor');
   if (live(held)) fail('store_lock_live');
   load(handle);
   const removed = reclaim(file, again => (held.corrupt ? !!again.corrupt : again.id === held.id) && !live(again));
   return Object.freeze({ recovered: removed, previousState: held.corrupt ? 'corrupt' : held.state });
  }
  return Object.freeze({
   get:(h,k,id)=>view(h,load(h)).get(h,k,id),list:(h,k)=>view(h,load(h)).list(h,k),
   put:(h,k,id,v)=>mutate(h,tx=>tx.put(h,k,id,v)),remove:(h,k,id)=>mutate(h,tx=>tx.remove(h,k,id)),
   transaction,recover,newId:randomUUID,capacity:maxRecords,persistence:'LOCAL_MEMORY_REPOSITORY_SEALED'
  });
 };
}
module.exports={createMemoryStoreFactory};
