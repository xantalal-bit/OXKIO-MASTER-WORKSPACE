'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { copy, fail } = require('./scope-session');
const ID=/^[A-Za-z0-9:_-]{3,128}$/; const KIND=/^[-a-z]{3,30}$/;
function createPostgresMemoryStoreFactory({connection,integrity,maxRecords=2000,timeoutMs=10000}={}) {
 if(!connection || typeof connection.host!=='string' || typeof connection.database!=='string')fail('postgres_connection_required');
 if(!integrity || typeof integrity.seal!=='function' || typeof integrity.verify!=='function')fail('integrity_required');
 if(!Number.isSafeInteger(maxRecords)||maxRecords<1)fail('store_capacity_invalid');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)fail('store_timeout_invalid');
 return sessions => {
  const worker=new Worker(path.join(__dirname,'postgres-memory-worker.js'),{workerData:{connection}});
  let broken=false; let closed=false; worker.on('error',()=>{broken=true;});
  const active=new Set();
  function request(message) {
   if(broken||closed)fail('postgres_store_unavailable');
   const shared=new SharedArrayBuffer(8*1024*1024);const header=new Int32Array(shared,0,2);
   worker.postMessage({...message,shared}); return {shared,header};
  }
  function result(r,action) {
   if(Atomics.load(r.header,0)!==1){broken=true;fail(action==='commit'?'commit_unknown':'postgres_store_unavailable');}
   const value=JSON.parse(Buffer.from(r.shared,8,Atomics.load(r.header,1)).toString());
   if(value.error)fail(value.error);return value;
  }
  function call(message) {const r=request(message);Atomics.wait(r.header,0,0,timeoutMs);return result(r,message.action);}
  async function callAsync(message) {const r=request(message);await Atomics.waitAsync(r.header,0,0,timeoutMs).value;return result(r,message.action);}
  function identity(handle) {
   const owner=sessions.key(handle);const scope=sessions.scope(handle);
   if(!scope||!['tenantId','clientId','userId'].every(k=>typeof scope[k]==='string'&&ID.test(scope[k])))fail('stored_scope_invalid');
   if(owner!==JSON.stringify([scope.tenantId,scope.clientId,scope.userId]))fail('stored_scope_invalid');
   return {owner,scope:{tenantId:scope.tenantId,clientId:scope.clientId,userId:scope.userId}};
  }
  function view(handle,records) {
   const {owner}=identity(handle);const rows=new Map();let open=true;
   for(const d of records){if(!d||d.owner!==owner)fail('stored_scope_invalid');if(!integrity.verify([owner,d.kind,d.id,d.value],d.seal))fail('stored_integrity_invalid');const key=JSON.stringify([d.kind,d.id]);if(rows.has(key))fail('stored_data_invalid');rows.set(key,d);}
   if(rows.size>maxRecords)fail('store_capacity');
   const check=h=>{if(!open)fail('transaction_closed');if(sessions.key(h)!==owner)fail('stored_scope_invalid');};
   const api={
    get(h,k,id){check(h);const d=rows.get(JSON.stringify([k,id]));if(!d)fail('resource_not_found');return copy(d.value);},
    list(h,k){check(h);return [...rows.values()].filter(d=>d.kind===k).map(d=>copy(d.value));},
    put(h,k,id,value){check(h);if(!ID.test(id)||!KIND.test(k))fail('resource_id_invalid');const key=JSON.stringify([k,id]);if(rows.size>=maxRecords&&!rows.has(key))fail('store_capacity');const plain=JSON.parse(JSON.stringify(value));rows.set(key,{owner,kind:k,id,value:plain,seal:integrity.seal([owner,k,id,plain])});return copy(plain);},
    remove(h,k,id){check(h);rows.delete(JSON.stringify([k,id]));},newId:randomUUID,capacity:maxRecords
   };
   return {api,records:()=>{const result=[...rows.values()];if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024-4096)fail('store_payload_too_large');return result;},close:()=>{open=false;}};
  }
  function read(h){const {scope}=identity(h);return view(h,call({action:'read',scope}).rows).api;}
  function mutate(h,operation) {
   const {owner,scope}=identity(h);if(active.has(owner))fail('store_busy');active.add(owner);let token;let tx;
   try {const begin=call({action:'begin',scope});token=begin.token;tx=view(h,begin.rows);const value=operation(tx.api);if(value&&typeof value.then==='function')fail('transaction_async_not_supported');call({action:'commit',token,rows:tx.records()});token=null;return value;}
   catch(error){if(token && !broken && error.code!=='commit_unknown')try{call({action:'rollback',token});}catch{/* preserve original failure */}throw error;}
   finally{tx?.close();active.delete(owner);}
  }
  async function transaction(h,operation) {
   const {owner,scope}=identity(h);const end=Date.now()+timeoutMs;
   while(active.has(owner)){if(Date.now()>end)fail('store_busy');await new Promise(r=>setTimeout(r,5));}
   active.add(owner);let token;let tx;
   try{const begin=await callAsync({action:'begin',scope});token=begin.token;tx=view(h,begin.rows);const value=await operation(tx.api);await callAsync({action:'commit',token,rows:tx.records()});token=null;return value;}
   catch(error){if(token && !broken && error.code!=='commit_unknown')try{await callAsync({action:'rollback',token});}catch{/* preserve original failure */}throw error;}
   finally{tx?.close();active.delete(owner);}
  }
  async function close(){if(closed)return;try{if(!broken)await callAsync({action:'close'});}finally{closed=true;await worker.terminate();}}
  return Object.freeze({get:(h,k,id)=>read(h).get(h,k,id),list:(h,k)=>read(h).list(h,k),put:(h,k,id,v)=>mutate(h,tx=>tx.put(h,k,id,v)),remove:(h,k,id)=>mutate(h,tx=>tx.remove(h,k,id)),transaction,newId:randomUUID,capacity:maxRecords,persistence:'POSTGRESQL_MEMORY_SEALED',close});
 };
}
module.exports={createPostgresMemoryStoreFactory};
