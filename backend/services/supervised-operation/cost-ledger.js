'use strict';
const { normalizePolicy } = require('../runtime/cost-policy');
const { normalizeCatalog, estimateCatalogCostUsd } = require('../runtime/model-cost-catalog');
const { createHash } = require('node:crypto');
const { copy, freeze, fail } = require('./scope-session');
// V3 cost accounting reuses the canonical cost policy and the reviewed model
// catalog; the Executive Chat CostController stays with its single owner.
// Every figure lives in the owner's scoped (sealed) store, so budgets survive
// a restart and one owner's spend can never be read or charged by another.
// A reservation is written before the paid call and settled after it: a crash
// in between keeps the reservation counted (never under-counts spend).
const units = value => { const n = Math.round(value * 1e8); if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(n) || Math.abs(n / 1e8 - value) > 1e-12) fail('money_precision_invalid'); return n; };
const round = value => { const n = Math.round(value * 1e8); if (!Number.isSafeInteger(n)) fail('money_precision_invalid'); return n / 1e8; };
// Multi-IA V1-A (10/10/2026): the ledger counts in its accounting currency
// (USD, as the reviewed catalog prices). The human authorization keeps its own
// amount and currency (e.g. 40 EUR/month); it becomes an accounting limit only
// through an explicit, reviewed FX policy. There is no implicit or built-in
// rate: without one, every paid call stops (fail closed).
const ACCOUNTING_CURRENCY = 'USD';
const CURRENCY = /^[A-Z]{3}$/; const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WARNINGS = Object.freeze([0.7, 0.9]);
const MAX_EXECUTIONS = 20;
function budgetGate(detail) { throw Object.assign(new Error('planning_budget_gate'), { code: 'planning_budget_gate', detail }); }
// A call or ledger that needs a human decision: its own code, never a budget
// condition (not transient, so nothing waits for it to clear by itself).
function reconciliationGate(code, detail) { throw Object.assign(new Error(code), { code, detail, reconciliation: true }); }
// A step whose paid answer was settled and accepted is final: no model is
// asked again for it (never a budget nor a reconciliation condition).
function acceptedGate(detail) { throw Object.assign(new Error('step_already_accepted'), { code: 'step_already_accepted', detail, accepted: true }); }
const ACCEPTED_FINAL = 'accepted_final';
function money(value) {
 return value && typeof value === 'object' && Number.isFinite(value.amount) && value.amount >= 0 && typeof value.currency === 'string' && CURRENCY.test(value.currency)
  ? freeze({ amount: value.amount, currency: value.currency }) : null;
}
function reviewedFx(fx) {
 return fx && typeof fx === 'object' && typeof fx.from === 'string' && CURRENCY.test(fx.from) && fx.to === ACCOUNTING_CURRENCY && fx.from !== fx.to
  && Number.isFinite(fx.rate) && fx.rate > 0 && typeof fx.source === 'string' && fx.source.trim() && DATE.test(String(fx.reviewedAt || ''))
  ? freeze({ from: fx.from, to: fx.to, rate: fx.rate, source: fx.source.trim(), reviewedAt: fx.reviewedAt }) : null;
}
// budget: { human: { amount, currency }, providers: { [providerId]: { amount,
//   currency } }, fx: { from, to, rate, source, reviewedAt }, warnings: [0..1],
//   perCallMaxUsd }. Without `human` the ledger keeps its previous behaviour
// (mission and daily limits only): status UNLIMITED means no monthly limit.
function resolveBudget(budget = {}) {
 const b = budget && typeof budget === 'object' ? budget : {};
 const warnings = Array.isArray(b.warnings) && b.warnings.length && b.warnings.every(w => Number.isFinite(w) && w > 0 && w < 1) ? freeze([...b.warnings].sort((x, y) => x - y)) : DEFAULT_WARNINGS;
 if (b.perCallMaxUsd !== undefined && b.perCallMaxUsd !== null && !(Number.isFinite(b.perCallMaxUsd) && b.perCallMaxUsd > 0)) fail('budget_invalid');
 const base = { accountingCurrency: ACCOUNTING_CURRENCY, warnings, perCallMaxUsd: b.perCallMaxUsd || null };
 if (b.human === undefined || b.human === null) return freeze({ ...base, status: 'UNLIMITED', human: null, providers: {}, fx: null, monthlyLimitUsd: null, providerLimitsUsd: {} });
 const human = money(b.human); if (!human) fail('budget_invalid');
 const providers = {};
 for (const [id, value] of Object.entries(b.providers || {})) { const m = money(value); if (!m || !/^[a-z0-9-]{2,32}$/.test(id)) fail('budget_invalid'); providers[id] = m; }
 const fx = reviewedFx(b.fx);
 const convert = m => (m.currency === ACCOUNTING_CURRENCY ? m.amount : fx && fx.from === m.currency ? round(m.amount * fx.rate) : null);
 const monthlyLimitUsd = convert(human); const providerLimitsUsd = {};
 for (const [id, m] of Object.entries(providers)) providerLimitsUsd[id] = convert(m);
 const convertible = monthlyLimitUsd !== null && Object.values(providerLimitsUsd).every(v => v !== null);
 return freeze({ ...base, status: convertible ? 'LIMITED' : 'FX_POLICY_REQUIRED', human, providers, fx,
  monthlyLimitUsd: convertible ? monthlyLimitUsd : null, providerLimitsUsd: convertible ? providerLimitsUsd : {} });
}
// Execution records hold fixed codes, ids and numbers only: anything else is
// dropped, so no prompt, source text or secret can be stored through them.
const CODE = /^[A-Za-z0-9:._-]{1,128}$/;
const TEXT_FIELDS = ['missionId', 'taskId', 'taskType', 'provider', 'model', 'resource', 'region', 'role', 'reviewer', 'privacyClass', 'status', 'verificationStatus', 'failureKind', 'fallbackReason', 'responseId'];
const NUMBER_FIELDS = ['estimatedCost', 'chargedCost', 'latencyMs'];
function executionEntry(execution) {
 const entry = {};
 for (const field of TEXT_FIELDS) entry[field] = typeof execution[field] === 'string' && CODE.test(execution[field]) ? execution[field] : null;
 for (const field of NUMBER_FIELDS) entry[field] = Number.isFinite(execution[field]) && execution[field] >= 0 ? execution[field] : null;
 entry.accountingCurrency = ACCOUNTING_CURRENCY;
 return entry;
}
function createCostLedger({ store, catalog = {}, policy = {}, budget = {}, now = () => new Date().toISOString(), retainSettledReceipts = 200, _transaction = false }) {
 const reviewed = normalizeCatalog(catalog); const rules = normalizePolicy(policy); const limits = resolveBudget(budget);
 const dayId = () => 'day-' + now().slice(0, 10);
 const read = (handle, kind, id, empty) => { try { return store.get(handle, kind, id); } catch (error) { if (error.code === 'resource_not_found') return empty(); throw error; } };
 const emptyDay = () => ({ date: now().slice(0, 10), reservedUsd: 0, chargedUsd: 0, knownActualUsd: 0, calls: 0, tokens: 0, models: {}, tools: {}, reservations: {} });
 const emptyMission = () => ({ chargedUsd: 0, models: {}, tools: {} });
 const providerOf = modelId => (Object.hasOwn(reviewed, modelId) ? reviewed[modelId].provider : String(modelId).split(':')[0]);
 function estimate(modelId, { inputTokens, outputTokens }) {
  const usd = estimateCatalogCostUsd(reviewed, modelId, { inputTokens, outputTokens });
  return Number.isFinite(usd) ? usd : null;
 }
 // This month's spend from the sealed day records: charged plus still-open
 // reservations, in total and per provider.
 function monthSpend(handle) {
  const month = now().slice(0, 7); let total = 0; const byProvider = {};
  const add = (id, usd) => { byProvider[id] = round((byProvider[id] || 0) + (Number.isFinite(usd) ? usd : 0)); };
  for (const day of store.list(handle, 'cost')) {
   if (!day || typeof day.date !== 'string') fail('stored_data_invalid');
   const current = day.date.startsWith(month);
   total += (current ? day.chargedUsd || 0 : 0) + (day.reservedUsd || 0);
   if (current) for (const [modelId, model] of Object.entries(day.models || {})) add(providerOf(modelId), model.usd);
   for (const entry of Object.values(day.reservations || {})) add(entry.provider || providerOf(entry.modelId), entry.estimatedUsd);
  }
  return { total: round(total), byProvider };
 }
 const warningOf = (spent, limit) => { if (!(limit > 0)) return null; const t = [...limits.warnings].reverse().find(w => spent >= w * limit); return t ? 'WARN_' + Math.round(t * 100) : null; };
 const line = (spent, limit) => freeze({ limitUsd: limit, spentUsd: spent, remainingUsd: round(Math.max(0, limit - spent)), warning: warningOf(spent, limit) });
 // Snapshot for the router; reserve() below stays the authority.
 function budgetState(handle) {
  const head = { status: limits.status, accountingCurrency: ACCOUNTING_CURRENCY, human: limits.human, fx: limits.fx };
  if (limits.status !== 'LIMITED') return freeze({ ...head, monthly: null, providers: {} });
  const spent = monthSpend(handle); const providers = {};
  for (const [id, limit] of Object.entries(limits.providerLimitsUsd)) providers[id] = line(spent.byProvider[id] || 0, limit);
  return freeze({ ...head, monthly: line(spent.total, limits.monthlyLimitUsd), providers });
 }
 // A call scope is one mission step (mission + task or phase): every model the
 // step may try shares it. An uncertain call blocks its own scope only, so it
 // is never repeated nor replaced by a failover, while unrelated missions go on.
 const hashId = (prefix, value) => prefix + createHash('sha256').update(value).digest('hex');
 const OPEN_CALL = ['claimed', 'call_unknown'];
 const scopeBusy = (handle, scope, token) => store.list(handle, 'cost-call').some(e => e.scope === scope && e.token !== token && OPEN_CALL.includes(e.status));
 const overcharged = handle => read(handle, 'cost-control', 'owner-control', () => ({})).blocked === true;
 // The ACCEPTED_FINAL marker of a step lives in its mission's own cost record
 // (never compacted, not tied to a day or month), so it outlives the detailed
 // receipt, a restart and a period change. Every model of the step shares it.
 const acceptedStep = (handle, missionId, scope) => { const steps = read(handle, 'cost-mission', missionId, emptyMission).steps || {}; return steps[scope] && steps[scope].status === ACCEPTED_FINAL ? steps[scope] : null; };
 function reserve(handle, { missionId, modelId, estimatedUsd, approvedDailyBudgetUsd, idempotencyKey, scopeKey }) {
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0 || !Number.isFinite(approvedDailyBudgetUsd) || approvedDailyBudgetUsd <= 0) fail('planning_budget_gate');
  units(estimatedUsd); units(approvedDailyBudgetUsd);
  const key = idempotencyKey || store.newId(); const scopeText = scopeKey || key;
  for (const value of [key, scopeText]) if (typeof value !== 'string' || !/^[A-Za-z0-9:._-]{1,512}$/.test(value)) fail('reservation_key_invalid');
  const keyId = hashId('k-', key); const scope = hashId('s-', scopeText);
  if (acceptedStep(handle, missionId, scope)) acceptedGate('scope_accepted');
  const index = read(handle, 'cost-key', keyId, () => null);
  const prior = index ? read(handle, 'cost-call', index.token, () => null) : null;
  if (prior) {
   if (OPEN_CALL.includes(prior.status)) reconciliationGate('call_reconciliation_required', 'call_uncertain');
   if (prior.status === 'reserved') {
    // Never claimed, so never called: the same reservation resumes. A changed
    // estimate is a conflict to release explicitly, never a second call.
    if (prior.missionId !== missionId || prior.modelId !== modelId || prior.estimatedUsd !== estimatedUsd) reconciliationGate('reservation_conflict', prior.estimatedUsd !== estimatedUsd ? 'estimate_changed' : 'identity_changed');
    return freeze({ token: index.token, day: prior.day });
   }
   // settled or released: that call is finished; a new attempt reserves anew.
  }
  const token = 'r-' + store.newId();
  store.put(handle, 'cost-key', keyId, { token });
  if (overcharged(handle)) reconciliationGate('ledger_reconciliation_required', 'overcharge');
  if (scopeBusy(handle, scope, token)) reconciliationGate('call_reconciliation_required', 'scope_uncertain');
  const period = dayId(); const day = read(handle, 'cost', period, emptyDay); const mission = read(handle, 'cost-mission', missionId, emptyMission);
  const days = store.list(handle,'cost');
  for(const d of days)for(const open of Object.keys(d.reservations||{}))if(!read(handle,'cost-call',open,()=>null))reconciliationGate('ledger_reconciliation_required','legacy_reservation');
  const open = days.flatMap(d=>Object.values(d.reservations||{}));
  const missionPending = open.filter(e=>e.missionId===missionId).reduce((n,e)=>n+units(e.estimatedUsd),0);
  const dailyPending = open.reduce((n,e)=>n+units(e.estimatedUsd),0);
  if(units(mission.chargedUsd)+missionPending+units(estimatedUsd)>units(rules.missionBudgetUsd)
   ||units(day.chargedUsd)+dailyPending+units(estimatedUsd)>units(Math.min(rules.dailyBudgetUsd,approvedDailyBudgetUsd)))budgetGate('mission_or_daily_budget');
  if (limits.perCallMaxUsd !== null && units(estimatedUsd) > units(limits.perCallMaxUsd)) budgetGate('per_call_limit');
  if (limits.status === 'FX_POLICY_REQUIRED') budgetGate('fx_policy_required');
  const provider = providerOf(modelId);
  if (limits.status === 'LIMITED') {
   // Hard stops: a provider with no limit of its own gets nothing; then its
   // monthly limit, then the global one. Open reservations count.
   if (!Object.hasOwn(limits.providerLimitsUsd, provider)) budgetGate('provider_budget_unset');
   const spent = monthSpend(handle);
   if (units(round((spent.byProvider[provider] || 0) + estimatedUsd)) > units(limits.providerLimitsUsd[provider])) budgetGate('provider_budget');
   if (units(round(spent.total + estimatedUsd)) > units(limits.monthlyLimitUsd)) budgetGate('monthly_budget');
  }
  day.reservedUsd = round(day.reservedUsd + estimatedUsd); day.reservations[token] = { missionId, modelId, provider, estimatedUsd };
  store.put(handle, 'cost', period, day);
  store.put(handle,'cost-call',token,{...day.reservations[token],token,keyId,scope,day:period,status:'reserved'});
  return freeze({ token, day: period });
 }
 // Books a finished call: the reservation leaves its own day, the charge goes
 // to the current day and to the mission, all in the caller's transaction.
 function book(handle, token, entry, usage) {
  for(const k of ['inputTokens','outputTokens'])if(usage[k]!==undefined&&(!Number.isSafeInteger(usage[k])||usage[k]<0))fail('usage_invalid');
  const day = read(handle, 'cost', entry.day, emptyDay);
  if(!day.reservations[token])fail('reservation_unknown');
  const reported = Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens) ? estimate(entry.modelId, usage) : null;
  const charged = reported === null ? entry.estimatedUsd : Math.max(reported, 0);
  delete day.reservations[token];
  day.reservedUsd = round(Math.max(0, day.reservedUsd - entry.estimatedUsd));
  const chargePeriod = dayId();
  const chargedDay = chargePeriod === entry.day ? day : read(handle,'cost',chargePeriod,emptyDay);
  chargedDay.chargedUsd = round(chargedDay.chargedUsd + charged); chargedDay.calls += 1;
  if (reported !== null) { chargedDay.knownActualUsd = round(chargedDay.knownActualUsd + reported); chargedDay.tokens += usage.inputTokens + usage.outputTokens; }
  const model = chargedDay.models[entry.modelId] || { calls: 0, usd: 0 }; chargedDay.models[entry.modelId] = { calls: model.calls + 1, usd: round(model.usd + charged) };
  store.put(handle, 'cost', entry.day, day);
  if(chargePeriod!==entry.day)store.put(handle,'cost',chargePeriod,chargedDay);
  const mission = read(handle, 'cost-mission', entry.missionId, emptyMission); const mm = mission.models[entry.modelId] || { calls: 0, usd: 0 };
  mission.models[entry.modelId] = { calls: mm.calls + 1, usd: round(mm.usd + charged) }; mission.chargedUsd = round(mission.chargedUsd + charged);
  store.put(handle, 'cost-mission', entry.missionId, mission);
  if(units(charged)>units(entry.estimatedUsd))store.put(handle,'cost-control','owner-control',{blocked:true,reason:'overcharge'});
  return charged;
 }
 // Retention: only finished receipts (settled, released) are compacted, the
 // oldest first, beyond the most recent `retainSettledReceipts`. Each one is
 // folded into its month's archive (count, sum and a hash chain over the
 // receipt) before it and its key index leave. Open, claimed and unknown calls
 // are never compacted; day and mission totals are untouched.
 // The receipts kept never take more than a tenth of the store's capacity.
 const retained = Number.isInteger(store.capacity) && store.capacity > 0 ? Math.min(retainSettledReceipts, Math.max(1, Math.floor(store.capacity / 10))) : retainSettledReceipts;
 function compact(handle) {
  const done = store.list(handle, 'cost-call').filter(e => (e.status === 'settled' || e.status === 'released') && typeof e.token === 'string');
  if (done.length <= retained) return;
  done.sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)) || a.token.localeCompare(b.token));
  for (const e of done.slice(0, done.length - retained)) {
   const month = String(e.closedAt || e.day.slice(4)).slice(0, 7); const id = 'archive-' + month;
   const archive = read(handle, 'cost-archive', id, () => ({ month, receipts: 0, chargedUsd: 0, chain: '' }));
   const receipt = JSON.stringify([e.token, e.missionId, e.modelId, e.status, e.estimatedUsd, e.chargedUsd || 0, e.day, e.closedAt || null]);
   store.put(handle, 'cost-archive', id, { month, receipts: archive.receipts + 1, chargedUsd: round(archive.chargedUsd + (e.chargedUsd || 0)), chain: createHash('sha256').update(archive.chain + receipt).digest('hex') });
   store.remove(handle, 'cost-call', e.token);
   if (e.keyId) { const index = read(handle, 'cost-key', e.keyId, () => null); if (index && index.token === e.token) store.remove(handle, 'cost-key', e.keyId); }
  }
 }
 // usage: tokens reported by the provider; unknown usage keeps the estimate.
 // Only a claimed call is settled: a reservation that never reached the
 // provider is released through reconcileCall, never charged as a call. A
 // durable receipt makes repeated settlement return the original charge.
 // accepted: the caller's deterministic verifier accepted this answer. The
 // charge and the step's ACCEPTED_FINAL marker are written in this same
 // transaction: there is no state where one exists without the other.
 // Otherwise the receipt says SETTLED_BUT_NOT_ACCEPTED and the step may be
 // tried again (a refused output, a rate limit, a definitive rejection).
 function settle(handle, reservation, usage = {}, { accepted = false } = {}) {
  const entry = read(handle,'cost-call',reservation.token,()=>null);
  if(!entry||entry.day!==reservation.day)fail('reservation_unknown');
  if(entry.status==='settled')return entry.chargedUsd;
  if(entry.status==='reserved')fail('call_not_claimed');
  if(entry.status!=='claimed')reconciliationGate('call_reconciliation_required','call_uncertain');
  const charged = book(handle, reservation.token, entry, usage);
  store.put(handle,'cost-call',reservation.token,{...entry,status:'settled',outcome:accepted===true?'accepted':'not_accepted',chargedUsd:charged,closedAt:now()});
  if (accepted === true) {
   const mission = read(handle, 'cost-mission', entry.missionId, emptyMission);
   mission.steps = { ...(mission.steps || {}), [entry.scope]: { status: ACCEPTED_FINAL, token: reservation.token, modelId: entry.modelId, at: now() } };
   store.put(handle, 'cost-mission', entry.missionId, mission);
  }
  compact(handle);
  return charged;
 }
 // The state of one step (mission + task or phase): ACCEPTED_FINAL,
 // CALL_UNKNOWN (claimed or uncertain: never repeated), SETTLED_BUT_NOT_ACCEPTED
 // (may be tried again), NOT_EXECUTED (released) or NONE.
 function step(handle, { missionId, scopeKey } = {}) {
  if (typeof scopeKey !== 'string' || !/^[A-Za-z0-9:._-]{1,512}$/.test(scopeKey)) fail('reservation_key_invalid');
  const scope = hashId('s-', scopeKey);
  if (acceptedStep(handle, missionId, scope)) return 'ACCEPTED_FINAL';
  const calls = store.list(handle, 'cost-call').filter(e => e.scope === scope);
  if (calls.some(e => OPEN_CALL.includes(e.status))) return 'CALL_UNKNOWN';
  if (calls.some(e => e.status === 'settled')) return 'SETTLED_BUT_NOT_ACCEPTED';
  if (calls.some(e => e.status === 'released')) return 'NOT_EXECUTED';
  return 'NONE';
 }
 // Explicit decision by the owner or a supervisor, with an evidence code, to
 // allow one new attempt of an accepted step. Never reachable from a model.
 function reopenStep(handle, { missionId, scopeKey, decidedBy, evidenceRef } = {}) {
  if (!['owner', 'supervisor'].includes(decidedBy)) fail('reconciliation_authority_required');
  if (typeof evidenceRef !== 'string' || !CODE.test(evidenceRef)) fail('reconciliation_evidence_required');
  if (typeof scopeKey !== 'string' || !/^[A-Za-z0-9:._-]{1,512}$/.test(scopeKey)) fail('reservation_key_invalid');
  const scope = hashId('s-', scopeKey); const marker = acceptedStep(handle, missionId, scope);
  if (!marker) return freeze({ status: 'not_accepted' });
  const mission = read(handle, 'cost-mission', missionId, emptyMission);
  mission.steps = { ...mission.steps, [scope]: { ...marker, status: 'reopened', reopened: { decidedBy, evidenceRef, at: now() } } };
  store.put(handle, 'cost-mission', missionId, mission);
  return freeze({ status: 'reopened' });
 }
 // One sealed entry per model call, inside the mission's own cost record
 // (bounded; beyond MAX_EXECUTIONS only a counter grows). The budget warning
 // is computed here, after settlement; a warning never blocks.
 function recordExecution(handle, execution = {}) {
  const entry = executionEntry(execution); if (!entry.missionId) fail('execution_record_invalid');
  const state = budgetState(handle);
  entry.monthlyWarning = state.monthly ? state.monthly.warning : null;
  entry.providerWarning = entry.provider && Object.hasOwn(state.providers, entry.provider) ? state.providers[entry.provider].warning : null;
  const mission = read(handle, 'cost-mission', entry.missionId, emptyMission); const executions = Array.isArray(mission.executions) ? mission.executions : [];
  if (executions.length < MAX_EXECUTIONS) executions.push(entry); else mission.executionsDropped = (mission.executionsDropped || 0) + 1;
  mission.executions = executions; store.put(handle, 'cost-mission', entry.missionId, mission);
  return freeze(copy(entry));
 }
 // Tool calls are counted per mission and per day; their unit price is not
 // reviewed yet, so they are recorded as calls, never as invented USD.
 function recordTool(handle, missionId, capability) {
  const mission = read(handle, 'cost-mission', missionId, emptyMission); const tool = mission.tools[capability] || { calls: 0, pricing: 'unpriced' };
  mission.tools[capability] = { ...tool, calls: tool.calls + 1 }; store.put(handle, 'cost-mission', missionId, mission);
  const day = read(handle, 'cost', dayId(), emptyDay); day.tools[capability] = (day.tools[capability] || 0) + 1; store.put(handle, 'cost', dayId(), day);
 }
 function mission(handle, missionId) { const value = read(handle, 'cost-mission', missionId, emptyMission); return freeze(copy(value)); }
 function owner(handle) { return freeze(store.list(handle, 'cost').map(({ reservations, ...day }) => ({ ...day, openReservations: Object.keys(reservations || {}).length }))); }
 function claimCall(handle,reservation){
  const entry=read(handle,'cost-call',reservation.token,()=>null);
  if(!entry||entry.day!==reservation.day)fail('reservation_unknown');
  // Another attempt of the step (another process, another model) was accepted meanwhile.
  if(acceptedStep(handle,entry.missionId,entry.scope))acceptedGate('scope_accepted');
  if(entry.status!=='reserved')reconciliationGate('call_reconciliation_required','call_not_reserved');
  if(overcharged(handle))reconciliationGate('ledger_reconciliation_required','overcharge');
  if(scopeBusy(handle,entry.scope,reservation.token))reconciliationGate('call_reconciliation_required','scope_uncertain');
  store.put(handle,'cost-call',reservation.token,{...entry,status:'claimed'});
  return true;
 }
 function markCallUnknown(handle,reservation){
  const entry=read(handle,'cost-call',reservation.token,()=>null);
  if(entry&&entry.status==='call_unknown')return;
  if(!entry||entry.status!=='claimed')reconciliationGate('call_reconciliation_required','call_not_claimed');
  store.put(handle,'cost-call',reservation.token,{...entry,status:'call_unknown'});
 }
 // Explicit reconciliation of one call by the owner or a supervisor, with an
 // evidence reference (a fixed code, never content). Never reachable from a
 // model: the reasoner's spend view does not carry it. Decisions:
 //  charged      - the provider executed it: book the charge (reported usage
 //                 or the estimate); the scope may run again.
 //  not_executed - it never ran or was never billed: release the reservation.
 //  uncertain    - keep it CALL_RECONCILIATION_REQUIRED, its scope blocked.
 // The same decision repeated returns the same result; a different one on a
 // closed call is a conflict.
 function reconcileCall(handle, { token, decision, decidedBy, evidenceRef, usage = {} } = {}) {
  if (!['owner', 'supervisor'].includes(decidedBy)) fail('reconciliation_authority_required');
  if (typeof evidenceRef !== 'string' || !CODE.test(evidenceRef)) fail('reconciliation_evidence_required');
  if (!['charged', 'not_executed', 'uncertain'].includes(decision)) fail('reconciliation_decision_invalid');
  const entry = typeof token === 'string' && /^r-[A-Za-z0-9-]{1,64}$/.test(token) ? read(handle, 'cost-call', token, () => null) : null;
  if (!entry) fail('reservation_unknown');
  const reconciliation = { decision, decidedBy, evidenceRef, at: now() };
  if (entry.status === 'settled' || entry.status === 'released') {
   if (entry.reconciliation && entry.reconciliation.decision === decision) return freeze({ status: entry.status, chargedUsd: entry.chargedUsd || 0 });
   fail('reconciliation_conflict');
  }
  if (decision === 'uncertain') {
   if (entry.status === 'reserved') fail('call_not_claimed');
   store.put(handle, 'cost-call', token, { ...entry, status: 'call_unknown', reconciliation });
   return freeze({ status: 'call_unknown', chargedUsd: 0 });
  }
  if (decision === 'charged') {
   if (entry.status === 'reserved') fail('call_not_claimed');
   const charged = book(handle, token, entry, usage);
   store.put(handle, 'cost-call', token, { ...entry, status: 'settled', chargedUsd: charged, closedAt: now(), reconciliation });
   compact(handle);
   return freeze({ status: 'settled', chargedUsd: charged });
  }
  const day = read(handle, 'cost', entry.day, emptyDay); if (!day.reservations[token]) fail('reservation_unknown');
  delete day.reservations[token]; day.reservedUsd = round(Math.max(0, day.reservedUsd - entry.estimatedUsd)); store.put(handle, 'cost', entry.day, day);
  store.put(handle, 'cost-call', token, { ...entry, status: 'released', chargedUsd: 0, closedAt: now(), reconciliation });
  compact(handle);
  return freeze({ status: 'released', chargedUsd: 0 });
 }
 // An overcharge (actual above estimate) blocks the owner's paid calls until
 // the owner or a supervisor reviews it; the real charge is never removed.
 function clearOvercharge(handle, { decidedBy, evidenceRef } = {}) {
  if (!['owner', 'supervisor'].includes(decidedBy)) fail('reconciliation_authority_required');
  if (typeof evidenceRef !== 'string' || !CODE.test(evidenceRef)) fail('reconciliation_evidence_required');
  const control = read(handle, 'cost-control', 'owner-control', () => ({}));
  if (control.blocked !== true) return freeze({ blocked: false });
  store.put(handle, 'cost-control', 'owner-control', { blocked: false, reason: control.reason, clearedBy: decidedBy, evidenceRef, at: now() });
  return freeze({ blocked: false });
 }
 const api={estimate,reserve,settle,claimCall,markCallUnknown,reconcileCall,clearOvercharge,reopenStep,step,recordTool,recordExecution,budget:budgetState,mission,owner};
 if(!_transaction) for(const name of ['reserve','settle','claimCall','markCallUnknown','reconcileCall','clearOvercharge','reopenStep','recordTool','recordExecution']){
  api[name]=async(handle,...args)=>{
   if(typeof store.transaction!=='function')fail('ledger_transaction_required');
   return store.transaction(handle,tx=>{const timestamp=now();return createCostLedger({store:tx,catalog,policy,budget,now:()=>timestamp,retainSettledReceipts,_transaction:true})[name](handle,...args);});
  };
 }
 return Object.freeze(api);
}
module.exports = { ACCOUNTING_CURRENCY, MAX_EXECUTIONS, createCostLedger, resolveBudget };
