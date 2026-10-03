'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const MemoryEngine = require('../../memory/memoryEngine');
const { copy, fail } = require('./scope-session');
// Reuses the existing MemoryEngine/repository. One server-derived owner maps to
// one hashed filename, never to a path supplied by a user or agent.
function repositoryFor(file){return {
 loadSnapshot(){if(!fs.existsSync(file))return {shortTermMemory:[],longTermMemory:[]};const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(snapshot.shortTermMemory)||!Array.isArray(snapshot.longTermMemory))fail('stored_data_invalid');return snapshot;},
 saveSnapshot(snapshot){const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(snapshot),{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
};}
function createMemoryStoreFactory({ root, maxRecords = 2000 }) {
 if(typeof root!=='string'||!path.isAbsolute(root))fail('memory_root_invalid');
 return sessions => {
  fs.mkdirSync(root,{recursive:true});
  const engines=new Map();
  function engine(handle){const owner=sessions.key(handle);if(!engines.has(owner))engines.set(owner,new MemoryEngine({repository:repositoryFor(path.join(root,createHash('sha256').update(owner).digest('hex')+'.json'))}));return engines.get(owner);}
  function records(handle){const owner=sessions.key(handle);const rows=engine(handle).longTermMemory;const latest=new Map();for(const row of rows){if(!row.data || row.data.owner!==owner)fail('stored_scope_invalid');latest.set(JSON.stringify([row.data.kind,row.data.id]),row.data);}return latest;}
  function put(handle,kind,id,value){if(!/^[A-Za-z0-9:_-]{3,128}$/.test(id)||!/^[-a-z]{3,30}$/.test(kind))fail('resource_id_invalid');const rows=records(handle);const k=JSON.stringify([kind,id]);if(rows.size>=maxRecords&&!rows.has(k))fail('store_capacity');engine(handle).saveLongTerm({owner:sessions.key(handle),kind,id,value:copy(value)});return copy(value);}
  function get(handle,kind,id){const row=records(handle).get(JSON.stringify([kind,id]));if(!row)fail('resource_not_found');return copy(row.value);}
  function list(handle,kind){return [...records(handle).values()].filter(r=>r.kind===kind).map(r=>copy(r.value));}
  return Object.freeze({put,get,list,newId:randomUUID,persistence:'LOCAL_MEMORY_REPOSITORY'});
 };
}
module.exports={createMemoryStoreFactory};
