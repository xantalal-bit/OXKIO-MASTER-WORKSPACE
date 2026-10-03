'use strict';
const { randomUUID } = require('node:crypto');
const { createMissionEngine } = require('../executive-brain/mission-engine');
const { createAgentRegistry, AGENT_DECLARATIONS } = require('../executive-brain/agent-registry');
const { createEvidenceRegistry, digestOutput } = require('../executive-brain/evidence-registry');
const { runCompanyOpportunity } = require('../executive-brain/mission-capabilities/company-opportunity');
const { parsePublicUrl } = require('../executive-brain/mission-capabilities/public-web-fetcher');
const { containsSecretMarker } = require('../executive-brain/privacy-gate');
const { createScopeSessions, createScopedStore, copy, freeze, fail } = require('./scope-session');
const { createCapabilityManager, createConnectionManager, DEFINITIONS } = require('./capability-manager');
const REGISTRAR = 'tool:supervised-operation';
const TERMINAL = ['COMPLETED','FAILED','CANCELLED'];
// A bounded per-owner fair admission queue. A cancelled/paused queued mission never
// consumes a worker; running reads are invalidated before their result can commit.
function createScheduler({ concurrency = 4, maxQueued = 40, maxPerOwner = 10 } = {}) {
 if (![concurrency,maxQueued,maxPerOwner].every(v=>Number.isInteger(v)&&v>0)) fail('scheduler_limits_invalid');
 const queue=[]; const ownerActive=new Set(); let active=0;
 function drain() {
  while(active<concurrency){ const i=queue.findIndex(v=>!ownerActive.has(v.owner)); if(i<0)return;
   const job=queue.splice(i,1)[0]; active++; ownerActive.add(job.owner);
   Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{active--;ownerActive.delete(job.owner);drain();});
  }
 }
 function submit(owner,id,run,priority=0) {
  if(queue.length>=maxQueued || queue.filter(j=>j.owner===owner).length>=maxPerOwner) fail('backpressure');
  return new Promise((resolve,reject)=>{queue.push({owner,id,run,resolve,reject,priority});queue.sort((a,b)=>b.priority-a.priority);drain();});
 }
 function remove(id) { const i=queue.findIndex(j=>j.id===id); if(i>=0){queue.splice(i,1)[0].reject(Object.assign(new Error('cancelled'),{code:'cancelled'}));return true;} return false; }
 return Object.freeze({submit,remove,stats:()=>({active,queued:queue.length})});
}
function declaration(id,role,capability) {
 return {id,role,coordinator:'EXECUTIVE_COORDINATOR',capabilities:[capability],allowedAutonomy:'A1',riskClasses:['low'],canPlan:false,canExecute:true,canVerify:false,canCreateSubagents:false,maxSubagents:0,prohibitedCapabilities:[]};
}
function validateItems(raw,scope,provenance,origin) {
 if(!raw || raw.tenantId!==scope.tenantId || raw.userId!==scope.userId || raw.clientId!==scope.clientId || !Array.isArray(raw.items) || raw.items.length>50) fail('provider_scope_invalid');
 return raw.items.map((item,index)=>{
  if(!item || typeof item.text!=='string' || item.text.length>2000 || containsSecretMarker(item.text)) fail('provider_output_invalid');
  // Provider prose is source data, never authority or executable instruction.
  return freeze({id:'item-'+index,text:item.text,provenance,origin,...(typeof item.url==='string'?{url:item.url}:{})});
 });
}
function createSupervisedRuntime({membershipProvider,planner=null,agentOverrides={},scheduler: schedulerOptions={},taskTimeoutMs=5000,costController=null,now=()=>new Date().toISOString(),storeFactory=createScopedStore,approvalFactory=null}={}) {
 const sessions=createScopeSessions({membershipProvider}); const store=storeFactory(sessions);
 const connections=createConnectionManager(sessions); const capabilities=createCapabilityManager({connections,planner});
 const scheduler=createScheduler(schedulerOptions); const missions=new Map(); const conversations=new Map();
 const metrics=new Map();
 function metric(h,event){const k=sessions.key(h);const m=metrics.get(k)||{missions:0,completed:0,failed:0,connectionRequests:0,gaps:0,recovered:0,toolCalls:0,retries:0,verificationFailures:0,cancelled:0};m[event]=(m[event]||0)+1;metrics.set(k,m);}
 function owned(handle,id){
  let m=missions.get(id);
  if(!m){let saved;try{saved=store.get(handle,'mission',id);}catch{fail('mission_not_found');}
   m={...saved,handle,owner:sessions.key(handle),busy:false,aborters:new Set()};
   if(['RUNNING','QUEUED'].includes(m.status)){m.status='BLOCKED';m.state=null;trace(m,'RESTART_INTERRUPTED');}
   missions.set(id,m);
  }
  if(m.owner!==sessions.key(handle))fail('mission_not_found');return m;
 }
 function persist(m){store.put(m.handle,'mission',m.id,{id:m.id,conversationId:m.conversationId,intention:m.intention,query:m.query,priority:m.priority,plan:m.plan,status:m.status,trace:m.trace,cancelled:m.cancelled,paused:m.paused,gaps:m.gaps||[],result:m.result||null,approvalId:m.approvalId||null,state:m.state||null});}
 function check(m){ if(m.cancelled)fail('cancelled');if(m.paused)fail('paused'); }
 function snapshot(m){return freeze(copy({id:m.id,conversationId:m.conversationId,status:m.status,result:m.result||null,approvalId:m.approvalId||null,connectionRequests:m.gaps||[],executionEnabled:false,estimatedCostUsd:m.state?.estimatedSpentUsd??0,actualCostUsd:m.state?.actualSpentUsd??null,trace:m.trace||[]}));}
 function trace(m,event,fields={}){m.trace.push({event,at:now(),...fields});if(m.trace.length>150)m.trace.shift();}
 function engineFor(m){
  const evidence=createEvidenceRegistry({trustedRegistrars:[REGISTRAR],now});const registrar=evidence.registrar(REGISTRAR);
  const additions=Object.entries(DEFINITIONS).filter(([id])=>!AGENT_DECLARATIONS.some(a=>a.capabilities.includes(id))).map(([id,d])=>declaration('v3-'+id.replace(/\./g,'-'),d.role,id));
  const registry=createAgentRegistry({describeCapability:capabilities.profile,declarations:[...AGENT_DECLARATIONS,...additions]});
  const engine=createMissionEngine({registry,describeCapability:capabilities.profile,evidenceRegistry:evidence,limits:{taskTimeoutMs,maxTaskAttempts:3,missionRetryBudget:4},now});
  m.engine=engine;m.evidence=evidence;
  const created=engine.createMission({missionId:m.id,objective:m.intention,constraints:['No external writes.','Private data stays with its owner.'],knownContext:[],missingInformation:[],autonomyLevel:'A1',authorizedCapabilities:[...new Set(m.plan.map(s=>s.capability))],prohibitedActions:['gmail.send','deploy','production_change','spend','secret_access','iam_change'],passCriteria:[{criterionId:'result',description:'Scoped result with independently verified evidence.'}],stopCriteria:['No progress or exhausted attempts.'],requiredEvidence:['Scoped tool results.'],privacyClass:'INTERNAL'});
  const blueprint={tasks:m.plan.map(s=>({key:s.key,kind:'work',objective:DEFINITIONS[s.capability].label,agentRole:DEFINITIONS[s.capability].role,requiredCapabilities:[s.capability],dependsOn:s.dependsOn,risk:'low',privacyClass:'INTERNAL',expectedEvidence:['scoped_output'],passCriteria:['Canonical scoped result.'],missionCriteria:['result']}))};
  if (!m.state) m.state=engine.planMission(created,{blueprint});
  else for(const task of m.state.tasks.filter(t=>t.status==='COMPLETED')){
   for(const ref of task.evidenceRefs)registrar.record({ref,missionId:m.id,taskId:task.taskId,supports:task.contract.passCriteria.map(v=>v.criterionId),kind:'restored_canonical_output',outputDigest:digestOutput(task.output)});
  }
  let sequence=m.state.tasks.reduce((n,t)=>n+t.evidenceRefs.length,0);
  async function execute(contract,context){
   if(m.cancelled)fail('cancelled');await sessions.current(m.handle);const step=m.plan.find(s=>context.taskId===m.id+':'+s.key);const d=DEFINITIONS[step.capability];const scope=sessions.scope(m.handle);const deadline=Date.now()+taskTimeoutMs;
   const dependencies=context.dependencies.filter(v=>v.output).map(v=>JSON.parse(v.output));let items=[];let proposal=null;
   trace(m,'CONSULT',{capability:step.capability,attempt:contract.attempt.hypothesis});
   if(d.provider){
    const adapter=connections.capture(m.handle,d.provider,d.scope);metric(m.handle,'toolCalls');
    let query=m.intention;let urls=[];
    // Discovery may suggest URLs; FETCH enforces the existing URL policy and a
    // trusted fetcher still enforces DNS, redirects and robots at every hop.
    if(step.capability==='research.web'){urls=dependencies.flatMap(v=>v.items||[]).map(v=>v.url).filter(Boolean).slice(0,5);if(!urls.length)fail('sources_not_found');urls.forEach(url=>parsePublicUrl(url));}
    const controller=new AbortController();m.aborters.add(controller);let timer;
    let raw;
    try{raw=await Promise.race([adapter.read({scope:copy(scope),query,urls,strategy:contract.attempt,missionId:m.id,signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('timeout'),{code:'tool_timeout',failureKind:'tool_error'}));},Math.max(1,taskTimeoutMs-1));})]);}
    finally{clearTimeout(timer);m.aborters.delete(controller);}
    if(Date.now()>=deadline)fail('attempt_expired');
    if(m.cancelled)fail('cancelled');items=validateItems(raw,scope,d.provenance,adapter.origin);
    if(step.capability==='web.search')items.forEach(item=>{if(!item.url)fail('source_url_missing');parsePublicUrl(item.url);});
    if(step.capability==='research.web')items.forEach(item=>{if(!urls.includes(item.url))fail('unrequested_source');});
   }else if(step.capability==='memory.search'){
    items=store.list(m.handle,'memory').filter(v=>v.text.toLowerCase().includes(m.query.toLowerCase())).map((v,i)=>({id:'item-'+i,text:v.text,provenance:'INTERNAL_MEMORY',origin:'local'}));
   }else if(step.capability==='memory.remember'){
    items=[{id:'item-0',text:m.intention.replace(/^recuerda\s*/i,''),provenance:'INTERNAL_MEMORY',origin:'local'}];
   }else{
    items=dependencies.flatMap(v=>v.items||[]);
   }
   if(!['data.analyze','storage.propose'].includes(step.capability))items=items.map((item,index)=>({...item,id:context.taskId+':item-'+index}));
   if(step.capability==='storage.propose'){
    items=dependencies.flatMap(v=>v.items||[]);
    proposal={kind:'FILE_ORGANIZATION',items:items.filter(v=>/factura|invoice/i.test(v.text)).map(v=>({sourceId:v.id,folder:'Facturas pendientes de revisar',provenance:v.provenance})),executionEnabled:false};
   }
   // Agents select existing item ids; no prose, provenance or source can be
   // authored by them. Validation operates on this trusted snapshot.
   const trusted=freeze(copy({items,proposal}));const override=agentOverrides[step.capability];
   if(override){const selection=await override(freeze(copy({items:trusted.items,dependencies,capability:step.capability})));if(!selection || Object.keys(selection).some(k=>k!=='itemIds') || !Array.isArray(selection.itemIds) || new Set(selection.itemIds).size!==selection.itemIds.length)fail('selection_invalid');items=selection.itemIds.map(id=>{const found=trusted.items.find(v=>v.id===id);if(!found)fail('unissued_item');return found;});}
   else items=trusted.items;
   if(m.cancelled)fail('cancelled');await sessions.current(m.handle);
   const canonical={capability:step.capability,items,proposal:trusted.proposal};const summary=JSON.stringify(canonical);
   if(summary.length>19000)fail('result_too_large');
   const ref='v3:'+m.id+':'+(++sequence);registrar.record({ref,missionId:m.id,taskId:contract.taskId,supports:contract.passCriteria.map(v=>v.criterionId),kind:'canonical_output',outputDigest:digestOutput(summary)});
   trace(m,'VERIFY',{capability:step.capability});return {summary,evidenceRefs:[ref]};
  }
  m.executors=Object.fromEntries(registry.listAgents().filter(a=>a.canExecute).map(a=>[a.id,execute]));
 }
 async function run(m){
  await sessions.current(m.handle);check(m);m.gaps=capabilities.gaps(m.handle,m.plan);
  if(m.gaps.length){m.status='NEEDS_CONNECTION';metric(m.handle,'connectionRequests');trace(m,'NEEDS_CONNECTION');return snapshot(m);}
  if(!m.engine)engineFor(m);
  m.status='RUNNING';trace(m,'PLAN');
  if(costController){const decision=costController.decide({mission:{deterministicAvailable:true,requiresIndependentVerification:true}});if(!decision.decision || !decision.decision.level) {m.status='NEEDS_APPROVAL';return snapshot(m);}}
  if(m.state.engine.state!=='COMPLETED')m.state=await m.engine.runMission(m.state,{executors:m.executors,shouldPause:()=>m.paused||m.cancelled});
  check(m);await sessions.current(m.handle);
  m.status=m.state.engine.state;
  const retries=m.state.missionRetriesUsed;metric(m.handle,retries?'recovered':'verified');if(retries){metric(m.handle,'retries');trace(m,'CHANGE_STRATEGY',{retries});}
  if(m.state.verification?.verdict==='PASS'&&m.status==='COMPLETED'){
   const outputs=m.state.tasks.filter(t=>t.status==='COMPLETED').map(t=>JSON.parse(t.output));
   // A failed verifier never commits personal memory or a reusable workflow.
   for(const output of outputs)if(output.capability==='memory.remember')store.put(m.handle,'memory',m.id,{text:output.items[0].text,provenance:'INTERNAL_MEMORY'});
   const result=outputs.at(-1);m.result=result;
   if(result.proposal){
    m.status='NEEDS_APPROVAL';
    if(approvalFactory&&!m.approvalId){const scope=sessions.scope(m.handle);const bound=await approvalFactory(copy(scope));
     if(JSON.stringify(bound.scope)!==JSON.stringify(scope)||typeof bound.queue?.add!=='function')fail('approval_scope_invalid');
     await sessions.current(m.handle);check(m);
     const item=await bound.queue.add({actionType:'prepare-storage-proposal',summary:'Propuesta de organización para revisión humana.',proposal:result.proposal,requiresApproval:true,executionEnabled:false},{missionId:m.id,userId:scope.userId,tenantId:scope.tenantId},null);
     m.approvalId=item.id;
    }
   }
   store.put(m.handle,'workflow',m.id,{intention:m.intention,plan:m.plan,executionEnabled:false});
   metric(m.handle,'completed');trace(m,'TERMINATE');
  }else {metric(m.handle,'failed');if(m.state.tasks.some(t=>t.verification&&t.verification.verdict!=='PASS'))metric(m.handle,'verificationFailures');}
  return snapshot(m);
 }
 async function schedule(m){
  if(m.busy)fail('mission_busy');m.busy=true;
  try{return await scheduler.submit(m.owner,m.id,()=>run(m),m.priority);}catch(error){if(['cancelled','paused'].includes(error.code)){m.status=m.paused?'PAUSED':'CANCELLED';}else{m.status='BLOCKED';trace(m,'BLOCKED',{code:/^[a-z_]+$/.test(error.code||'')?error.code:'runtime_failure'});}return snapshot(m);}finally{m.busy=false;try{await sessions.current(m.handle);persist(m);}catch{m.result=null;}}
 }
 async function start(handle,{text,conversationId,query='',priority=0}={}){
  await sessions.current(handle);
  if(!/^[A-Za-z0-9_-]{8,64}$/.test(conversationId||'')||!Number.isInteger(priority)||priority<0||priority>3)fail('conversation_invalid');
  if(containsSecretMarker(text||''))fail('secret_context');
  const reusable=store.list(handle,'workflow').find(workflow=>workflow.intention===text);
  const composed=reusable?{plan:capabilities.validatePlan(reusable.plan)}:await capabilities.compose(text,{scope:freeze(copy(sessions.scope(handle)))});
  if(composed.plan?.some(step=>step.capability==='memory.remember')&&!/^(recuerda|guarda esta información)\b/i.test(text))fail('memory_consent_required');
  if(composed.plan?.some(step=>step.capability==='memory.remember')&&!sessions.scope(handle).roles.some(role=>['owner','admin','operator'].includes(role)))fail('permission_denied');
  if(composed.gate){metric(handle,'gaps');return freeze({...composed,executionEnabled:false});}
  if(missions.size>=2000)fail('mission_capacity');
  const id='mission-'+randomUUID();const m={id,handle,owner:sessions.key(handle),conversationId,intention:text,query,priority,plan:composed.plan,status:'QUEUED',trace:[],cancelled:false,paused:false,aborters:new Set()};
  missions.set(id,m);persist(m);metric(handle,'missions');
  const ck=JSON.stringify([m.owner,conversationId]);const prior=conversations.get(ck)||[];conversations.set(ck,[...prior,id].slice(-20));
  return schedule(m);
 }
 async function resume(handle,id){await sessions.current(handle);const m=owned(handle,id);if(TERMINAL.includes(m.status)||m.cancelled)fail('terminal_mission');m.paused=false;return schedule(m);}
 async function pause(handle,id){await sessions.current(handle);const m=owned(handle,id);m.paused=true;m.status='PAUSED';scheduler.remove(id);persist(m);return snapshot(m);}
 async function cancel(handle,id){await sessions.current(handle);const m=owned(handle,id);m.cancelled=true;m.aborters.forEach(controller=>controller.abort());m.status='CANCELLED';scheduler.remove(id);metric(handle,'cancelled');persist(m);return snapshot(m);}
 async function get(handle,id){await sessions.current(handle);return snapshot(owned(handle,id));}
 async function conversation(handle,id){await sessions.current(handle);if(!/^[A-Za-z0-9_-]{8,64}$/.test(id))fail('conversation_invalid');const ids=new Set([...(conversations.get(JSON.stringify([sessions.key(handle),id]))||[]),...store.list(handle,'mission').filter(m=>m.conversationId===id).map(m=>m.id)]);return [...ids].slice(-20).map(mid=>snapshot(owned(handle,mid)));}
 async function telemetry(handle){await sessions.current(handle);return freeze(copy(metrics.get(sessions.key(handle))||{}));}
 function aggregate(){return freeze([...metrics.values()].reduce((a,m)=>{for(const[k,v]of Object.entries(m))a[k]=(a[k]||0)+v;return a;},{}));}
 // Existing V2.1 remains the sole commercial canon. Per-session adapter closures
 // are supplied by the trusted integration factory; no prompt chooses an owner.
 async function business(handle,input,factory){await sessions.current(handle);if(typeof factory!=='function')fail('business_adapter_required');const adapters=await factory(freeze(copy(sessions.scope(handle))));const result=await runCompanyOpportunity({...copy(input),...adapters});await sessions.current(handle);return freeze(copy({review:result.review,executionEnabled:false}));}
 function onboarding(handle){sessions.scope(handle);return freeze({message:'Soy OXKIO. Puedo consultar tus fuentes, recordar información y preparar propuestas. Tus datos permanecen separados. Conecta solo los servicios que quieras usar; puedes desconectarlos cuando quieras. Los cambios y envíos externos requieren revisión.',executionEnabled:false,connections:['calendar','mail','storage','search','fetch'].map(provider=>({provider,status:connections.inspect(handle,provider,'').status}))});}
 return Object.freeze({openSession:sessions.open,start,resume,pause,cancel,get,conversation,telemetry,onboarding,business,
  // Trusted administration surface: keep out of public request payloads.
  connections,aggregateTelemetry:aggregate,schedulerStats:scheduler.stats,persistence:store.persistence,executionEnabled:false});
}
module.exports={createSupervisedRuntime,createScheduler,validateItems};
