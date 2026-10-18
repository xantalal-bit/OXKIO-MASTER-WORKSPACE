'use strict';
// Post-reaudit P1 corrections of the V3 ledger (17/10/2026): the reclaim guard
// follows the lock's own evidence, a reused pid has a supervised recovery, an
// accepted paid step is final (ACCEPTED_FINAL) and checkpointed at once.
// Fake providers only: no network, no real model, no spend.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto'); const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { createCostLedger } = require('./cost-ledger');
const { createMemoryStoreFactory } = require('./memory-store');
const { createHmacIntegrity } = require('./integrity');
const { createGovernedReasoner, FAILURES } = require('./governed-reasoning');
const { createServerComposition } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');

function fixture(t, storeOptions = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-final-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const key = randomBytes(32); let date = '2026-10-31T23:59:59.000Z';
 const openStore = (more = {}) => createMemoryStoreFactory({ root, integrity: createHmacIntegrity({ key }), ...storeOptions, ...more })({ key: h => h });
 const open = (store = openStore()) => createCostLedger({ store, catalog: CATALOG, policy: { missionBudgetUsd: 1000, dailyBudgetUsd: 1000 }, now: () => date });
 return { root, key, openStore, open, setDate: d => { date = d; } };
}
const CATALOG = {}; for (const id of ['a', 'b']) CATALOG['openai:' + id] = { provider: 'openai', tier: 'small_model', inputUsdPerMillion: 1, outputUsdPerMillion: 1, residency: 'eu', privacy: 'provider_api', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-16' };
const dataFile = root => path.join(root, fs.readdirSync(root).find(n => n.endsWith('.json')));
const lockFile = root => dataFile(root) + '.lock';
const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
const meta = (pid, more = {}) => JSON.stringify({ id: randomUUID(), pid, host: os.hostname(), acquiredAt: Date.now() - 60000, expiresAt: Date.now() - 30000, state: 'held', ...more });
const deadPid = async () => { const c = spawn(process.execPath, ['-e', '0']); const pid = c.pid; await new Promise(r => c.on('exit', r)); return pid; };
const sleeper = t => { const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']); t.after(() => c.kill()); return c; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const SUPERVISOR = { decidedBy: 'supervisor' };

// ---------- P1-1 reclaim guard ----------
test('guard of a dead process next to an abandoned lock is cleared automatically; the store writes again', async t => {
 const f = fixture(t); const s = f.openStore(); s.put('owner', 'note', 'n-1', { a: 1 }); const pid = await deadPid();
 fs.writeFileSync(lockFile(f.root), meta(pid)); fs.writeFileSync(lockFile(f.root) + '.reclaim', meta(pid));
 assert.equal(code(() => s.put('owner', 'note', 'n-2', { a: 2 })), 'ok');
 assert.deepEqual(fs.readdirSync(f.root).filter(n => /\.(lock|reclaim|stale)/.test(n) && !n.endsWith('.won')), []);
 assert.equal(f.openStore().list('owner', 'note').length, 2, 'restart sees both writes');
});
for (const [name, content] of [['empty', ''], ['corrupt', '{"id":']]) test('an ' + name + ' guard older than its lease needs recover(); owner and supervisor clear it, then writes resume', async t => {
 for (const who of ['owner', 'supervisor']) {
  const f = fixture(t, { lockLeaseMs: 200, acquireMs: 300 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', { a: 1 });
  fs.writeFileSync(lockFile(f.root), meta(await deadPid())); fs.writeFileSync(lockFile(f.root) + '.reclaim', content); await wait(400);
  assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'store_recovery_required', 'never cleared automatically');
  assert.equal(s.recover('owner', { decidedBy: who }).recovered, true, who);
  assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'ok'); assert.equal(f.openStore().list('owner', 'note').length, 2);
 }
});
test('a fresh unreadable guard (being written) is never removed', async t => {
 const f = fixture(t, { lockLeaseMs: 5000, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', {});
 fs.writeFileSync(lockFile(f.root), meta(await deadPid())); fs.writeFileSync(lockFile(f.root) + '.reclaim', '');
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'store_busy');
 assert.equal(code(() => s.recover('owner', SUPERVISOR)), 'store_lock_live'); assert.ok(fs.existsSync(lockFile(f.root) + '.reclaim'));
});
test('a live guard (crash-free reclaimer still running) is never broken; once that process dies it is reclaimed by evidence', async t => {
 const f = fixture(t, { lockLeaseMs: 300, acquireMs: 300 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', {});
 const holder = sleeper(t); fs.writeFileSync(lockFile(f.root), meta(await deadPid())); fs.writeFileSync(lockFile(f.root) + '.reclaim', meta(holder.pid));
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'store_busy');
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live');
 holder.kill('SIGKILL'); await new Promise(r => holder.on('exit', r)); // the reclaimer crashed mid-reclaim
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'ok'); assert.ok(!fs.existsSync(lockFile(f.root) + '.reclaim'));
});
test('a guard of another host: its holder may be alive, so nobody breaks it (external review)', async t => {
 const f = fixture(t, { acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', {});
 fs.writeFileSync(lockFile(f.root), meta(await deadPid())); fs.writeFileSync(lockFile(f.root) + '.reclaim', meta(4242, { host: 'other-host' }));
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'store_busy');
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who })), 'store_lock_live', who);
 assert.ok(fs.existsSync(lockFile(f.root) + '.reclaim')); assert.equal(f.openStore().list('owner', 'note').length, 1);
});
test('a guard whose unlink keeps failing (EPERM/EBUSY) never blocks: it is cleared by evidence after its lease', async t => {
 const f = fixture(t, { lockLeaseMs: 200, retryMs: 50 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', {});
 const unlink = fs.unlinkSync; t.after(() => { fs.unlinkSync = unlink; });
 for (const errno of ['EPERM', 'EBUSY']) {
  fs.writeFileSync(lockFile(f.root), meta(await deadPid()));
  fs.unlinkSync = p => { if (String(p).endsWith('.reclaim')) throw Object.assign(new Error(errno), { code: errno }); return unlink(p); };
  assert.equal(code(() => s.put('owner', 'note', 'g-' + errno, {})), 'ok'); fs.unlinkSync = unlink;
  assert.ok(fs.existsSync(lockFile(f.root) + '.reclaim'), 'guard left behind by the refused unlink');
  fs.writeFileSync(lockFile(f.root), meta(await deadPid())); await wait(300);
  assert.equal(code(() => s.put('owner', 'note', 'h-' + errno, {})), 'ok'); assert.ok(!fs.existsSync(lockFile(f.root) + '.reclaim'));
 }
});
test('concurrent recoverers in several processes: each lock/guard removed at most once, no write lost', { timeout: 60000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-0', {});
 fs.writeFileSync(lockFile(f.root), meta(await deadPid())); fs.writeFileSync(lockFile(f.root) + '.reclaim', ''); await wait(400);
 const src = p => `const path=require('node:path');const so=${JSON.stringify(__dirname)};const {createMemoryStoreFactory}=require(path.join(so,'memory-store'));const {createHmacIntegrity}=require(path.join(so,'integrity'));
 const s=createMemoryStoreFactory({root:${JSON.stringify(f.root)},integrity:createHmacIntegrity({key:Buffer.from('${f.key.toString('hex')}','hex')}),lockLeaseMs:200,acquireMs:5000})({key:h=>h});
 const out={recover:[],put:null};for(let i=0;i<3;i++){try{out.recover.push(s.recover('owner',{decidedBy:'supervisor'}).recovered);}catch(e){out.recover.push(e.code);}}
 for(let i=0;i<10;i++){try{s.put('owner','note','p${p}-'+i,{});out.put=(out.put||0)+1;}catch(e){out.put=e.code;break;}}console.log(JSON.stringify(out));`;
 const runs = await Promise.all([1, 2, 3, 4].map(p => new Promise(r => { const c = spawn(process.execPath, ['-e', src(p)]); let o = ''; c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { o += d; }); c.on('exit', () => r(JSON.parse(o.trim()))); })));
 for (const r of runs) { assert.equal(r.put, 10); assert.ok(r.recover.every(v => [true, false, 'store_lock_live'].includes(v)), JSON.stringify(r.recover)); }
 assert.equal(f.openStore().list('owner', 'note').length, 41);
 assert.deepEqual(fs.readdirSync(f.root).filter(n => /\.(lock|reclaim|stale|won)/.test(n)), [], 'no lock, guard or claim left');
});

// ---------- P2 reused pid (identity rules: ledger-holder-identity.test.js) ----------
test('a live pid with an expired lease is never broken: lock id + evidence prove nothing', async t => {
 const f = fixture(t, { lockLeaseMs: 200, acquireMs: 200 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', {});
 const other = sleeper(t); const lock = JSON.parse(meta(other.pid)); fs.writeFileSync(lockFile(f.root), JSON.stringify(lock));
 assert.equal(code(() => s.put('owner', 'note', 'n-2', {})), 'store_busy');
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who, lockId: lock.id, evidenceRef: 'pid-reused-check' })), 'store_lock_live', who);
 assert.equal(JSON.parse(fs.readFileSync(lockFile(f.root), 'utf8')).id, lock.id);
});
test('a live holder awaiting past its lease renews it: nobody can break it', { timeout: 30000 }, async t => {
 const f = fixture(t, { lockLeaseMs: 300 }); const s = f.openStore(); s.put('owner', 'note', 'n-1', {});
 const src = `const path=require('node:path');const so=${JSON.stringify(__dirname)};const {createMemoryStoreFactory}=require(path.join(so,'memory-store'));const {createHmacIntegrity}=require(path.join(so,'integrity'));
 const s=createMemoryStoreFactory({root:${JSON.stringify(f.root)},integrity:createHmacIntegrity({key:Buffer.from('${f.key.toString('hex')}','hex')}),lockLeaseMs:300})({key:h=>h});
 s.transaction('owner',async()=>{console.log('held');await new Promise(r=>setTimeout(r,60000));});`;
 const c = spawn(process.execPath, ['-e', src]); let out = ''; c.stdout.on('data', d => { out += d; }); t.after(() => c.kill());
 const end = Date.now() + 10000; while (!out.includes('held')) { if (Date.now() > end) throw new Error('child'); await wait(20); }
 await wait(1500);
 const held = JSON.parse(fs.readFileSync(lockFile(f.root), 'utf8')); assert.ok(held.expiresAt > Date.now() - 300, 'lease renewed');
 for (const who of ['owner', 'supervisor']) assert.equal(code(() => s.recover('owner', { decidedBy: who, lockId: held.id, evidenceRef: 'x-1' })), 'store_lock_live', who);
});

