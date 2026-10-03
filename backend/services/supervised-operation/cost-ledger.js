'use strict';
const { selectExecutionLevel, normalizePolicy, LEVELS } = require('../runtime/cost-policy');
const { normalizeCatalog, estimateCatalogCostUsd } = require('../runtime/model-cost-catalog');
const { copy, freeze, fail } = require('./scope-session');
// V3 cost accounting reuses the canonical cost policy and the reviewed model
// catalog; the Executive Chat CostController stays with its single owner.
// Every figure lives in the owner's scoped (sealed) store, so budgets survive
// a restart and one owner's spend can never be read or charged by another.
// A reservation is written before the paid call and settled after it: a crash
// in between keeps the reservation counted (never under-counts spend).
const round = value => Number(value.toFixed(8));
function createCostLedger({ store, catalog = {}, policy = {}, now = () => new Date().toISOString() }) {
 const reviewed = normalizeCatalog(catalog); const rules = normalizePolicy(policy);
 const dayId = () => 'day-' + now().slice(0, 10);
 const read = (handle, kind, id, empty) => { try { return store.get(handle, kind, id); } catch (error) { if (error.code === 'resource_not_found') return empty(); throw error; } };
 const emptyDay = () => ({ date: now().slice(0, 10), reservedUsd: 0, chargedUsd: 0, knownActualUsd: 0, calls: 0, tokens: 0, models: {}, tools: {}, reservations: {} });
 const emptyMission = () => ({ chargedUsd: 0, models: {}, tools: {} });
 function estimate(modelId, { inputTokens, outputTokens }) {
  const usd = estimateCatalogCostUsd(reviewed, modelId, { inputTokens, outputTokens });
  return Number.isFinite(usd) ? usd : null;
 }
 function reserve(handle, { missionId, modelId, estimatedUsd, approvedDailyBudgetUsd }) {
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0 || !Number.isFinite(approvedDailyBudgetUsd) || approvedDailyBudgetUsd <= 0) fail('planning_budget_gate');
  const day = read(handle, 'cost', dayId(), emptyDay); const mission = read(handle, 'cost-mission', missionId, emptyMission);
  const decision = selectExecutionLevel({
   deterministicAvailable: false, smallModelSufficient: true, smallModelEstimatedCostUsd: estimatedUsd,
   missionSpentUsd: mission.chargedUsd, dailySpentUsd: day.chargedUsd + day.reservedUsd,
  }, { ...rules, dailyBudgetUsd: Math.min(rules.dailyBudgetUsd, approvedDailyBudgetUsd) });
  if (decision.level !== LEVELS.SMALL_MODEL) fail('planning_budget_gate');
  const token = 'r-' + store.newId();
  day.reservedUsd = round(day.reservedUsd + estimatedUsd); day.reservations[token] = { missionId, modelId, estimatedUsd };
  store.put(handle, 'cost', dayId(), day);
  return freeze({ token, day: dayId() });
 }
 // usage: tokens reported by the provider; unknown usage keeps the estimate.
 function settle(handle, reservation, usage = {}) {
  const day = read(handle, 'cost', reservation.day, emptyDay); const entry = day.reservations[reservation.token];
  if (!entry) fail('reservation_unknown');
  const reported = Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens) ? estimate(entry.modelId, usage) : null;
  const charged = reported === null ? entry.estimatedUsd : Math.max(reported, 0);
  delete day.reservations[reservation.token];
  day.reservedUsd = round(Math.max(0, day.reservedUsd - entry.estimatedUsd)); day.chargedUsd = round(day.chargedUsd + charged); day.calls += 1;
  if (reported !== null) { day.knownActualUsd = round(day.knownActualUsd + reported); day.tokens += usage.inputTokens + usage.outputTokens; }
  const model = day.models[entry.modelId] || { calls: 0, usd: 0 }; day.models[entry.modelId] = { calls: model.calls + 1, usd: round(model.usd + charged) };
  store.put(handle, 'cost', reservation.day, day);
  const mission = read(handle, 'cost-mission', entry.missionId, emptyMission); const mm = mission.models[entry.modelId] || { calls: 0, usd: 0 };
  mission.models[entry.modelId] = { calls: mm.calls + 1, usd: round(mm.usd + charged) }; mission.chargedUsd = round(mission.chargedUsd + charged);
  store.put(handle, 'cost-mission', entry.missionId, mission);
  return charged;
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
 return Object.freeze({ estimate, reserve, settle, recordTool, mission, owner });
}
module.exports = { createCostLedger };
