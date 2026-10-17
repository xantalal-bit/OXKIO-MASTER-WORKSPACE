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
   // Windows refuses to create a name still pending deletion (EPERM): busy.
   let fd; try { fd = fs.openSync(file, 'wx'); } catch (e) { if (e.code === 'EEXIST' || TRANSIENT_FS.has(e.code)) return null; throw e; }
   try { fs.writeFileSync(fd, JSON.stringify(meta)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
   return meta;
  }
  // A lock being written is briefly empty; only an old unreadable one is stuck.
  function blocked(file, held) { if (held.state === 'uncertain' || (held.corrupt && age(file) > lockLeaseMs)) fail('store_recovery_required'); }
  const same = (a, b) => (a.corrupt ? !!b.corrupt : !b.corrupt && b.id === a.id);
  // Moves a lock or guard aside atomically and deletes it only if what was
  // moved is still the one judged stale; anything else (a fresh one created
  // meanwhile) goes back unchanged, so a remover never deletes a fresh one.
  function removeIfStill(file, expected) {
   const aside = file + '.' + randomUUID() + '.stale';
   try { retrying(() => fs.renameSync(file, aside), retryMs); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
   let text = ''; try { text = retrying(() => fs.readFileSync(aside, 'utf8'), retryMs); } catch { /* judged as unreadable */ }
   let moved; try { moved = JSON.parse(text); } catch { moved = { corrupt: true }; }
   if (expected(moved, aside)) { try { retrying(() => fs.unlinkSync(aside), retryMs); } catch { /* an aside file is never read as a lock */ } return true; }
   // Put back: if the name was taken meanwhile, keep the aside copy and stop.
   try { const fd = fs.openSync(file, 'wx'); try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { fail('store_recovery_required'); }
   try { fs.unlinkSync(aside); } catch { /* never read as a lock */ }
   return false;
  }
  // The guard that serializes reclaiming follows the lock's own evidence: an
  // abandoned guard (lease expired, holder gone on this host) is cleared
  // automatically; an unreadable one older than a lease only by recover(); one
  // of another host only by a supervisor; a live one never.
  function guardStale(g, file, authority) {
   if (g.corrupt) return !!authority && age(file) > lockLeaseMs;
   if (abandoned(g, Date.now())) return true;
   return authority === 'supervisor' && g.host !== HOST && g.state === 'held' && Date.now() > g.expiresAt;
  }
  // One stale guard instance is cleared by exactly one process: the one that
  // creates its claim file (exclusive create). Losers never touch the guard,
  // so the fresh guard the winner then takes cannot be moved by them. Claims
  // stay (one tiny file per incident) so a late loser cannot claim it again.
  function stamp(file) { try { const s = fs.statSync(file); return s.mtimeMs + ':' + s.size; } catch { return null; } }
  function clearGuard(guard, authority) {
   const before = stamp(guard); const g = readLock(guard); if (!g || !before || stamp(guard) !== before) return false;
   if (!guardStale(g, guard, authority)) { if (g.corrupt && age(guard) > lockLeaseMs) fail('store_recovery_required'); if (authority) fail('store_lock_live'); return false; }
   const claim = guard + '-' + digest(g.corrupt ? 'corrupt:' + before : 'id:' + g.id).slice(0, 32) + '.won';
   try { fs.closeSync(fs.openSync(claim, 'wx')); } catch (e) { if (e.code === 'EEXIST' || TRANSIENT_FS.has(e.code)) return false; throw e; }
   removeIfStill(guard, (again, aside) => same(g, again) && guardStale(again, aside, authority));
   return true;
  }
  // Reclaiming is serialized by the guard, and the lock is removed only if it
  // is still the same abandoned one: a fresh lock is never removed.
  function reclaim(file, expected, authority = null) {
   const guard = file + '.reclaim'; let own = create(guard);
   if (!own) { if (!clearGuard(guard, authority)) return false; own = create(guard); if (!own) return false; }
   holding.add(own.id);
   // Judged again under the guard: what was evaluated before may already be
   // gone and replaced by a live writer's lock, which is left untouched. An
   // abandoned lock cannot change while the guard is held.
   try { const current = readLock(file); if (!current || !expected(current, file)) return false; return removeIfStill(file, expected); }
   finally {
    holding.delete(own.id);
    // A guard left behind (unlink refused) is abandoned once its lease ends.
    try { retrying(() => fs.unlinkSync(guard), retryMs); } catch { /* reclaimed by evidence later */ }
   }
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
    if (result && typeof result.then === 'function') {
     // A holder awaiting keeps its lease fresh, so an expired lease on this
     // host is evidence that whoever holds that pid is not this holder.
     const file = lockOf(handle); asyncHolders.set(file, (asyncHolders.get(file) || 0) + 1);
     const renew = setInterval(() => { const held = readLock(file); if (held && held.id === meta.id) { try { fs.writeFileSync(file, JSON.stringify({ ...meta, expiresAt: Date.now() + lockLeaseMs })); } catch { /* the previous lease stands */ } } }, Math.max(20, Math.floor(lockLeaseMs / 3)));
     try { result = await result; } finally { clearInterval(renew); asyncHolders.set(file, asyncHolders.get(file) - 1); }
    }
    save(state); return result;
   } catch (e) { failure = e; throw e; } finally { finish(handle, meta, failure); }
  }
  // Explicit recovery, owner-scoped, never automatic: after an uncertain
  // commit or an unreadable or foreign lock. A live holder on this host is
  // never broken; the lock is removed only once the snapshot on disk loads and
  // every seal verifies (a rename publishes the old or the new one, whole).
  // A reused pid: the lock's pid is alive but its lease ran out more than a
  // whole lease ago (a live holder renews it). Only a supervisor, naming the
  // exact lock id it inspected and an evidence code, may clear it; never this
  // process's own held lock, never automatically, never the owner.
  function recover(handle, { decidedBy, lockId = null, evidenceRef = null } = {}) {
   if (!['owner', 'supervisor'].includes(decidedBy)) fail('recovery_authority_required');
   const file = lockOf(handle); const held = readLock(file);
   if (!held) return Object.freeze({ recovered: false, reason: 'no_lock' });
   if (held.corrupt && age(file) <= lockLeaseMs) fail('store_lock_live');
   const live = m => !m.corrupt && m.state === 'held' && (m.host === HOST ? !gone(m) : decidedBy !== 'supervisor');
   const reused = m => decidedBy === 'supervisor' && !m.corrupt && m.state === 'held' && m.host === HOST && lockId === m.id
    && typeof evidenceRef === 'string' && /^[A-Za-z0-9:._-]{1,128}$/.test(evidenceRef) && Date.now() > m.expiresAt + lockLeaseMs && !(m.pid === process.pid && holding.has(m.id));
   if (live(held) && !reused(held)) fail('store_lock_live');
   load(handle);
   // An unreadable lock is removed only while it is still an old one: a lock
   // being written right now is briefly empty too.
   const removed = reclaim(file, (again, aside) => same(held, again) && (again.corrupt ? age(aside) > lockLeaseMs : !live(again) || reused(again)), decidedBy);
   return Object.freeze({ recovered: removed, previousState: held.corrupt ? 'corrupt' : held.state, ...(live(held) ? { reason: 'pid_reused' } : {}) });
  }
  return Object.freeze({
   get:(h,k,id)=>view(h,load(h)).get(h,k,id),list:(h,k)=>view(h,load(h)).list(h,k),
   put:(h,k,id,v)=>mutate(h,tx=>tx.put(h,k,id,v)),remove:(h,k,id)=>mutate(h,tx=>tx.remove(h,k,id)),
   transaction,recover,newId:randomUUID,capacity:maxRecords,persistence:'LOCAL_MEMORY_REPOSITORY_SEALED'
  });
 };
}
module.exports={createMemoryStoreFactory};
