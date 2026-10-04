'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { createMissionEngine } = require('../executive-brain/mission-engine');
const { createAgentRegistry, AGENT_DECLARATIONS } = require('../executive-brain/agent-registry');
const { createEvidenceRegistry, digestOutput } = require('../executive-brain/evidence-registry');
const { runCompanyOpportunity } = require('../executive-brain/mission-capabilities/company-opportunity');
const { parsePublicUrl } = require('../executive-brain/mission-capabilities/public-web-fetcher');
const { containsSecretMarker, DEFAULT_PRIVACY_POLICY } = require('../executive-brain/privacy-gate');
const { createScopeSessions, createScopedStore, copy, freeze, fail } = require('./scope-session');
const { createCapabilityManager, createConnectionManager, DEFINITIONS } = require('./capability-manager');
const { OUTCOMES, normalize, tokensOf } = require('./intention-interpreter');
const { authorizeEgress } = require('./egress-privacy');
const { createCostLedger } = require('./cost-ledger');
const { classified, diagnose, createLearning } = require('./self-repair');
const REGISTRAR = 'tool:supervised-operation';
const TERMINAL = ['COMPLETED','FAILED','CANCELLED'];
const PUBLIC_PROVENANCE = ['PUBLIC_DISCOVERY','PUBLIC_WEB'];
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
// Provider output becomes source data only: owner-checked, size-bounded, with
// credential-bearing items withheld (never forwarded) and links kept only for
// public provenance, so a private link can never feed a public fetch.
function validateItems(raw,scope,provenance,origin) {
 if(!raw || raw.tenantId!==scope.tenantId || raw.userId!==scope.userId || raw.clientId!==scope.clientId || !Array.isArray(raw.items) || raw.items.length>50) fail('provider_scope_invalid');
 let withheld=0;
 const items=raw.items.flatMap((item,index)=>{
  if(!item || typeof item.text!=='string' || item.text.length>2000) fail('provider_output_invalid');
  if(containsSecretMarker(item.text)){withheld++;return [];}
  // Provider prose is source data, never authority or executable instruction.
  return [freeze({id:'item-'+index,text:item.text,provenance,origin,...(PUBLIC_PROVENANCE.includes(provenance)&&typeof item.url==='string'?{url:item.url}:{})})];
 });
 return Object.assign(items,{withheld});
}
function createSupervisedRuntime({membershipProvider,planner=null,agentOverrides={},scheduler: schedulerOptions={},taskTimeoutMs=5000,now=()=>new Date().toISOString(),storeFactory=createScopedStore,approvalFactory=null,privacyPolicy=DEFAULT_PRIVACY_POLICY,catalog={},costPolicy={},connectable,learning: learningOptions={},retention={max:400,keep:300}}={}) {
 const sessions=createScopeSessions({membershipProvider}); const store=storeFactory(sessions);
 const connections=createConnectionManager(sessions,{connectable}); const capabilities=createCapabilityManager({connections,planner});
 const ledger=createCostLedger({store,catalog,policy:costPolicy,now}); const learning=createLearning({store,now,...learningOptions});
 const scheduler=createScheduler(schedulerOptions); const missions=new Map(); const conversations=new Map();
 const metrics=new Map();
 function metric(h,event){const k=sessions.key(h);const m=metrics.get(k)||{missions:0,completed:0,failed:0,connectionRequests:0,gaps:0,recovered:0,toolCalls:0,retries:0,verificationFailures:0,cancelled:0,privacyBlocked:0,withheldItems:0,capabilityDegraded:0};m[event]=(m[event]||0)+1;metrics.set(k,m);}
 function owned(handle,id){
  let m=missions.get(id);
  if(!m){let saved;try{saved=store.get(handle,'mission',id);}catch(error){if(error.code==='stored_integrity_invalid'||error.code==='stored_scope_invalid')throw error;fail('mission_not_found');}
   m={...saved,handle,owner:sessions.key(handle),busy:false,aborters:new Set()};
   if(['RUNNING','QUEUED'].includes(m.status)){m.status='BLOCKED';m.state=null;trace(m,'RESTART_INTERRUPTED');}
   missions.set(id,m);
  }
  if(m.owner!==sessions.key(handle))fail('mission_not_found');return m;
 }
 // Only queued/running missions stay in memory; everything else reloads from
 // the owner's sealed store, so memory is bounded by the scheduler limits.
 function release(m){if(!m.busy&&missions.get(m.id)===m)missions.delete(m.id);}
 function persist(m){store.put(m.handle,'mission',m.id,{id:m.id,conversationId:m.conversationId,intention:m.intention,query:m.query,searchTerms:m.searchTerms||[],rememberContent:m.rememberContent||null,priority:m.priority,plan:m.plan,status:m.status,trace:m.trace,cancelled:m.cancelled,paused:m.paused,gaps:m.gaps||[],result:m.result||null,approvalId:m.approvalId||null,diagnosis:m.diagnosis||null,state:m.state||null,createdAt:m.createdAt});}
 function check(m){ if(m.cancelled)fail('cancelled');if(m.paused)fail('paused'); }
 function snapshot(m){const cost=ledger.mission(m.handle,m.id);return freeze(copy({id:m.id,conversationId:m.conversationId,status:m.status,outcome:m.status==='COMPLETED'?OUTCOMES.CAN_EXECUTE:m.status,result:m.result||null,approvalId:m.approvalId||null,connectionRequests:m.gaps||[],diagnosis:m.diagnosis||null,executionEnabled:false,estimatedCostUsd:cost.chargedUsd,actualCostUsd:null,cost,trace:m.trace||[]}));}
 function trace(m,event,fields={}){m.trace.push({event,at:now(),...fields});if(m.trace.length>150)m.trace.shift();}
 function spendFor(handle){return freeze({estimate:ledger.estimate,reserve:options=>ledger.reserve(handle,options),settle:(reservation,usage)=>ledger.settle(handle,reservation,usage)});}
 function engineFor(m){
  const evidence=createEvidenceRegistry({trustedRegistrars:[REGISTRAR],now});const registrar=evidence.registrar(REGISTRAR);
  const additions=Object.entries(DEFINITIONS).filter(([id])=>!AGENT_DECLARATIONS.some(a=>a.capabilities.includes(id))).map(([id,d])=>declaration('v3-'+id.replace(/\./g,'-'),d.role,id));
  const registry=createAgentRegistry({describeCapability:capabilities.profile,declarations:[...AGENT_DECLARATIONS,...additions]});
  const engine=createMissionEngine({registry,describeCapability:capabilities.profile,evidenceRegistry:evidence,limits:{taskTimeoutMs,maxTaskAttempts:3,missionRetryBudget:4},now});
  m.engine=engine;m.evidence=evidence;
  const created=engine.createMission({missionId:m.id,objective:m.intention,constraints:['No external writes.','Private data stays with its owner.'],knownContext:[],missingInformation:[],autonomyLevel:'A1',authorizedCapabilities:[...new Set(m.plan.map(s=>s.capability))],prohibitedActions:['gmail.send','deploy','production_change','spend','secret_access','iam_change'],passCriteria:[{criterionId:'result',description:'Scoped result with independently verified evidence.'}],stopCriteria:['No progress or exhausted attempts.'],requiredEvidence:['Scoped tool results.'],privacyClass:'INTERNAL'});
  const blueprint={tasks:m.plan.map(s=>({key:s.key,kind:'work',objective:DEFINITIONS[s.capability].label,agentRole:DEFINITIONS[s.capability].role,requiredCapabilities:[s.capability],dependsOn:s.dependsOn,risk:'low',privacyClass:'INTERNAL',expectedEvidence:['scoped_output'],passCriteria:['Canonical scoped result.'],missionCriteria:['result']}))};
  // Restored outputs come only from the sealed store (integrity verified on
  // read): an edited file fails closed before it can be re-registered here.
  if (!m.state) m.state=engine.planMission(created,{blueprint});
  else for(const task of m.state.tasks.filter(t=>t.status==='COMPLETED')){
   for(const ref of task.evidenceRefs)registrar.record({ref,missionId:m.id,taskId:task.taskId,supports:task.contract.passCriteria.map(v=>v.criterionId),kind:'restored_canonical_output',outputDigest:digestOutput(task.output)});
  }
  let sequence=m.state.tasks.reduce((n,t)=>n+t.evidenceRefs.length,0);
  async function readSource(step,d,contract,dependencies,scope){
   const adapter=connections.capture(m.handle,d.provider,d.scope);metric(m.handle,'toolCalls');ledger.recordTool(m.handle,m.id,step.capability);
   let query='';let urls=[];
   if(step.capability==='web.search'){
    // Only a minimized query (topic words, never source content) may leave,
    // and only after the Privacy Gate approves it for this provider.
    query=m.searchTerms.join(' ').slice(0,300);
    const gate=authorizeEgress({text:query,provider:adapter.egress,policy:privacyPolicy});const whole=authorizeEgress({text:m.intention,provider:adapter.egress,policy:privacyPolicy});
    if(!query||!gate.allowed||!whole.allowed){metric(m.handle,'privacyBlocked');trace(m,'PRIVACY_BLOCKED',{privacyClass:whole.allowed?gate.privacyClass:whole.privacyClass});fail('egress_privacy_blocked');}
   }
   // Fetch reads only links discovered by public search: never a link that
   // came from mail, memory or documents.
   if(step.capability==='research.web'){urls=dependencies.flatMap(v=>v.items||[]).filter(v=>v.provenance==='PUBLIC_DISCOVERY'&&typeof v.url==='string').map(v=>v.url).slice(0,5);if(!urls.length)fail('sources_not_found');urls.forEach(url=>parsePublicUrl(url));}
   const reduced=String(contract.attempt.scope||'').startsWith('reduced');
   // The read deadline expires well inside the engine's task timeout, so the
   // runtime (not a racing timer) diagnoses it and aborts the provider call.
   const readBudgetMs=Math.max(1,Math.floor(taskTimeoutMs*0.8));
   const controller=new AbortController();m.aborters.add(controller);let timer;let raw;const deadline=Date.now()+taskTimeoutMs;
   try{raw=await Promise.race([adapter.read({scope:copy(scope),query,urls,strategy:contract.attempt,limits:{maxItems:reduced?5:20},missionId:m.id,signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('timeout'),{code:'tool_timeout',failureKind:'timeout'}));},readBudgetMs);})]);}
   finally{clearTimeout(timer);m.aborters.delete(controller);}
   if(Date.now()>=deadline)fail('attempt_expired');
   if(m.cancelled)fail('cancelled');const items=validateItems(raw,scope,d.provenance,adapter.origin);
   if(items.withheld){metric(m.handle,'withheldItems');trace(m,'WITHHELD',{capability:step.capability,count:items.withheld});}
   if(step.capability==='web.search')items.forEach(item=>{if(!item.url)fail('source_url_missing');parsePublicUrl(item.url);});
   if(step.capability==='research.web')items.forEach(item=>{if(!urls.includes(item.url))fail('unrequested_source');});
   return [...items];
  }
  function searchMemory(){
   const terms=m.query?tokensOf(m.query):m.searchTerms;const rows=store.list(m.handle,'memory');
   const scored=rows.map(v=>({v,score:terms.filter(t=>tokensOf(v.text).includes(t)||normalize(v.text).includes(t)).length}));
   const hits=terms.length?scored.filter(s=>s.score>0).sort((a,b)=>b.score-a.score):scored;
   return hits.slice(0,20).map((s,i)=>({id:'item-'+i,text:s.v.text,provenance:'INTERNAL_MEMORY',origin:'local'}));
  }
  async function execute(contract,context){
   if(m.cancelled)fail('cancelled');await sessions.current(m.handle);const step=m.plan.find(s=>context.taskId===m.id+':'+s.key);const d=DEFINITIONS[step.capability];const scope=sessions.scope(m.handle);
   const dependencies=context.dependencies.filter(v=>v.output).map(v=>JSON.parse(v.output));let items=[];let proposal=null;
   trace(m,'CONSULT',{capability:step.capability,attempt:contract.attempt.hypothesis,strategy:contract.attempt.correctiveAction||null});
   if(d.provider){
    try{items=await readSource(step,d,contract,dependencies,scope);}
    catch(error){
     const diagnosis=diagnose(error);trace(m,'DIAGNOSE',{capability:step.capability,class:diagnosis.class,code:diagnosis.code});
     // A lost/expired/insufficient connection is human authority: the task
     // waits (no attempt burned) and resumes from this point once reconnected.
     if(diagnosis.wait&&!m.cancelled){m.waitingConnection=true;return {waitingFor:'tool'};}
     throw classified(error);
    }
   }else if(step.capability==='memory.search'){
    items=searchMemory();
   }else if(step.capability==='memory.remember'){
    items=[{id:'item-0',text:m.rememberContent||m.intention,provenance:'INTERNAL_MEMORY',origin:'local'}];
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
   if(override){const selection=await override(freeze(copy({items:trusted.items,dependencies,capability:step.capability})));if(!selection || Object.keys(selection).some(k=>k!=='itemIds') || !Array.isArray(selection.itemIds) || new Set(selection.itemIds).size!==selection.itemIds.length)throw classified({code:'selection_invalid'});items=selection.itemIds.map(id=>{const found=trusted.items.find(v=>v.id===id);if(!found)throw classified({code:'unissued_item'});return found;});}
   else items=trusted.items;
   if(m.cancelled)fail('cancelled');await sessions.current(m.handle);
   const canonical={capability:step.capability,items,proposal:trusted.proposal};const summary=JSON.stringify(canonical);
   if(summary.length>19000)throw classified({code:'result_too_large'});
   const ref='v3:'+m.id+':'+(++sequence);registrar.record({ref,missionId:m.id,taskId:contract.taskId,supports:contract.passCriteria.map(v=>v.criterionId),kind:'canonical_output',outputDigest:digestOutput(summary)});
   trace(m,'VERIFY',{capability:step.capability});return {summary,evidenceRefs:[ref]};
  }
  m.executors=Object.fromEntries(registry.listAgents().filter(a=>a.canExecute).map(a=>[a.id,execute]));
 }
 async function handoffApproval(m,result){
  const scope=sessions.scope(m.handle);const bound=await approvalFactory(copy(scope));
  if(JSON.stringify(bound.scope)!==JSON.stringify(scope)||typeof bound.queue?.add!=='function')fail('approval_scope_invalid');
  await sessions.current(m.handle);check(m);
  // Idempotent across a crash between add and persist: one proposal per mission.
  const interactionId='v3:'+m.id;const pending=typeof bound.queue.listPending==='function'?await bound.queue.listPending():[];
  const existing=pending.find(item=>item&&item.interactionId===interactionId);
  if(existing){m.approvalId=existing.id;return;}
  const item=await bound.queue.add({actionType:'prepare-storage-proposal',summary:'Propuesta de organización para revisión humana.',proposal:result.proposal,requiresApproval:true,executionEnabled:false},{interactionId,missionId:m.id,userId:scope.userId,tenantId:scope.tenantId},null);
  m.approvalId=item.id;
 }
 async function run(m){
  await sessions.current(m.handle);check(m);
  // Only steps still to run need their connection; finished work is sealed evidence.
  const remaining=m.state?m.plan.filter(s=>!m.state.tasks.some(t=>t.taskId===m.id+':'+s.key&&t.status==='COMPLETED')):m.plan;
  m.gaps=capabilities.gaps(m.handle,remaining);
  if(m.gaps.length){m.status='NEEDS_CONNECTION';metric(m.handle,'connectionRequests');trace(m,'NEEDS_CONNECTION');return snapshot(m);}
  const degraded=learning.degraded(m.handle,m.plan);
  if(degraded){m.status='BLOCKED';m.diagnosis={class:'capability_degraded',capability:degraded.capability,action:'CAPABILITY_GAP'};metric(m.handle,'capabilityDegraded');trace(m,'CAPABILITY_DEGRADED',{capability:degraded.capability});return snapshot(m);}
  if(!m.engine)engineFor(m);
  m.status='RUNNING';m.diagnosis=null;trace(m,'PLAN');
  const ran=m.state.engine.state!=='COMPLETED';
  if(ran)m.state=await m.engine.runMission(m.state,{executors:m.executors,shouldPause:()=>m.paused||m.cancelled});
  check(m);await sessions.current(m.handle);
  // Learning is recorded once per real run, never on an idempotent resume.
  if(ran)learning.record(m.handle,m.plan,m.state);
  if(m.state.engine.state==='WAITING_TOOL'&&m.waitingConnection){
   m.waitingConnection=false;m.gaps=capabilities.gaps(m.handle,m.plan.filter(s=>!m.state.tasks.some(t=>t.taskId===m.id+':'+s.key&&t.status==='COMPLETED')));m.status='NEEDS_CONNECTION';metric(m.handle,'connectionRequests');trace(m,'NEEDS_CONNECTION');return snapshot(m);
  }
  m.status=m.state.engine.state;
  const retries=m.state.missionRetriesUsed;if(retries){metric(m.handle,'recovered');metric(m.handle,'retries');trace(m,'CHANGE_STRATEGY',{retries});}
  if(m.state.verification?.verdict==='PASS'&&m.status==='COMPLETED'){
   const outputs=m.state.tasks.filter(t=>t.status==='COMPLETED').map(t=>JSON.parse(t.output));
   // A failed verifier never commits personal memory or a reusable workflow.
   for(const output of outputs)if(output.capability==='memory.remember')store.put(m.handle,'memory',m.id,{text:output.items[0].text,provenance:'INTERNAL_MEMORY'});
   const result=outputs.at(-1);m.result=result;
   if(result.proposal){m.status='NEEDS_APPROVAL';if(approvalFactory&&!m.approvalId)await handoffApproval(m,result);}
   // Learned procedures are reads only; a memory write is always re-derived
   // from the human's explicit words, never replayed.
   if(!m.plan.some(step=>step.capability==='memory.remember'))store.put(m.handle,'workflow',workflowId(m.intention),{intention:m.intention,plan:m.plan,searchTerms:m.searchTerms||[],executionEnabled:false});
   if(ran){metric(m.handle,'completed');trace(m,'TERMINATE');}
  }else {
   const blocked=m.state.tasks.find(t=>['BLOCKED','FAILED','NEEDS_REVIEW'].includes(t.status));
   if(blocked){const last=(m.state.attempts?.[blocked.taskId]||[]).at(-1);m.diagnosis={class:last?.failureKind||'unknown',code:last?.failureCode||null,capability:blocked.requiredCapabilities[0],action:'HUMAN_REVIEW'};}
   metric(m.handle,'failed');if(m.state.tasks.some(t=>t.verification&&t.verification.verdict!=='PASS'))metric(m.handle,'verificationFailures');
  }
  return snapshot(m);
 }
 async function schedule(m){
  if(m.busy)fail('mission_busy');m.busy=true;
  try{return await scheduler.submit(m.owner,m.id,()=>run(m),m.priority);}
  catch(error){if(['cancelled','paused'].includes(error.code)){m.status=m.paused?'PAUSED':'CANCELLED';}else{m.status='BLOCKED';trace(m,'BLOCKED',{code:/^[a-z_]+$/.test(error.code||'')?error.code:'runtime_failure'});if(error.code==='backpressure')throw error;}return snapshot(m);}
  finally{m.busy=false;try{await sessions.current(m.handle);persist(m);}catch{m.result=null;}release(m);}
 }
 const workflowId=text=>'wf-'+createHash('sha256').update(text).digest('hex').slice(0,40);
 // Retention: an owner keeps its most recent finished missions; older finished
 // ones (and their per-mission cost detail) are pruned so a long-running pilot
 // never reaches the store capacity. Open missions are never pruned; daily cost
 // totals, memory, workflows and lessons are kept.
 function prune(handle){
  const all=store.list(handle,'mission');if(all.length<=retention.max)return;
  const finished=all.filter(v=>TERMINAL.includes(v.status)&&!missions.has(v.id)).sort((x,y)=>String(x.createdAt||'').localeCompare(String(y.createdAt||'')));
  for(const v of finished.slice(0,Math.max(0,all.length-retention.keep))){store.remove(handle,'mission',v.id);store.remove(handle,'cost-mission',v.id);}
 }
 async function start(handle,{text,conversationId,query='',priority=0}={}){
  await sessions.current(handle);
  if(!/^[A-Za-z0-9_-]{8,64}$/.test(conversationId||'')||!Number.isInteger(priority)||priority<0||priority>3)fail('conversation_invalid');
  if(typeof text!=='string')fail('intention_invalid');
  if(containsSecretMarker(text))fail('secret_context');
  const id='mission-'+randomUUID();
  let reusable=null;try{reusable=store.get(handle,'workflow',workflowId(text));}catch(error){if(error.code!=='resource_not_found')throw error;}
  const interpretation=reusable&&reusable.intention===text
   ?{outcome:OUTCOMES.CAN_EXECUTE,plan:capabilities.validatePlan(reusable.plan),searchTerms:reusable.searchTerms||[]}
   :await capabilities.interpret(text,{scope:freeze(copy(sessions.scope(handle))),spend:spendFor(handle),missionId:id});
  if(interpretation.introspection){
   const state=onboarding(handle);
   return freeze({outcome:OUTCOMES.CAN_EXECUTE,status:'COMPLETED',reason:'operational_state',message:state.message,capabilities:state.capabilities,persistence:store.persistence,executionEnabled:false});
  }
  if(interpretation.outcome!==OUTCOMES.CAN_EXECUTE){
   metric(handle,'gaps');
   return freeze({outcome:interpretation.outcome,gate:interpretation.gate||(interpretation.outcome===OUTCOMES.NEEDS_CAPABILITY?'CAPABILITY_GAP':interpretation.outcome),message:interpretation.message,missingInformation:interpretation.missingInformation||[],capabilities:interpretation.capabilities||[],executionEnabled:false});
  }
  const plan=interpretation.plan;
  if(plan.some(step=>step.capability==='memory.remember')&&!interpretation.rememberContent)fail('memory_consent_required');
  if(plan.some(step=>step.capability==='memory.remember')&&!sessions.scope(handle).roles.some(role=>['owner','admin','operator'].includes(role)))fail('permission_denied');
  const m={id,handle,owner:sessions.key(handle),conversationId,intention:text,query,searchTerms:interpretation.searchTerms||[],rememberContent:interpretation.rememberContent||null,priority,plan,status:'QUEUED',trace:[],cancelled:false,paused:false,aborters:new Set(),createdAt:now()};
  prune(handle);
  missions.set(id,m);persist(m);metric(handle,'missions');
  const ck=JSON.stringify([m.owner,conversationId]);const prior=conversations.get(ck)||[];conversations.set(ck,[...prior,id].slice(-20));
  return schedule(m);
 }
 async function resume(handle,id){await sessions.current(handle);const m=owned(handle,id);if(TERMINAL.includes(m.status)||m.cancelled)fail('terminal_mission');m.paused=false;return schedule(m);}
 async function pause(handle,id){await sessions.current(handle);const m=owned(handle,id);m.paused=true;m.status='PAUSED';scheduler.remove(id);persist(m);const s=snapshot(m);release(m);return s;}
 async function cancel(handle,id){await sessions.current(handle);const m=owned(handle,id);m.cancelled=true;m.aborters.forEach(controller=>controller.abort());m.status='CANCELLED';scheduler.remove(id);metric(handle,'cancelled');persist(m);const s=snapshot(m);release(m);return s;}
 async function get(handle,id){await sessions.current(handle);const m=owned(handle,id);const s=snapshot(m);release(m);return s;}
 async function conversation(handle,id){await sessions.current(handle);if(!/^[A-Za-z0-9_-]{8,64}$/.test(id))fail('conversation_invalid');const ids=new Set([...(conversations.get(JSON.stringify([sessions.key(handle),id]))||[]),...store.list(handle,'mission').filter(m=>m.conversationId===id).map(m=>m.id)]);return [...ids].slice(-20).map(mid=>{const m=owned(handle,mid);const s=snapshot(m);release(m);return s;});}
 async function telemetry(handle){await sessions.current(handle);return freeze(copy(metrics.get(sessions.key(handle))||{}));}
 async function costs(handle){await sessions.current(handle);return ledger.owner(handle);}
 async function lessons(handle){await sessions.current(handle);return learning.lessons(handle);}
 function aggregate(){return freeze([...metrics.values()].reduce((a,m)=>{for(const[k,v]of Object.entries(m))a[k]=(a[k]||0)+v;return a;},{}));}
 // Existing V2.1 remains the sole commercial canon. Per-session adapter closures
 // are supplied by the trusted integration factory; no prompt chooses an owner.
 async function business(handle,input,factory){await sessions.current(handle);if(typeof factory!=='function')fail('business_adapter_required');const adapters=await factory(freeze(copy(sessions.scope(handle))));const result=await runCompanyOpportunity({...copy(input),...adapters});await sessions.current(handle);return freeze(copy({review:result.review,executionEnabled:false}));}
 function onboarding(handle){sessions.scope(handle);const state=capabilities.describe(handle);return freeze({...state,executionEnabled:false});}
 return Object.freeze({openSession:sessions.open,start,resume,pause,cancel,get,conversation,telemetry,costs,lessons,onboarding,business,
  scope:handle=>freeze(copy(sessions.scope(handle))),
  // Trusted administration surface: keep out of public request payloads.
  connections,aggregateTelemetry:aggregate,schedulerStats:scheduler.stats,persistence:store.persistence,executionEnabled:false});
}
module.exports={createSupervisedRuntime,createScheduler,validateItems};
