'use strict';
// Only SQL I/O runs here. The main thread keeps the existing synchronous V3
// contract; transaction views live only until COMMIT/ROLLBACK, never as a cache.
const { parentPort, workerData } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { runPostgresScopedTransaction } = require('../../repositories/postgres/postgres-scoped-transaction');
const pool = new Pool({ ...workerData.connection, connectionTimeoutMillis: 3000, max: 8 });
pool.on('error',()=>{/* Idle broken connections are discarded by pg; no raw client/credential diagnostics. */});
const pending = new Map();
const safe = error => Object.assign(new Error('postgres_store_failed'), { code: ['store_busy','transaction_aborted','postgres_runtime_role_invalid'].includes(error.code) ? error.code : error.code === '55P03' || error.code === '57014' ? 'store_busy' : 'postgres_store_failed' });
const unknown = () => Object.assign(new Error('commit_unknown'), { code: 'commit_unknown' });
function reply(shared, value) {
 const header = new Int32Array(shared, 0, 2); const bytes = Buffer.from(JSON.stringify(value));
 if (bytes.length > shared.byteLength - 8) { reply(shared, { error: 'store_response_too_large' }); return; }
 new Uint8Array(shared, 8, bytes.length).set(bytes); Atomics.store(header, 1, bytes.length); Atomics.store(header, 0, 1); Atomics.notify(header, 0);
}
const scoped = (scope, operation) => runPostgresScopedTransaction({ pool, rawScope: scope, normalizeScope: s => s, operation:async(client,scope)=>{const role=(await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];if(!role||role.rolsuper||role.rolbypassrls)throw Object.assign(new Error('postgres_runtime_role_invalid'),{code:'postgres_runtime_role_invalid'});return operation(client,scope);}, sanitizeError: safe, commitUnknownError: unknown });
parentPort.on('message', async ({ action, scope, token, rows, shared }) => {
 try {
  if (action === 'close') { await pool.end(); reply(shared,{ok:true}); return; }
  if (action === 'read') {
   const result = await scoped(scope, async client => (await client.query('SELECT records FROM oxkio_v3.memory_snapshots WHERE tenant_id=$1 AND client_id=$2 AND user_id=$3',[scope.tenantId,scope.clientId,scope.userId])).rows[0]?.records || []);
   reply(shared,{rows:result}); return;
  }
  if (action === 'begin') {
   const id = randomUUID(); let finalShared = null;
   try {
    await scoped(scope, async client => {
     await client.query("SET LOCAL lock_timeout = '3s'");
     await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
     // Serialize before reading, including owners without a row yet. Hash
     // collisions only serialize unrelated owners; SQL/RLS use full identity.
     await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([scope.tenantId,scope.clientId,scope.userId])]);
     const saved=(await client.query('SELECT records FROM oxkio_v3.memory_snapshots WHERE tenant_id=$1 AND client_id=$2 AND user_id=$3',[scope.tenantId,scope.clientId,scope.userId])).rows[0]?.records || [];
     const decision = new Promise(resolve => pending.set(id, resolve));
     reply(shared,{token:id,rows:saved});
     const next=await decision; finalShared=next.shared;
     if(next.action==='rollback')throw Object.assign(new Error('transaction_aborted'),{code:'transaction_aborted'});
     await client.query('INSERT INTO oxkio_v3.memory_snapshots(tenant_id,client_id,user_id,records) VALUES($1,$2,$3,$4::json) ON CONFLICT(tenant_id,client_id,user_id) DO UPDATE SET records=EXCLUDED.records',[scope.tenantId,scope.clientId,scope.userId,JSON.stringify(next.rows)]);
    });
    reply(finalShared,{ok:true});
   } catch(error) { reply(finalShared || shared,error.code==='transaction_aborted'?{ok:true}:{error:error.code || 'postgres_store_failed'}); }
   finally { pending.delete(id); }
   return;
  }
  if(action==='commit'||action==='rollback') {
   const resolve=pending.get(token); if(!resolve)throw new Error('transaction_missing');
   pending.delete(token);resolve({action,rows,shared}); return;
  }
  throw new Error('command_invalid');
 } catch(error) { reply(shared,{error:safe(error).code}); }
});