// ---------- P1-2 ACCEPTED_FINAL ----------
function prov(id, behaviour) { const p = { status: 'ready', provider: 'openai', modelId: 'openai:' + id, model: id, region: 'eu', catalog: CATALOG, calls: 0, behaviour, async reason() { p.calls += 1; return p.behaviour(p.calls); } }; return p; }
const OK = () => ({ status: 'ok', content: { answer: 'x' }, usage: { inputTokens: 10, outputTokens: 10 }, evidence: { responseId: 'resp-fixed' } });
const spendOf = l => ({ estimate: l.estimate, budget: () => l.budget('owner'), reserve: o => l.reserve('owner', o), claimCall: x => l.claimCall('owner', x), markCallUnknown: x => l.markCallUnknown('owner', x), settle: (x, u, o) => l.settle('owner', x, u, o), recordExecution: e => l.recordExecution('owner', e) });
const reasoner = ps => createGovernedReasoner({ providers: ps, privacyPolicy: { confidentialProviders: [{ providerId: 'openai', region: 'eu' }] }, approvedDailyBudgetUsd: 1000 });
const ask = (r, l, more = {}) => r.reason({ objective: 'objetivo', egressText: 'objetivo', request: {}, basis: { inputTokens: 1000, outputTokens: 1000 }, spend: spendOf(l), missionId: 'mission-x', taskId: 'mission-x:analyze', ...more });
const SCOPE = { missionId: 'mission-x', scopeKey: 'mission-x:mission-x:analyze' };

