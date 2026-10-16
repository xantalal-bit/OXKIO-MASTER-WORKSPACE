'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {createCostLedger}=require('./cost-ledger');
const {createMemoryStoreFactory}=require('./memory-store');
const {createHmacIntegrity}=require('./integrity');
const {runPostgresScopedTransaction}=require('../../repositories/postgres/postgres-scoped-transaction');
function fixture(t,extra={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-atomic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const key=randomBytes(32);let date='2026-10-31T23:59:59.000Z';
 const openStore=()=>createMemoryStoreFactory({root,integrity:createHmacIntegrity({key})})({key:h=>h});
 const options={policy:{missionBudgetUsd:1,dailyBudgetUsd:2},budget:{human:{amount:2,currency:'USD'},providers:{openai:{amount:2,currency:'USD'}}},...extra};
 const open=(store=openStore())=>createCostLedger({store,...options,now:()=>date});
 return {root,open,openStore,ledger:open(),date:v=>{date=v;},reserve:(l,key='key-1',amount=0.1)=>l.reserve('owner',{idempotencyKey:key,missionId:'mission-1',modelId:'openai:fixture',estimatedUsd:amount,approvedDailyBudgetUsd:2})};
}
test('F1 mission includes open reservations and stable reservation identity',async t=>{
 const f=fixture(t,{policy:{missionBudgetUsd:0.15,dailyBudgetUsd:2}});const r=await f.reserve(f.ledger);
 assert.deepEqual(await f.reserve(f.open()),r);
 await assert.rejects(f.reserve(f.ledger,'key-2'),e=>e.code==='planning_budget_gate');
 assert.equal(f.ledger.owner('owner')[0].reservedUsd,0.1);
});
test('F2 failed partial settlement rolls back both rows; restart recovers token',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);const original=f.openStore();let writes=0;
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
 const f=fixture(t);const r=await f.reserve(f.ledger);assert.deepEqual(await Promise.all([f.ledger.settle('owner',r),f.open().settle('owner',r)]),[0.1,0.1]);
 const day=f.open().owner('owner')[0];assert.equal(day.calls,1);assert.equal(day.chargedUsd,0.1);assert.equal(day.reservedUsd,0);assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.1);
});
test('F5 durable claim survives restart; unknown call blocks repeat and new calls',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);await f.ledger.claimCall('owner',r);
 await assert.rejects(f.open().claimCall('owner',r),{code:'call_reconciliation_required'});
 await f.open().markCallUnknown('owner',r);
 await assert.rejects(f.reserve(f.open(),'different-key'),e=>e.detail==='reconciliation_required');
 await assert.rejects(f.open().claimCall('owner',r),{code:'call_reconciliation_required'});
 assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
 // Reconciliation has explicit evidence of the charge; it never calls a provider.
 assert.equal(await f.open().settle('owner',r),0.1);
});
for(const mode of ['commit','rollback'])test('F6 '+mode+' failure discards PG connection',async()=>{
 let released;const client={async query(q){if(q==='COMMIT'&&mode==='commit'||q==='ROLLBACK'&&mode==='rollback')throw new Error('network');},release(discard){released=discard;}};
 await assert.rejects(runPostgresScopedTransaction({pool:{connect:async()=>client},rawScope:{},normalizeScope:()=>({tenantId:'t',userId:'u',clientId:'c'}),operation:async()=>{if(mode==='rollback')throw new Error('operation');return true;},sanitizeError:()=>Object.assign(new Error('sanitized'),{code:'sanitized'}),commitUnknownError:()=>Object.assign(new Error('commit_unknown'),{code:'commit_unknown'})}),{code:mode==='commit'?'commit_unknown':'sanitized'});
 assert.equal(released,true);
});
test('F7 month/day rollover carries pending reservations; settlement books current period',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);f.date('2026-11-01T00:00:01.000Z');
 assert.equal(f.open().budget('owner').monthly.spentUsd,0.1);assert.equal(f.open().budget('owner').providers.openai.spentUsd,0.1);
 await f.open().settle('owner',r);const rows=f.open().owner('owner');assert.equal(rows[0].reservedUsd,0);assert.equal(rows[1].chargedUsd,0.1);assert.equal(f.open().budget('owner').monthly.spentUsd,0.1);
});
test('commit_unknown leaves durable lock and prevents any new authority',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);const rename=fs.renameSync;
 try{fs.renameSync=()=>{throw Object.assign(new Error('network'),{code:'EIO'});};await assert.rejects(f.ledger.claimCall('owner',r),{code:'commit_unknown'});}finally{fs.renameSync=rename;}
 assert.ok(fs.readdirSync(f.root).some(n=>n.endsWith('.lock')));
 await assert.rejects(f.reserve(f.open(),'another-key'),{code:'store_busy'});
});
test('overcharge persists real expense, blocks further calls; unsafe precision refused',async t=>{
 const catalog={'openai:fixture':{provider:'openai',tier:'small_model',inputUsdPerMillion:100,outputUsdPerMillion:100,residency:'eu',privacy:'provider_api',pricingVersion:'fixture',pricingSource:'fixture',reviewedAt:'2026-10-16'}};
 const f=fixture(t,{catalog});const r=await f.reserve(f.ledger);assert.equal(await f.ledger.settle('owner',r,{inputTokens:2000,outputTokens:0}),0.2);
 assert.equal(f.open().mission('owner','mission-1').chargedUsd,0.2);await assert.rejects(f.reserve(f.open(),'new-key'),e=>e.detail==='reconciliation_required');
 await assert.rejects(f.reserve(f.open(),'tiny',0.000000001),{code:'money_precision_invalid'});
});
test('governed uncertain external result is never retried after restart',async t=>{
 const {createGovernedReasoner}=require('./governed-reasoning');const f=fixture(t);let calls=0;
 const p={status:'ready',provider:'openai',model:'fixture',modelId:'openai:fixture',region:'eu',reason:async()=>{calls++;throw new Error('network');}};
 const r=createGovernedReasoner({providers:[p],requestFloor:'INTERNAL',privacyPolicy:{internalProviders:[{providerId:'openai'}]},approvedDailyBudgetUsd:2});
 const ask=ledger=>r.reason({missionId:'mission-1',taskId:'task-1',objective:'Compara materiales',egressText:'Compara materiales',request:{},basis:{},spend:{estimate:()=>0.1,budget:()=>ledger.budget('owner'),reserve:o=>ledger.reserve('owner',o),claimCall:x=>ledger.claimCall('owner',x),markCallUnknown:x=>ledger.markCallUnknown('owner',x),settle:(x,u)=>ledger.settle('owner',x,u)}});
 await assert.rejects(ask(f.ledger),{code:'call_reconciliation_required'});await assert.rejects(ask(f.open()),{code:'call_reconciliation_required'});assert.equal(calls,1);assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
});
test('F1 mission hard limit rejects a second pending reservation',async t=>{
 const f=fixture(t,{policy:{missionBudgetUsd:0.15,dailyBudgetUsd:2}});await f.reserve(f.ledger,'first');
 await assert.rejects(async()=>await f.reserve(f.ledger,'second'),e=>e.code==='planning_budget_gate');
});
test('commit applied but acknowledgement lost blocks replay',async t=>{
 const f=fixture(t);const r=await f.reserve(f.ledger);const rename=fs.renameSync;
 try{fs.renameSync=(...args)=>{rename(...args);throw Object.assign(new Error('lost acknowledgement'),{code:'EIO'});};await assert.rejects(f.ledger.claimCall('owner',r),{code:'commit_unknown'});}finally{fs.renameSync=rename;}
 assert.equal(f.openStore().get('owner','cost-call',r.token).status,'claimed');
 await assert.rejects(f.open().claimCall('owner',r),{code:'store_busy'});
});
test('legacy open reservations require reconciliation before any new paid call',async t=>{
 const f=fixture(t);f.openStore().put('owner','cost','day-2026-10-31',{date:'2026-10-31',reservedUsd:0.1,chargedUsd:0,models:{},reservations:{legacy:{missionId:'mission-old',modelId:'openai:fixture',estimatedUsd:0.1}}});
 await assert.rejects(f.reserve(f.ledger),e=>e.detail==='legacy_reconciliation_required');
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
 await f.ledger.claimCall('owner',first);await f.ledger.settle('owner',first,{inputTokens:2000,outputTokens:0});
 await assert.rejects(f.open().claimCall('owner',second),{code:'call_reconciliation_required'});assert.equal(f.open().owner('owner')[0].reservedUsd,0.1);
});
