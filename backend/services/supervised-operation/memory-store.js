'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const MemoryEngine = require('../../memory/memoryEngine');
const { copy, fail } = require('./scope-session');
// Reuses the existing MemoryEngine/repository. One server-derived owner maps to
// one hashed filename, never to a path supplied by a user or agent. Every row
// is sealed over [owner, kind, id, value]: a row edited, moved to another owner
// or swapped between records fails closed instead of becoming canonical state.
function repositoryFor(file){return {
 loadSnapshot(){if(!fs.existsSync(file))return {shortTermMemory:[],longTermMemory:[]};const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(snapshot.shortTermMemory)||!Array.isArray(snapshot.longTermMemory))fail('stored_data_invalid');return snapshot;},
 saveSnapshot(snapshot){const temp=file+'.'+randomUUID()+'.tmp';try{const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,JSON.stringify(snapshot));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
};}
const ID=/^[A-Za-z0-9:_-]{3,128}$/;const KIND=/^[-a-z]{3,30}$/;
function createMemoryStoreFactory({ root, integrity, maxRecords = 2000 }) {
 if(typeof root!=='string'||!path.isAbsolute(root))fail('memory_root_invalid');
 if(!integrity||typeof integrity.seal!=='function'||typeof integrity.verify!=='function')fail('integrity_required');
 return sessions => {
  fs.mkdirSync(root,{recursive:true});
  const fileOf = handle => path.join(root,createHash('sha256').update(sessions.key(handle)).digest('hex')+'.json');
  function load(handle) {
   const owner=sessions.key(handle); const e=new MemoryEngine({repository:repositoryFor(fileOf(handle))});
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
    remove(h,kind,id){if(sessions.key(h)!==owner)fail('stored_scope_invalid');rows.delete(JSON.stringify([kind,id]));},newId:randomUUID
   };
  }
  function acquire(handle){try{return fs.openSync(fileOf(handle)+'.lock','wx');}catch(e){if(e.code==='EEXIST')fail('store_busy');throw e;}}
  function release(handle,fd){fs.closeSync(fd);fs.unlinkSync(fileOf(handle)+'.lock');}
  function save(state){state.e.longTermMemory=[...state.rows.values()].map(data=>({timestamp:new Date(),data}));try{state.e.persistMemory();}catch(e){throw Object.assign(new Error('commit_unknown'),{code:'commit_unknown',storageCode:e.code||e.name});}}
  // All writers share one owner lock. Abandoned locks require reconciliation.
  function mutate(handle,operation){const fd=acquire(handle);let uncertain=false;try{const state=load(handle);const result=operation(view(handle,state));save(state);return result;}catch(e){uncertain=e.code==='commit_unknown';throw e;}finally{if(uncertain)fs.closeSync(fd);else release(handle,fd);}}
  async function transaction(handle,operation){let fd;
   for(let i=0;;i++){try{fd=acquire(handle);break;}catch(e){if(e.code!=='store_busy'||i>=200)throw e;await new Promise(r=>setTimeout(r,5));}}
   let uncertain=false;
   try{const state=load(handle);const result=await operation(view(handle,state));save(state);return result;}
   catch(e){uncertain=e.code==='commit_unknown';throw e;}
   finally{if(uncertain)fs.closeSync(fd);else release(handle,fd);}
  }
  return Object.freeze({
   get:(h,k,id)=>view(h,load(h)).get(h,k,id),list:(h,k)=>view(h,load(h)).list(h,k),
   put:(h,k,id,v)=>mutate(h,tx=>tx.put(h,k,id,v)),remove:(h,k,id)=>mutate(h,tx=>tx.remove(h,k,id)),
   transaction,newId:randomUUID,persistence:'LOCAL_MEMORY_REPOSITORY_SEALED'
  });
 };
}
module.exports={createMemoryStoreFactory};