test('ACCEPTED_FINAL: an accepted, settled step is never asked nor paid again (3 replays, restarts, other model, new callId)', async t => {
 const f = fixture(t); const a = prov('a', OK); const b = prov('b', OK);
 const first = await ask(reasoner([a]), f.open());
 assert.equal(a.calls, 1); assert.equal(first.chargedUsd, 0.00002); assert.equal(f.open().step('owner', SCOPE), 'ACCEPTED_FINAL');
 for (let i = 0; i < 2; i++) await assert.rejects(ask(reasoner([a, b]), f.open()), e => e.code === 'step_already_accepted' && e.status === FAILURES.STEP_ALREADY_ACCEPTED && e.transient === false);
 await assert.rejects(ask(reasoner([b, a]), f.open(f.openStore())), { code: 'step_already_accepted' }, 'another model after a restart');
 await assert.rejects(ask(reasoner([a]), f.open(), { callId: 'another-call' }), { code: 'step_already_accepted' }, 'same task, new callId');
 assert.equal(a.calls, 1); assert.equal(b.calls, 0);
 const m = f.open().mission('owner', 'mission-x'); assert.equal(m.chargedUsd, 0.00002); assert.equal(m.models['openai:a'].calls, 1);
 assert.ok(!f.open().owner('owner').some(d => d.openReservations), 'no reservation left open');
});
test('ACCEPTED_FINAL survives receipt compaction, a month change and a restart', async t => {
 const f = fixture(t, { maxRecords: 60 }); const a = prov('a', OK);
 await ask(reasoner([a]), f.open()); const l = f.open();
 // Each receipt closes 1 ms later (still 31/10): the oldest-first order never
 // depends on the random token tie-break, so mission-x's receipt (closed at
 // .000) is always among the compacted ones.
 for (let i = 0; i < 150; i++) { f.setDate(new Date(Date.parse('2026-10-31T23:59:59.000Z') + i + 1).toISOString()); const r = await l.reserve('owner', { idempotencyKey: 'k-' + i, missionId: 'mission-y', modelId: 'openai:a', estimatedUsd: 0.001, approvedDailyBudgetUsd: 1000 }); await l.claimCall('owner', r); await l.settle('owner', r, {}); }
 assert.ok(!f.openStore().list('owner', 'cost-call').some(e => e.missionId === 'mission-x'), 'detailed receipt compacted');
 f.setDate('2026-11-01T08:00:00.000Z');
 await assert.rejects(ask(reasoner([a]), f.open(f.openStore())), { code: 'step_already_accepted' }); assert.equal(a.calls, 1);
});
test('legitimate retries stay: INVALID_OUTPUT, rate limit and a definitive rejection are SETTLED_BUT_NOT_ACCEPTED', async t => {
 for (const behaviour of [() => ({ status: 'ok', content: { answer: 'bad' }, usage: { inputTokens: 1, outputTokens: 1 } }), () => ({ status: 'error', errorCode: 'reasoning_rate_limited' }), () => ({ status: 'error', errorCode: 'reasoning_request_rejected' })]) {
  const f = fixture(t); const a = prov('a', behaviour);
  await assert.rejects(ask(reasoner([a]), f.open(), { accept: c => c.answer === 'x' || 'verifier_rejected' }), { code: 'reasoning_resource_unavailable' });
  assert.equal(f.open().step('owner', SCOPE), 'SETTLED_BUT_NOT_ACCEPTED');
  a.behaviour = OK; await ask(reasoner([a]), f.open()); assert.equal(a.calls, 2, 'retried once, then final');
  await assert.rejects(ask(reasoner([a]), f.open()), { code: 'step_already_accepted' }); assert.equal(a.calls, 2);
 }
});
test('the four step states stay distinct; CALL_UNKNOWN and NOT_EXECUTED keep their own rules', async t => {
 const f = fixture(t); const a = prov('a', () => ({ status: 'error', errorCode: 'reasoning_upstream_error' }));
 await assert.rejects(ask(reasoner([a]), f.open()), { code: 'call_reconciliation_required' });
 assert.equal(f.open().step('owner', SCOPE), 'CALL_UNKNOWN');
 await assert.rejects(ask(reasoner([a]), f.open()), { code: 'call_reconciliation_required' }); assert.equal(a.calls, 1);
 const token = f.openStore().list('owner', 'cost-call')[0].token;
 await f.open().reconcileCall('owner', { token, decision: 'not_executed', decidedBy: 'owner', evidenceRef: 'dashboard-1' });
 assert.equal(f.open().step('owner', SCOPE), 'NOT_EXECUTED');
 a.behaviour = OK; await ask(reasoner([a]), f.open()); assert.equal(f.open().step('owner', SCOPE), 'ACCEPTED_FINAL'); assert.equal(a.calls, 2);
});
test('a reservation taken before another attempt was accepted is refused at claim with step_already_accepted', async t => {
 const f = fixture(t); const l = f.open();
 const early = await l.reserve('owner', { idempotencyKey: SCOPE.scopeKey + ':openai:b', scopeKey: SCOPE.scopeKey, missionId: 'mission-x', modelId: 'openai:b', estimatedUsd: 0.002, approvedDailyBudgetUsd: 1000 });
 await ask(reasoner([prov('a', OK)]), f.open());
 await assert.rejects(f.open().claimCall('owner', early), { code: 'step_already_accepted' });
});
test('reopenStep: owner/supervisor with evidence only; it allows exactly one new accepted attempt', async t => {
 const f = fixture(t); const a = prov('a', OK); await ask(reasoner([a]), f.open()); const l = f.open();
 await assert.rejects(l.reopenStep('owner', { ...SCOPE, decidedBy: 'model', evidenceRef: 'x-1' }), { code: 'reconciliation_authority_required' });
 await assert.rejects(l.reopenStep('owner', { ...SCOPE, decidedBy: 'owner' }), { code: 'reconciliation_evidence_required' });
 assert.equal((await l.reopenStep('owner', { ...SCOPE, decidedBy: 'owner', evidenceRef: 'owner-asked-1' })).status, 'reopened');
 await ask(reasoner([a]), f.open()); assert.equal(a.calls, 2);
 await assert.rejects(ask(reasoner([a]), f.open()), { code: 'step_already_accepted' }); assert.equal(a.calls, 2);
 assert.equal(f.open().mission('owner', 'mission-x').chargedUsd, 0.00004);
 assert.equal(Object.hasOwn(spendOf(l), 'reopenStep'), false, 'not in the reasoner spend view');
});

