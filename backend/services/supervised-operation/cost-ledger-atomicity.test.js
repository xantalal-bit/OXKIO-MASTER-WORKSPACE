'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {randomBytes}=require('node:crypto');const {spawn}=require('node:child_process');
const {createCostLedger}=require('./cost-ledger');
const {createMemoryStoreFactory}=require('./memory-store');
const {createHmacIntegrity}=require('./integrity');
const {createGovernedReasoner}=require('./governed-reasoning');
const {runPostgresScopedTransaction}=require('../../repositories/postgres/postgres-scoped-transaction');
function fixture(t,extra={},storeOptions={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-atomic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const key=randomBytes(32);let date='2026-10-31T23:59:59.000Z';
 const openStore=(more={})=>createMemoryStoreFactory({root,integrity:createHmacIntegrity({key}),...storeOptions,...more})({key:h=>h});
 const options={policy:{missionBudgetUsd:1,dailyBudgetUsd:2},budget:{human:{amount:2,currency:'USD'},providers:{openai:{amount:2,currency:'USD'}}},...extra};
 const open=(store=openStore())=>createCostLedger({store,...options,now:()=>date});
 return {root,key,open,openStore,ledger:open(),date:v=>{date=v;},reserve:(l,key='key-1',amount=0.1,more={})=>l.reserve('owner',{idempotencyKey:key,missionId:'mission-1',modelId:'openai:fixture',estimatedUsd:amount,approvedDailyBudgetUsd:2,...more})};
}
const claimSettle=async(l,r,usage)=>{await l.claimCall('owner',r);return l.settle('owner',r,usage);};
const dataFile=root=>path.join(root,fs.readdirSync(root).find(n=>n.endsWith('.json')));
const lockFile=root=>dataFile(root)+'.lock';
const OWNER={decidedBy:'owner',evidenceRef:'provider-dashboard-check'};
const CATALOG={};for(const id of ['a','b'])CATALOG['openai:'+id]={provider:'openai',tier:'small_model',inputUsdPerMillion:1,outputUsdPerMillion:1,residency:'eu',privacy:'provider_api',pricingVersion:'f',pricingSource:'f',reviewedAt:'2026-10-16'};
const spendOf=l=>({estimate:l.estimate,budget:()=>l.budget('owner'),reserve:o=>l.reserve('owner',o),claimCall:x=>l.claimCall('owner',x),markCallUnknown:x=>l.markCallUnknown('owner',x),settle:(x,u)=>l.settle('owner',x,u),recordExecution:e=>l.recordExecution('owner',e)});
// A child process with the same store (same root and integrity key).
function child(f,body,storeOptions={}){
 const src=`const path=require('node:path');const so=${JSON.stringify(__dirname)};const {createMemoryStoreFactory}=require(path.join(so,'memory-store'));const {createHmacIntegrity}=require(path.join(so,'integrity'));const {createCostLedger}=require(path.join(so,'cost-ledger'));
 const s=createMemoryStoreFactory({root:${JSON.stringify(f.root)},integrity:createHmacIntegrity({key:Buffer.from('${f.key.toString('hex')}','hex')}),...${JSON.stringify(storeOptions)}})({key:h=>h});
 const l=createCostLedger({store:s,policy:{missionBudgetUsd:1000,dailyBudgetUsd:1000},now:()=>'2026-10-31T12:00:00.000Z'});
 (async()=>{${body}})().catch(e=>{console.log(JSON.stringify({fatal:e.code||e.message}));});`;
 const c=spawn(process.execPath,['-e',src],{stdio:['ignore','pipe','pipe']});let out='';c.stdout.on('data',d=>{out+=d;});c.stderr.on('data',d=>{out+=d;});
 return {c,lines:()=>out,done:new Promise(r=>c.on('exit',()=>r(out.trim())))};
}
const waitFor=async(cond,ms=10000)=>{const end=Date.now()+ms;while(!cond()){if(Date.now()>end)throw new Error('timeout');await new Promise(r=>setTimeout(r,10));}};

test('F1 mission includes open reservations and stable reservation identity',async t=>{
 const f=fixture(t,{policy:{missionBudgetUsd:0.15,dailyBudgetUsd:2}});const r=await f.reserve(f.ledger);
 assert.deepEqual(await f.reserve(f.open()),r);
 await assert.rejects(f.reserve(f.ledger,'key-2'),e=>e.code==='planning_budget_gate');
 assert.equal(f.ledger.owner('owner')[0].reservedUsd,0.1);
});
test('F2 failed partial settlement rolls back both rows; restart recovers token',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);await f.ledger.claimCall('owner',r);const original=f.openStore();let writes=0;
 const faulty={...original,transaction:(h,op)=>original.transaction(h,tx=>op({...tx,put(...args){if(++writes===2)throw Object.assign(new Error('injected'),{code:'injected'});return tx.put(...args);}}))};
 await assert.rejects(f.open(faulty).settle('owner',r),{code:'injected'});
 assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);assert.equal(f.open().mission('owner','mission-1').chargedUsd,0);
 assert.equal(await f.open().settle('owner',r),0.1);assert.equal(await f.open().settle('owner',r),0.1);
 assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.1);
});
test('F3 two store instances interleave under owner lock without lost reservations',async t=>{
 const f=fixture(t);let enter;let resume;const entered=new Promise(r=>enter=r);const gate=new Promise(r=>resume=r);const a=f.openStore();
 const held=a.transaction('owner',async()=>{enter();await gate;});await entered;
 const calls=[f.reserve(f.ledger,'key-a'),f.reserve(f.open(),'key-b')];resume();await held;await Promise.all(calls);
 const day=f.open().owner('owner')[0];assert.equal(day.openReservations,2);assert.equal(day.reservedUsd,0.2);
});
test('F4 concurrent double settlement is idempotent and leaves consistent day/mission',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);await f.ledger.claimCall('owner',r);assert.deepEqual(await Promise.all([f.ledger.settle('owner',r),f.open().settle('owner',r)]),[0.1,0.1]);
 const day=f.open().owner('owner')[0];assert.equal(day.calls,1);assert.equal(day.chargedUsd,0.1);assert.equal(day.reservedUsd,0);assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.1);
});
test('F5 durable claim survives restart; an unknown call blocks its own scope, never the owner',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);await f.ledger.claimCall('owner',r);
 await assert.rejects(f.open().claimCall('owner',r),{code:'call_reconciliation_required'});
 await f.open().markCallUnknown('owner',r);
 await assert.rejects(f.reserve(f.open()),e=>e.code==='call_reconciliation_required'&&e.detail==='call_uncertain');
 await assert.rejects(f.reserve(f.open(),'other-model',0.1,{scopeKey:'key-1'}),e=>e.code==='call_reconciliation_required'&&e.detail==='scope_uncertain');
 await assert.rejects(f.open().claimCall('owner',r),{code:'call_reconciliation_required'});
 await assert.rejects(f.open().settle('owner',r),{code:'call_reconciliation_required'});
 // An unrelated scope is not blocked.
 const other=await f.reserve(f.open(),'unrelated-key',0.1,{missionId:'mission-2'});assert.equal(await claimSettle(f.open(),other),0.1);
 assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
 // Reconciliation has explicit evidence of the charge; it never calls a provider.
 assert.deepEqual(await f.open().reconcileCall('owner',{token:r.token,decision:'charged',...OWNER}),{status:'settled',chargedUsd:0.1});
 assert.deepEqual(await f.open().reconcileCall('owner',{token:r.token,decision:'charged',...OWNER}),{status:'settled',chargedUsd:0.1});
 assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.1);assert.equal(f.open().owner('owner')[0].reservedUsd,0);
});
for(const mode of ['commit','rollback','begin'])test('F6 '+mode+' failure discards PG connection',async()=>{
 let released;const client={async query(q){if(q==='COMMIT'&&mode==='commit'||q==='ROLLBACK'&&mode==='rollback'||q==='BEGIN'&&mode==='begin')throw new Error('network');},release(discard){released=discard;}};
 await assert.rejects(runPostgresScopedTransaction({pool:{connect:async()=>client},rawScope:{},normalizeScope:()=>({tenantId:'t',userId:'u',clientId:'c'}),operation:async()=>{if(mode==='rollback')throw new Error('operation');return true;},sanitizeError:()=>Object.assign(new Error('sanitized'),{code:'sanitized'}),commitUnknownError:()=>Object.assign(new Error('commit_unknown'),{code:'commit_unknown'})}),{code:mode==='commit'?'commit_unknown':'sanitized'});
 assert.equal(released,true);
});
test('F6 a healthy transaction and a clean rollback return the PG connection',async()=>{
 for(const fails of [false,true]){let released='unset';const client={async query(){},release(discard){released=discard;}};
  const run=runPostgresScopedTransaction({pool:{connect:async()=>client},rawScope:{},normalizeScope:()=>({tenantId:'t',userId:'u',clientId:'c'}),operation:async()=>{if(fails)throw new Error('op');return 1;},sanitizeError:()=>Object.assign(new Error('s'),{code:'s'}),commitUnknownError:()=>new Error('cu')});
  if(fails)await assert.rejects(run);else await run;assert.equal(released,undefined);}
});
test('F7 month/day rollover carries pending reservations; settlement books current period',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);await f.ledger.claimCall('owner',r);f.date('2026-11-01T00:00:01.000Z');
 assert.equal(f.open().budget('owner').monthly.spentUsd,0.1);assert.equal(f.open().budget('owner').providers.openai.spentUsd,0.1);
 await f.open().settle('owner',r);const rows=f.open().owner('owner');assert.equal(rows[0].reservedUsd,0);assert.equal(rows[1].chargedUsd,0.1);assert.equal(f.open().budget('owner').monthly.spentUsd,0.1);
});
test('P1-A a rename refused by Windows (EPERM/EBUSY) is retried, then commits with no lock left',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);const rename=fs.renameSync;let refused=0;
 try{fs.renameSync=(...a)=>{if(refused<4){refused++;throw Object.assign(new Error('busy'),{code:refused%2?'EPERM':'EBUSY'});}return rename(...a);};await f.ledger.claimCall('owner',r);}finally{fs.renameSync=rename;}
 assert.equal(refused,4);assert.equal(f.openStore().get('owner','cost-call',r.token).status,'claimed');
 assert.ok(!fs.existsSync(lockFile(f.root)));assert.ok(!fs.readdirSync(f.root).some(n=>n.endsWith('.tmp')));
});
test('P1-A a rename that never happens is a determinate failure: nothing published, lock released',async t=>{
 const f=fixture(t,{},{retryMs:50});const r=await f.reserve(f.ledger);const rename=fs.renameSync;
 try{fs.renameSync=()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});};await assert.rejects(f.ledger.claimCall('owner',r),e=>e.code==='store_write_failed'&&e.storageCode==='EPERM');}finally{fs.renameSync=rename;}
 assert.ok(!fs.existsSync(lockFile(f.root)));assert.equal(f.openStore().get('owner','cost-call',r.token).status,'reserved');
 assert.equal(await f.open().claimCall('owner',r),true);
});
test('P1-A commit applied but acknowledgement lost is verified on disk: applied once, never replayed',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);const rename=fs.renameSync;
 try{fs.renameSync=(...args)=>{rename(...args);throw Object.assign(new Error('lost acknowledgement'),{code:'EIO'});};assert.equal(await f.ledger.claimCall('owner',r),true);}finally{fs.renameSync=rename;}
 assert.equal(f.openStore().get('owner','cost-call',r.token).status,'claimed');assert.ok(!fs.existsSync(lockFile(f.root)));
 await assert.rejects(f.open().claimCall('owner',r),{code:'call_reconciliation_required'});
});
test('P1-A a truly unknown commit stays fail-closed until an explicit, verified recovery',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);const file=dataFile(f.root);const rename=fs.renameSync;const readFile=fs.readFileSync;let armed=false;
 try{
  fs.renameSync=()=>{armed=true;throw Object.assign(new Error('io'),{code:'EIO'});};
  fs.readFileSync=(p,...a)=>{if(armed&&p===file){armed=false;throw Object.assign(new Error('io'),{code:'EIO'});}return readFile(p,...a);};
  await assert.rejects(f.ledger.claimCall('owner',r),{code:'commit_unknown'});
 }finally{fs.renameSync=rename;fs.readFileSync=readFile;}
 assert.equal(JSON.parse(fs.readFileSync(lockFile(f.root),'utf8')).state,'uncertain');
 await assert.rejects(f.reserve(f.open(),'another-key'),{code:'store_recovery_required'});
 assert.throws(()=>f.openStore().put('owner','conversation','conv-1',{x:1}),{code:'store_recovery_required'});
 assert.throws(()=>f.openStore().recover('owner',{}),{code:'recovery_authority_required'});
 assert.deepEqual(f.openStore().recover('owner',{decidedBy:'owner'}),{recovered:true,previousState:'uncertain'});
 assert.equal(f.openStore().get('owner','cost-call',r.token).status,'reserved');
 assert.equal(await f.open().claimCall('owner',r),true);
 assert.deepEqual(f.openStore().recover('owner',{decidedBy:'owner'}),{recovered:false,reason:'no_lock'});
});
test('P1-A Windows: lock-free readers in other processes never leave the writer locked',async t=>{
 const f=fixture(t);await f.reserve(f.ledger,'seed');const N=60;const stop=path.join(f.root,'stop');
 const readers=[0,1].map(()=>child(f,`const end=Date.now()+60000;let n=0;const err={};process.stdout.write('ready\\n');while(Date.now()<end&&!require('node:fs').existsSync(${JSON.stringify(stop)})){try{l.budget('owner');l.mission('owner','mission-w');n++;}catch(e){err[e.code]=(err[e.code]||0)+1;}}console.log(JSON.stringify({n,err}));`));
 await waitFor(()=>readers.every(r=>r.lines().includes('ready')));
 const writer=child(f,`const err={};let ok=0;for(let i=0;i<${N};i++){try{await l.reserve('owner',{idempotencyKey:'w-'+i,missionId:'mission-w',modelId:'openai:fixture',estimatedUsd:0.01,approvedDailyBudgetUsd:1000});ok++;}catch(e){const k=e.code+(e.storageCode?'/'+e.storageCode:'');err[k]=(err[k]||0)+1;}}console.log(JSON.stringify({ok,err}));`);
 const w=JSON.parse(await writer.done);fs.writeFileSync(stop,'');const rs=(await Promise.all(readers.map(r=>r.done))).map(o=>JSON.parse(o.split('\n').pop()));
 assert.deepEqual(w,{ok:N,err:{}});for(const r of rs){assert.ok(r.n>0);assert.deepEqual(r.err,{});}
 assert.ok(!fs.existsSync(lockFile(f.root)));assert.equal(f.open().owner('owner')[0].openReservations,N+1);
});
test('P1-B a lock left by a dead process is reclaimed after its lease; a live holder is never broken',async t=>{
 const f=fixture(t,{},{lockLeaseMs:300});await f.reserve(f.ledger,'seed');
 // Live holder, lease long expired: it must not be broken.
 const live=child(f,`await s.transaction('owner',async()=>{process.stdout.write('held\\n');await new Promise(r=>setTimeout(r,1500));});console.log('released');`,{lockLeaseMs:300});
 await waitFor(()=>live.lines().includes('held'));const liveId=JSON.parse(fs.readFileSync(lockFile(f.root),'utf8')).id;await new Promise(r=>setTimeout(r,500));
 assert.throws(()=>f.openStore({acquireMs:200}).put('owner','conversation','conv-1',{x:1}),{code:'store_busy'});
 assert.throws(()=>f.openStore().recover('owner',{decidedBy:'owner'}),{code:'store_lock_live'});
 assert.equal(JSON.parse(fs.readFileSync(lockFile(f.root),'utf8')).id,liveId);
 assert.match(await live.done,/released/);assert.ok(!fs.existsSync(lockFile(f.root)));
 // Dead holder: killed while holding the lock.
 const dead=child(f,`await s.transaction('owner',async()=>{process.stdout.write('held\\n');await new Promise(()=>{});});`,{lockLeaseMs:300});
 await waitFor(()=>dead.lines().includes('held'));dead.c.kill('SIGKILL');await dead.done;
 assert.ok(fs.existsSync(lockFile(f.root)));
 await f.reserve(f.open(),'after-crash');assert.ok(!fs.existsSync(lockFile(f.root)));
 f.openStore().put('owner','conversation','conv-1',{x:1});
 assert.equal(f.open().owner('owner')[0].openReservations,2);
});
test('P1-B a slow holder in this same process keeps its lock past the lease',async t=>{
 const f=fixture(t,{},{lockLeaseMs:50,acquireMs:150});let resume;const gate=new Promise(r=>resume=r);let entered;const inside=new Promise(r=>entered=r);
 const held=f.openStore().transaction('owner',async()=>{entered();await gate;});await inside;await new Promise(r=>setTimeout(r,120));
 await assert.rejects(f.openStore().transaction('owner',()=>1),{code:'store_busy'});
 assert.throws(()=>f.openStore().put('owner','conversation','conv-1',{x:1}),{code:'store_busy'});
 resume();await held;assert.ok(!fs.existsSync(lockFile(f.root)));f.openStore().put('owner','conversation','conv-1',{x:1});
});
test('P1-B an unreadable or foreign lock is not reclaimed automatically',async t=>{
 const f=fixture(t,{},{lockLeaseMs:50,acquireMs:150});await f.reserve(f.ledger,'seed');const lock=lockFile(f.root);
 fs.writeFileSync(lock,JSON.stringify({id:'x',pid:1,host:'another-host',acquiredAt:0,expiresAt:0,state:'held'}));
 assert.throws(()=>f.openStore().put('owner','conversation','conv-1',{x:1}),{code:'store_busy'});
 // A holder on another host may be alive: nobody here breaks it (external review).
 for(const decidedBy of ['owner','supervisor'])assert.throws(()=>f.openStore().recover('owner',{decidedBy}),{code:'store_lock_live'});
 assert.equal(JSON.parse(fs.readFileSync(lock,'utf8')).host,'another-host');
 fs.writeFileSync(lock,'');const old=new Date(Date.now()-10000);fs.utimesSync(lock,old,old);
 assert.throws(()=>f.openStore().put('owner','conversation','conv-1',{x:1}),{code:'store_recovery_required'});
 assert.deepEqual(f.openStore().recover('owner',{decidedBy:'owner'}),{recovered:true,previousState:'corrupt'});
 f.openStore().put('owner','conversation','conv-1',{x:1});
});
test('P1-C governed: an uncertain external result is never repeated nor failed over, and blocks only its step',async t=>{
 const g=fixture(t,{catalog:CATALOG});const calls={a:0,b:0};let a=()=>({status:'error',errorCode:'reasoning_upstream_error'});
 const p=(id,fn)=>({status:'ready',provider:'openai',model:id,modelId:'openai:'+id,region:'eu',reason:async()=>{calls[id]++;return fn();}});
 const r=createGovernedReasoner({providers:[p('a',()=>a()),p('b',()=>({status:'ok',content:{ok:true},usage:{inputTokens:1,outputTokens:1}}))],requestFloor:'INTERNAL',privacyPolicy:{internalProviders:[{providerId:'openai'}]},approvedDailyBudgetUsd:2});
 const ask=(l,missionId='mission-1',taskId='task-1')=>r.reason({missionId,taskId,objective:'Compara materiales',egressText:'Compara materiales',request:{},basis:{inputTokens:1000,outputTokens:1000},spend:spendOf(l),accept:c=>c&&c.ok===true});
 const first=await ask(g.ledger).catch(e=>e);
 assert.equal(first.code,'call_reconciliation_required');assert.equal(first.status,'CALL_RECONCILIATION_REQUIRED');assert.equal(first.transient,false);
 assert.deepEqual(first.attempts.map(x=>[x.resource,x.failure,x.detail]),[['openai:a','CALL_RECONCILIATION_REQUIRED','reasoning_upstream_error']]);
 assert.deepEqual(calls,{a:1,b:0});
 for(const failure of ['timeout','unavailable']){a=failure==='timeout'?()=>({status:'error',errorCode:'reasoning_timeout'}):()=>{throw new Error('socket');};
  const e=await ask(g.open(),'mission-'+failure).catch(x=>x);assert.equal(e.code,'call_reconciliation_required');assert.notEqual(e.code,'reasoning_resource_unavailable');}
 assert.deepEqual(calls,{a:3,b:0});
 // Restart; the same step again: nothing is called, and it is never a budget condition.
 const again=await ask(g.open()).catch(e=>e);assert.equal(again.code,'call_reconciliation_required');assert.deepEqual(calls,{a:3,b:0});
 assert.ok(!again.attempts.some(x=>x.failure==='BUDGET_EXHAUSTED'));
 // An unrelated mission runs (on its first candidate, a now healthy).
 a=()=>({status:'ok',content:{ok:true},usage:{inputTokens:1,outputTokens:1}});
 assert.equal((await ask(g.open(),'mission-2')).resource,'openai:a');assert.deepEqual(calls,{a:4,b:0});
 // Owner reconciliation: keep uncertain, then not executed; the step may run again.
 const pending=g.openStore().list('owner','cost-call').find(e=>e.missionId==='mission-1');
 await assert.rejects(g.open().reconcileCall('owner',{token:pending.token,decision:'not_executed',decidedBy:'model',evidenceRef:'x'}),{code:'reconciliation_authority_required'});
 assert.deepEqual(await g.open().reconcileCall('owner',{token:pending.token,decision:'uncertain',...OWNER}),{status:'call_unknown',chargedUsd:0});
 assert.equal((await ask(g.open()).catch(e=>e)).code,'call_reconciliation_required');assert.deepEqual(calls,{a:4,b:0});
 assert.deepEqual(await g.open().reconcileCall('owner',{token:pending.token,decision:'not_executed',...OWNER}),{status:'released',chargedUsd:0});
 assert.deepEqual(await g.open().reconcileCall('owner',{token:pending.token,decision:'not_executed',...OWNER}),{status:'released',chargedUsd:0});
 await assert.rejects(g.open().reconcileCall('owner',{token:pending.token,decision:'charged',...OWNER}),{code:'reconciliation_conflict'});
 assert.equal((await ask(g.open())).resource,'openai:a');assert.deepEqual(calls,{a:5,b:0});
});
test('P1-C a response whose settlement is unconfirmed is never booked twice nor asked again',async t=>{
 const f=fixture(t);let calls=0;const p={status:'ready',provider:'openai',model:'fixture',modelId:'openai:fixture',region:'eu',reason:async()=>{calls++;return {status:'ok',content:{ok:true},usage:{inputTokens:1,outputTokens:1}};}};
 const r=createGovernedReasoner({providers:[p],requestFloor:'INTERNAL',privacyPolicy:{internalProviders:[{providerId:'openai'}]},approvedDailyBudgetUsd:2});
 const spend=(l,lost)=>({...spendOf(l),estimate:()=>0.1,settle:(x,u)=>lost?Promise.reject(Object.assign(new Error('store_busy'),{code:'store_busy'})):l.settle('owner',x,u)});
 const ask=(l,lost)=>r.reason({missionId:'mission-1',taskId:'task-1',objective:'Compara materiales',egressText:'Compara materiales',request:{},basis:{},spend:spend(l,lost),accept:c=>c&&c.ok===true});
 const e=await ask(f.ledger,true).catch(x=>x);assert.equal(e.code,'call_reconciliation_required');assert.equal(e.detail,'settle_unconfirmed');
 assert.equal((await ask(f.open(),false).catch(x=>x)).code,'call_reconciliation_required');assert.equal(calls,1);
 assert.equal(f.open().mission('owner','mission-1').chargedUsd,0);assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
});
test('P1-D thousands of settled calls never saturate the store; open and unknown calls are kept; totals exact',async t=>{
 const f=fixture(t,{policy:{missionBudgetUsd:1000,dailyBudgetUsd:1000},budget:{},retainSettledReceipts:20},{maxRecords:60});
 const unknown=await f.reserve(f.ledger,'unknown-1',0.001,{missionId:'mission-u',approvedDailyBudgetUsd:1000});await f.ledger.claimCall('owner',unknown);await f.ledger.markCallUnknown('owner',unknown);
 const open=await f.reserve(f.ledger,'open-1',0.001,{missionId:'mission-o',approvedDailyBudgetUsd:1000});
 const N=3000;for(let i=0;i<N;i++){const r=await f.reserve(f.ledger,'k-'+i,0.001,{missionId:'mission-'+(i%3),approvedDailyBudgetUsd:1000});await claimSettle(f.ledger,r);}
 const s=f.openStore();const calls=s.list('owner','cost-call');const kept=calls.filter(e=>e.status==='settled').length;
 assert.ok(kept<=20);
 assert.equal(calls.find(e=>e.token===unknown.token).status,'call_unknown');assert.equal(calls.find(e=>e.token===open.token).status,'reserved');
 assert.ok(s.list('owner','cost-key').length<=22);
 const archive=s.list('owner','cost-archive');
 assert.equal(archive.reduce((n,a)=>n+a.receipts,0)+kept,N);
 assert.equal(Math.round(archive.reduce((n,a)=>n+a.chargedUsd,0)*1e8),(N-kept)*0.001*1e8);
 assert.ok(archive.every(a=>/^[0-9a-f]{64}$/.test(a.chain)));
 const day=f.open().owner('owner')[0];assert.equal(day.calls,N);assert.equal(day.chargedUsd,3);assert.equal(day.reservedUsd,0.002);assert.equal(day.openReservations,2);
 assert.equal(['mission-0','mission-1','mission-2'].reduce((n,m)=>n+f.open().mission('owner',m).chargedUsd,0).toFixed(8),'3.00000000');
 // A compacted receipt is never settled again (no second charge); its key reserves anew.
 await assert.rejects(f.open().settle('owner',{token:'r-compacted',day:'day-2026-10-31'}),{code:'reservation_unknown'});
 assert.ok((await f.reserve(f.open(),'k-0',0.001,{missionId:'mission-0',approvedDailyBudgetUsd:1000})).token);
});
test('P2-B a plain write during an in-flight ledger transaction waits instead of failing',async t=>{
 const f=fixture(t);const store=f.openStore();const l=f.open(store);
 const p=f.reserve(l,'k1');let err=null;try{store.put('owner','conversation','conv-1',{a:1});}catch(e){err=e.code;}
 await p;assert.equal(err,null);
 // Another process holding the lock briefly: the synchronous write waits for it.
 const holder=child(f,`await s.transaction('owner',async()=>{process.stdout.write('held\\n');await new Promise(r=>setTimeout(r,300));});console.log('released');`);
 await waitFor(()=>holder.lines().includes('held'));const started=Date.now();store.put('owner','conversation','conv-2',{a:2});
 assert.ok(Date.now()-started>=100);assert.match(await holder.done,/released/);assert.deepEqual(store.get('owner','conversation','conv-2'),{a:2});
});
test('P2-C a changed estimate for a pending reservation is an explicit conflict, released only by reconciliation',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger,'key-1',0.1);
 await assert.rejects(f.reserve(f.open(),'key-1',0.2),e=>e.code==='reservation_conflict'&&e.detail==='estimate_changed'&&e.reconciliation===true);
 assert.equal(f.open().owner('owner')[0].openReservations,1);
 assert.deepEqual(await f.open().reconcileCall('owner',{token:r.token,decision:'not_executed',...OWNER}),{status:'released',chargedUsd:0});
 const next=await f.reserve(f.open(),'key-1',0.2);assert.notEqual(next.token,r.token);assert.equal(f.open().owner('owner')[0].reservedUsd,0.2);
});
test('P2-C governed: a reservation conflict stops the step with its own code and calls nothing',async t=>{
 const f=fixture(t);let calls=0;let estimate=0.1;const p={status:'ready',provider:'openai',model:'fixture',modelId:'openai:fixture',region:'eu',reason:async()=>{calls++;return {status:'ok',content:{ok:true},usage:{}};}};
 const r=createGovernedReasoner({providers:[p],requestFloor:'INTERNAL',privacyPolicy:{internalProviders:[{providerId:'openai'}]},approvedDailyBudgetUsd:2});
 await f.ledger.reserve('owner',{idempotencyKey:'mission-1:task-1:openai:fixture',scopeKey:'mission-1:task-1',missionId:'mission-1',modelId:'openai:fixture',estimatedUsd:0.1,approvedDailyBudgetUsd:2});
 estimate=0.2;const e=await r.reason({missionId:'mission-1',taskId:'task-1',objective:'Compara materiales',egressText:'Compara materiales',request:{},basis:{},spend:{...spendOf(f.ledger),estimate:()=>estimate},accept:()=>true}).catch(x=>x);
 assert.equal(e.code,'reservation_conflict');assert.equal(e.status,'CALL_RECONCILIATION_REQUIRED');assert.equal(e.transient,false);assert.equal(calls,0);
});
test('P2-D only a claimed call is settled; an unclaimed reservation is released, never charged',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);
 await assert.rejects(f.ledger.settle('owner',r),{code:'call_not_claimed'});
 await assert.rejects(f.ledger.reconcileCall('owner',{token:r.token,decision:'charged',...OWNER}),{code:'call_not_claimed'});
 await assert.rejects(f.ledger.reconcileCall('owner',{token:r.token,decision:'uncertain',...OWNER}),{code:'call_not_claimed'});
 await assert.rejects(f.ledger.reconcileCall('owner',{token:r.token,decision:'not_executed',decidedBy:'owner'}),{code:'reconciliation_evidence_required'});
 assert.deepEqual(await f.ledger.reconcileCall('owner',{token:r.token,decision:'not_executed',...OWNER}),{status:'released',chargedUsd:0});
 const day=f.open().owner('owner')[0];assert.equal(day.chargedUsd,0);assert.equal(day.calls,0);assert.equal(day.reservedUsd,0);
});
test('overcharge persists real expense, blocks with its own code until an explicit review; unsafe precision refused',async t=>{
 const catalog={'openai:fixture':{provider:'openai',tier:'small_model',inputUsdPerMillion:100,outputUsdPerMillion:100,residency:'eu',privacy:'provider_api',pricingVersion:'fixture',pricingSource:'fixture',reviewedAt:'2026-10-16'}};
 const f=fixture(t,{catalog});const r=await f.reserve(f.ledger);assert.equal(await claimSettle(f.ledger,r,{inputTokens:2000,outputTokens:0}),0.2);
 assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.2);
 await assert.rejects(f.reserve(f.open(),'new-key'),e=>e.code==='ledger_reconciliation_required'&&e.detail==='overcharge');
 await assert.rejects(f.open().clearOvercharge('owner',{decidedBy:'owner'}),{code:'reconciliation_evidence_required'});
 assert.deepEqual(await f.open().clearOvercharge('owner',OWNER),{blocked:false});
 assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.2);await f.reserve(f.open(),'new-key',0.01);
 await assert.rejects(f.reserve(f.open(),'tiny',0.000000001),{code:'money_precision_invalid'});
});
test('governed uncertain external result is never retried after restart',async t=>{
 const f=fixture(t);let calls=0;
 const p={status:'ready',provider:'openai',model:'fixture',modelId:'openai:fixture',region:'eu',reason:async()=>{calls++;throw new Error('network');}};
 const r=createGovernedReasoner({providers:[p],requestFloor:'INTERNAL',privacyPolicy:{internalProviders:[{providerId:'openai'}]},approvedDailyBudgetUsd:2});
 const ask=ledger=>r.reason({missionId:'mission-1',taskId:'task-1',objective:'Compara materiales',egressText:'Compara materiales',request:{},basis:{},spend:{...spendOf(ledger),estimate:()=>0.1}});
 await assert.rejects(ask(f.ledger),{code:'call_reconciliation_required'});await assert.rejects(ask(f.open()),{code:'call_reconciliation_required'});assert.equal(calls,1);assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
});
test('governed: a finished but rejected call may be asked again when its step resumes (WAIT_RESOURCE path)',async t=>{
 const f=fixture(t,{catalog:CATALOG});const calls={a:0,b:0};const p=(id,fn)=>({status:'ready',provider:'openai',model:id,modelId:'openai:'+id,region:'eu',reason:async()=>{calls[id]++;return fn();}});
 const r=createGovernedReasoner({providers:[p('a',()=>({status:'error',errorCode:'reasoning_rate_limited'})),p('b',()=>({status:'ok',content:{ok:false},usage:{inputTokens:1,outputTokens:1}}))],requestFloor:'INTERNAL',privacyPolicy:{internalProviders:[{providerId:'openai'}]},approvedDailyBudgetUsd:2});
 const ask=()=>r.reason({missionId:'mission-1',taskId:'task-1',objective:'Compara materiales',egressText:'Compara materiales',request:{},basis:{inputTokens:1000,outputTokens:1000},spend:spendOf(f.ledger),accept:c=>c&&c.ok===true}).catch(e=>e);
 for(let i=0;i<2;i++){const e=await ask();assert.equal(e.code,'reasoning_resource_unavailable');assert.equal(e.transient,true);}
 assert.deepEqual(calls,{a:2,b:2});
});
test('F1 mission hard limit rejects a second pending reservation',async t=>{
 const f=fixture(t,{policy:{missionBudgetUsd:0.15,dailyBudgetUsd:2}});await f.reserve(f.ledger,'first');
 await assert.rejects(async()=>await f.reserve(f.ledger,'second'),e=>e.code==='planning_budget_gate');
});
test('legacy open reservations require reconciliation before any new paid call',async t=>{
 const f=fixture(t);f.openStore().put('owner','cost','day-2026-10-31',{date:'2026-10-31',reservedUsd:0.1,chargedUsd:0,models:{},reservations:{legacy:{missionId:'mission-old',modelId:'openai:fixture',estimatedUsd:0.1}}});
 await assert.rejects(f.reserve(f.ledger),e=>e.code==='ledger_reconciliation_required'&&e.detail==='legacy_reservation');
});
test('daily and provider monthly limits retain pending spend across midnight',async t=>{
 const f=fixture(t,{policy:{dailyBudgetUsd:0.15,missionBudgetUsd:1}});await f.reserve(f.ledger);f.date('2026-11-01T00:00:01.000Z');
 await assert.rejects(f.reserve(f.open(),'second'),e=>e.detail==='mission_or_daily_budget');
 const g=fixture(t,{budget:{human:{amount:0.15,currency:'USD'},providers:{openai:{amount:0.15,currency:'USD'}}}});await g.reserve(g.ledger);g.date('2026-11-01T00:00:01.000Z');
 await assert.rejects(g.reserve(g.open(),'second'),e=>e.detail==='provider_budget');
});
test('overcharge also blocks already reserved calls from reaching a provider',async t=>{
 const catalog={'openai:fixture':{provider:'openai',tier:'small_model',inputUsdPerMillion:100,outputUsdPerMillion:100,residency:'eu',privacy:'provider_api',pricingVersion:'fixture',pricingSource:'fixture',reviewedAt:'2026-10-16'}};
 const f=fixture(t,{catalog});const first=await f.reserve(f.ledger,'first');const second=await f.reserve(f.ledger,'second');
 await claimSettle(f.ledger,first,{inputTokens:2000,outputTokens:0});
 await assert.rejects(f.open().claimCall('owner',second),{code:'ledger_reconciliation_required'});assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
});
