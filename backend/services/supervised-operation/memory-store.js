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
 saveSnapshot(snapshot){const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(snapshot),{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
};}
const ID=/^[A-Za-z0-9:_-]{3,128}$/;const KIND=/^[-a-z]{3,30}$/;
function createMemoryStoreFactory({ root, integrity, maxRecords = 2000 }) {
 if(typeof root!=='string'||!path.isAbsolute(root))fail('memory_root_invalid');
 if(!integrity||typeof integrity.seal!=='function'||typeof integrity.verify!=='function')fail('integrity_required');
 return sessions => {
  fs.mkdirSync(root,{recursive:true});
  const engines=new Map();const verified=new WeakSet();
  function engine(handle){const owner=sessions.key(handle);if(!engines.has(owner))engines.set(owner,new MemoryEngine({repository:repositoryFor(path.join(root,createHash('sha256').update(owner).digest('hex')+'.json'))}));return engines.get(owner);}
  function records(handle){
   const owner=sessions.key(handle);const latest=new Map();
   for(const row of engine(handle).longTermMemory){
    const d=row&&row.data;if(!d||d.owner!==owner)fail('stored_scope_invalid');
    if(!verified.has(row)){if(!integrity.verify([d.owner,d.kind,d.id,d.value],d.seal))fail('stored_integrity_invalid');verified.add(row);}
    latest.set(JSON.stringify([d.kind,d.id]),d);
   }
   return latest;
  }
  // Compaction: one row per [kind, id], so the file grows with distinct
  // records, not with every intermediate mission state.
  function without(handle,kind,id){const e=engine(handle);e.longTermMemory=e.longTermMemory.filter(row=>!(row.data&&row.data.kind===kind&&row.data.id===id));return e;}
  function put(handle,kind,id,value){
   if(!ID.test(id)||!KIND.test(kind))fail('resource_id_invalid');
   const rows=records(handle);const k=JSON.stringify([kind,id]);if(rows.size>=maxRecords&&!rows.has(k))fail('store_capacity');
   const owner=sessions.key(handle);const plain=JSON.parse(JSON.stringify(value));
   without(handle,kind,id).saveLongTerm({owner,kind,id,value:plain,seal:integrity.seal([owner,kind,id,plain])});
   const saved=engine(handle).longTermMemory.at(-1);verified.add(saved);return copy(plain);
  }
  function get(handle,kind,id){const row=records(handle).get(JSON.stringify([kind,id]));if(!row)fail('resource_not_found');return copy(row.value);}
  function list(handle,kind){return [...records(handle).values()].filter(r=>r.kind===kind).map(r=>copy(r.value));}
  function remove(handle,kind,id){records(handle);const e=without(handle,kind,id);e.persistMemory();}
  return Object.freeze({put,get,list,remove,newId:randomUUID,persistence:'LOCAL_MEMORY_REPOSITORY_SEALED'});
 };
}
module.exports={createMemoryStoreFactory};