// ---------- P1-3 checkpoint at each crash boundary (real process crash) ----------
const UID = 'cliente-cero-controlled';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const QUESTION = 'Recupera de mi memoria lo que guardé sobre proveedores y compáralos';
const SYNTHESIS = `request=>({status:'ok',usage:{inputTokens:400,outputTokens:120},content:{findings:request.context.sources.map(s=>({claim:s.text.replace(/^.*?(?=Alfa|Beta)/u,'').replace(/[.\\s]*$/u,'.'),quote:s.text,sourceIds:[s.id]})),comparison:'Difieren en precio y en soporte.',conclusion:'Si el soporte en español es imprescindible conviene Alfa; si prima el coste, Beta.'}})`;
function composition(root, key, behaviour) {
 const p = { calls: 0, status: 'ready', provider: 'openai', model: 'primary', modelId: 'openai:primary', region: 'eu', catalog: { 'openai:primary': { provider: 'openai', tier: 'small_model', inputUsdPerMillion: 1, outputUsdPerMillion: 2, residency: 'eu', privacy: 'provider_api', pricingVersion: 'fixture', pricingSource: 'test-fixture', reviewedAt: '2026-10-04' } }, async reason(request) { p.calls += 1; return behaviour(request); } };
 const server = createServerComposition({ enabled: true, cohortUids: UID, integrityKey: key, memoryRoot: root, authorizeIdentity: authorize, reasoning: { providers: [p], privacyPolicy: { publicExternalAllowed: true, internalProviders: [], confidentialProviders: [{ providerId: 'openai', region: 'eu' }] }, approvedDailyBudgetUsd: 1 } });
 const ask = async (query, extra = {}) => { const req = Readable.from([JSON.stringify({ query, includeDetails: true, ...extra })]); req.oxkioIdentity = authorize({ uid: UID }).identity; let body; await server.handle(req, { writeHead() {}, end(b) { body = b; } }); return JSON.parse(body); };
 return { p, ask };
}
// The child runs the real composition and dies (process.exit) at one boundary.
function crashAt(root, key, boundary, behaviour) {
 const src = `const fs=require('node:fs');const path=require('node:path');const {Readable}=require('node:stream');const so=${JSON.stringify(__dirname)};
 const rename=fs.renameSync;let armed=false;
 fs.renameSync=(a,b)=>{rename(a,b);if(!armed||!String(b).endsWith('.json'))return;const text=fs.readFileSync(b,'utf8');
  if((${JSON.stringify(boundary)}==='after_accept'&&text.includes('accepted_final'))||(${JSON.stringify(boundary)}==='after_checkpoint'&&text.includes('"step-result"'))||(${JSON.stringify(boundary)}==='after_settle_not_accepted'&&text.includes('not_accepted')))process.exit(9);};
 const {createServerComposition}=require(path.join(so,'server-composition'));const {createExecutiveAuthorizer}=require(path.join(so,'../../security/executive-authorization'));
 const authorize=createExecutiveAuthorizer({OXKIO_ADMIN_FIREBASE_UIDS:${JSON.stringify(UID)}});const behaviour=${behaviour};
 const p={status:'ready',provider:'openai',model:'primary',modelId:'openai:primary',region:'eu',catalog:{'openai:primary':{provider:'openai',tier:'small_model',inputUsdPerMillion:1,outputUsdPerMillion:2,residency:'eu',privacy:'provider_api',pricingVersion:'fixture',pricingSource:'test-fixture',reviewedAt:'2026-10-04'}},
  async reason(request){console.log('CALL');if(${JSON.stringify(boundary)}==='before_settle')process.exit(9);return behaviour(request);}};
 const server=createServerComposition({enabled:true,cohortUids:${JSON.stringify(UID)},integrityKey:Buffer.from('${key.toString('hex')}','hex'),memoryRoot:${JSON.stringify(root)},authorizeIdentity:authorize,reasoning:{providers:[p],privacyPolicy:{publicExternalAllowed:true,internalProviders:[],confidentialProviders:[{providerId:'openai',region:'eu'}]},approvedDailyBudgetUsd:1}});
 const ask=async q=>{const req=Readable.from([JSON.stringify({query:q})]);req.oxkioIdentity=authorize({uid:${JSON.stringify(UID)}}).identity;await server.handle(req,{writeHead(){},end(){}});};
 (async()=>{await ask('Recuerda que entre los proveedores, Alfa cuesta 10 euros al mes con soporte en español');await ask('Recuerda que entre los proveedores, Beta cuesta 7 euros al mes sin soporte en español');armed=true;await ask(${JSON.stringify(QUESTION)});console.log('NO_CRASH');})();`;
 return new Promise(r => { const c = spawn(process.execPath, ['-e', src]); let o = ''; c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { o += d; }); c.on('exit', status => r({ status, out: o })); });
}
// The mission id and the owner's charged total, read from the sealed file.
function sealed(root) {
 const rows = fs.readdirSync(root).filter(n => /^[0-9a-f]{64}\.json$/.test(n)).flatMap(n => JSON.parse(fs.readFileSync(path.join(root, n), 'utf8')).longTermMemory.map(r => r.data));
 const mission = rows.find(r => r.kind === 'mission' && r.value.intention === QUESTION);
 return { missionId: mission && mission.id, charged: rows.filter(r => r.kind === 'cost').reduce((n, r) => n + r.value.chargedUsd, 0) };
}
for (const [boundary, expected] of [
 // charged: the refused answer is 10+10 tokens (0.00003 USD); the accepted one 400+120 (0.00064 USD).
 ['before_settle', { status: 'BLOCKED', diagnosis: 'call_reconciliation_required', calls: 0, charged: 0 }],
 ['after_settle_not_accepted', { status: 'COMPLETED', calls: 1, charged: 0.00067 }],
 ['after_accept', { status: 'BLOCKED', diagnosis: 'step_already_accepted', calls: 0, charged: 0.00064 }],
 ['after_checkpoint', { status: 'COMPLETED', calls: 0, charged: 0.00064, reused: true }],
]) test('crash ' + boundary + ': restart + resume never pays an accepted step again', { timeout: 120000 }, async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-crash-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const key = randomBytes(32);
 const behaviour = boundary === 'after_settle_not_accepted' ? `()=>({status:'ok',usage:{inputTokens:10,outputTokens:10},content:{findings:[],comparison:'',conclusion:''}})` : SYNTHESIS;
 const crash = await crashAt(root, key, boundary, behaviour);
 assert.equal(crash.status, 9, crash.out); assert.equal((crash.out.match(/CALL/g) || []).length, 1);
 const { missionId } = sealed(root); assert.ok(missionId);
 await wait(10500); // a lock left by the crash is reclaimed only after its lease (default 10 s)
 const s2 = composition(root, key, eval(SYNTHESIS)); const r = await s2.ask('continúa', { action: 'resume', missionId }); const d = r.details;
 assert.equal(d.status, expected.status, JSON.stringify(d.diagnosis)); assert.equal(s2.p.calls, expected.calls);
 if (expected.diagnosis) assert.equal(d.diagnosis.class, expected.diagnosis);
 if (expected.reused) assert.ok(d.trace.some(e => e.event === 'COGNITION_REUSED'));
 const after = composition(root, key, eval(SYNTHESIS)); await after.ask('continúa', { action: 'resume', missionId }).catch(() => null);
 assert.equal(after.p.calls, 0, 'a second resume never calls');
 assert.equal(Math.round(sealed(root).charged * 1e8), Math.round(expected.charged * 1e8), 'charged once per paid call');
});
