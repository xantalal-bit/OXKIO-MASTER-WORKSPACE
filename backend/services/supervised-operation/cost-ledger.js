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
function createCostLedger({ store, catalog = {}, policy = {}, budget = {}, now = () => new Date().toISOString(), _transaction = false }) {
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
 function reserve(handle, { missionId, modelId, estimatedUsd, approvedDailyBudgetUsd, idempotencyKey }) {
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0 || !Number.isFinite(approvedDailyBudgetUsd) || approvedDailyBudgetUsd <= 0) fail('planning_budget_gate');
  units(estimatedUsd); units(approvedDailyBudgetUsd);
  const key = idempotencyKey || store.newId();
  if (typeof key !== 'string' || !/^[A-Za-z0-9:._-]{1,512}$/.test(key)) fail('reservation_key_invalid');
  const keyId = 'k-' + createHash('sha256').update(key).digest('hex');
  const index = read(handle,'cost-key',keyId,()=>null);
  let token = index ? index.token : 'r-'+store.newId();
  const prior = read(handle,'cost-call',token,()=>null);
  if(prior){if(prior.missionId!==missionId||prior.modelId!==modelId||prior.estimatedUsd!==estimatedUsd)fail('reservation_conflict');if(!prior.retryable)return freeze({token,day:prior.day});token='r-'+store.newId();}
  store.put(handle,'cost-key',keyId,{token});
  if(read(handle,'cost-control','owner-control',()=>({})).blocked)budgetGate('reconciliation_required');
  if(store.list(handle,'cost-call').some(e=>e.status==='call_unknown'))budgetGate('reconciliation_required');
  const period = dayId(); const day = read(handle, 'cost', period, emptyDay); const mission = read(handle, 'cost-mission', missionId, emptyMission);
  const days = store.list(handle,'cost');
  for(const d of days)for(const token of Object.keys(d.reservations||{}))if(!read(handle,'cost-call',token,()=>null))budgetGate('legacy_reconciliation_required');
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
  store.put(handle,'cost-call',token,{...day.reservations[token],day:period,status:'reserved'});
  return freeze({ token, day: period });
 }
 // usage: tokens reported by the provider; unknown usage keeps the estimate.
 // A durable receipt makes repeated settlement return the original charge.
 function settle(handle, reservation, usage = {}) {
  const entry = read(handle,'cost-call',reservation.token,()=>null);
  if(!entry||entry.day!==reservation.day)fail('reservation_unknown');
  if(entry.status==='settled')return entry.chargedUsd;
  const day = read(handle, 'cost', entry.day, emptyDay);
  if(!day.reservations[reservation.token])fail('reservation_unknown');
  for(const k of ['inputTokens','outputTokens'])if(usage[k]!==undefined&&(!Number.isSafeInteger(usage[k])||usage[k]<0))fail('usage_invalid');
  const reported = Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens) ? estimate(entry.modelId, usage) : null;
  const charged = reported === null ? entry.estimatedUsd : Math.max(reported, 0);
  delete day.reservations[reservation.token];
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
  store.put(handle,'cost-call',reservation.token,{...entry,status:'settled',chargedUsd:charged,retryable:usage.definitiveRejection===true});
  if(units(charged)>units(entry.estimatedUsd))store.put(handle,'cost-control','owner-control',{blocked:true,reason:'overcharge'});
  return charged;
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
  if(entry.status!=='reserved')fail('call_reconciliation_required');
  if(read(handle,'cost-control','owner-control',()=>({})).blocked||store.list(handle,'cost-call').some(e=>e.status==='call_unknown'))fail('call_reconciliation_required');
  store.put(handle,'cost-call',reservation.token,{...entry,status:'claimed'});
  return true;
 }
 function markCallUnknown(handle,reservation){
  const entry=read(handle,'cost-call',reservation.token,()=>null);
  if(!entry||entry.status!=='claimed')fail('call_reconciliation_required');
  store.put(handle,'cost-call',reservation.token,{...entry,status:'call_unknown'});
 }
 const api={estimate,reserve,settle,claimCall,markCallUnknown,recordTool,recordExecution,budget:budgetState,mission,owner};
 if(!_transaction) for(const name of ['reserve','settle','claimCall','markCallUnknown','recordTool','recordExecution']){
  api[name]=async(handle,...args)=>{
   if(typeof store.transaction!=='function')fail('ledger_transaction_required');
   return store.transaction(handle,tx=>{const timestamp=now();return createCostLedger({store:tx,catalog,policy,budget,now:()=>timestamp,_transaction:true})[name](handle,...args);});
  };
 }
 return Object.freeze(api);
}
module.exports = { ACCOUNTING_CURRENCY, MAX_EXECUTIONS, createCostLedger, resolveBudget };
