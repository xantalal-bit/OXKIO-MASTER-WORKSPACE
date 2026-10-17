// OXKIO CLIENTE CERO — REGISTRO DE CONTINUIDAD (17/10/2026, Issue #49)
//
// Capa de datos del Project Registry para el canon operativo de Cliente Cero
// (KNOWLEDGE-CURATOR/CLIENT-ZERO/XATAI-CLIENT-ZERO-CANON.md). Una sola fuente:
// orchestration/CONTINUITY-REGISTRY.json, junto a ROADMAP/PROJECTS/TASKS que
// ProjectManagerService ya lee y proyecta al Ecosystem Observer. No hay motor,
// scheduler ni base nueva: funciones puras y deterministas, y la persistencia
// es el propio repositorio (versionado, auditable desde GitHub por Xatai).
//
// Reglas del canon que aplica este módulo:
// - preflight antes de planificar: recupera canon y estado, clasifica el frente;
// - CLOSED no se reabre sin evidencia material nueva (ref no conocida, posterior
//   a toda la evidencia del frente y contradictoria);
// - la evidencia más reciente prevalece y la discrepancia queda como defecto de
//   continuidad;
// - deduplicación por identificador, alias y ref de evidencia;
// - una autorización consolidada no se vuelve a pedir; las puertas humanas solo
//   las abre una autorización con alcance exacto, nunca una permanente;
// - P0/P1 → PENDING, P2/P3 → BACKLOG;
// - CLOSED exige PR mergeada + CI verde (+ prueba real cuando aplica), más
//   recientes que cualquier evidencia contradictoria.

"use strict";

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const ROOT = path.join(__dirname, "../..");
const REGISTRY_PATH = path.join(ROOT, "orchestration", "CONTINUITY-REGISTRY.json");
const CANON_PATH = path.join(ROOT, "KNOWLEDGE-CURATOR", "CLIENT-ZERO", "XATAI-CLIENT-ZERO-CANON.md");
const SCHEMA = "oxkio.continuity-registry/v1";

const STATES = Object.freeze(["CLOSED", "PENDING", "BLOCKED", "BACKLOG"]);
const PRIORITIES = Object.freeze(["P0", "P1", "P2", "P3"]);
const CONFIDENCE = Object.freeze(["high", "medium", "low"]);
const EVIDENCE_KINDS = Object.freeze([
  "pr_merged", "ci_green", "real_test", "commit", "human_decision", "observation",
  "ci_failure", "test_failure", "regression", "defect",
]);
const CONTRADICTING = new Set(["ci_failure", "test_failure", "regression", "defect"]);
const RESULTS = Object.freeze(["success", "failure", "info"]);
const EVENT_TYPES = Object.freeze([
  "created", "merged_duplicate", "evidence_added", "superseded_evidence", "continuity_defect",
  "reopened_by_evidence", "reopen_refused", "state_changed", "closed", "human_decision",
  "automation_run", "preflight", "daily_report",
]);

const ID = /^CZ-[A-Z0-9-]{2,60}$/;
// CI job names carry spaces and parentheses ("backend-tests (node 22)").
const REF = /^[A-Za-z0-9:_.#@/()-][A-Za-z0-9:_.#@/() -]{0,159}$/;
const AUTH_ID = /^AUTH-[A-Z0-9-]{2,60}$/;
const ACTION = /^[a-z][a-z0-9_]{1,40}$/;
const MAX_TEXT = 600;

function fail(code, details) {
  const error = new Error(details ? `${code}: ${details}` : code);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT;
}

function time(value) {
  return Date.parse(value);
}

function contradicts(evidence) {
  return CONTRADICTING.has(evidence.kind) || evidence.result === "failure";
}

// Latest moment any evidence of the front was observed.
function latestEvidenceAt(entry) {
  return entry.evidence.reduce((latest, item) => Math.max(latest, time(item.observedAt)), 0);
}

function latestContradictionAt(entry) {
  return entry.evidence.filter(contradicts).reduce((latest, item) => Math.max(latest, time(item.observedAt)), 0);
}

const PROOF_KINDS = new Set(["ci_green", "real_test"]);

// Latest proof that keeps a front CLOSED (green CI or a real test).
function latestProofAt(entry) {
  return entry.evidence
    .filter((item) => PROOF_KINDS.has(item.kind) && item.result === "success")
    .reduce((latest, item) => Math.max(latest, time(item.observedAt)), 0);
}

// Kinds still missing for CLOSED. The merge is a one-time fact; green CI and
// the real test (when it applies) must be newer than the most recent
// contradicting evidence of the same front.
function closureGaps(entry) {
  const after = latestContradictionAt(entry);
  const gaps = entry.evidence.some((item) => item.kind === "pr_merged" && item.result === "success") ? [] : ["pr_merged"];
  ["ci_green", ...(entry.requiresRealTest ? ["real_test"] : [])].forEach((kind) => {
    if (!entry.evidence.some((item) => item.kind === kind && item.result === "success" && time(item.observedAt) > after)) gaps.push(kind);
  });
  return gaps;
}

function validateEvidence(item, where, errors) {
  if (!item || typeof item !== "object") return errors.push(`${where}: evidence must be an object`);
  if (typeof item.ref !== "string" || !REF.test(item.ref)) errors.push(`${where}: invalid ref`);
  if (!EVIDENCE_KINDS.includes(item.kind)) errors.push(`${where}: invalid kind ${item.kind}`);
  if (!RESULTS.includes(item.result)) errors.push(`${where}: invalid result`);
  if (!validDate(item.observedAt)) errors.push(`${where}: invalid observedAt`);
  if (!text(item.source)) errors.push(`${where}: source required`);
  if (!text(item.summary)) errors.push(`${where}: summary required`);
  return undefined;
}

function validateRegistry(data) {
  const errors = [];
  if (!data || typeof data !== "object") fail("registry_invalid", "not an object");
  if (data.schema !== SCHEMA) errors.push("schema mismatch");
  if (!Number.isInteger(data.revision) || data.revision < 0) errors.push("revision must be a non-negative integer");
  if (!validDate(data.updatedAt)) errors.push("updatedAt invalid");
  if (!data.canon || typeof data.canon.path !== "string") errors.push("canon.path required");
  if (!Array.isArray(data.entries)) errors.push("entries must be an array");
  if (!Array.isArray(data.authorizations)) errors.push("authorizations must be an array");
  if (!Array.isArray(data.humanGates) || data.humanGates.some((gate) => !ACTION.test(gate))) errors.push("humanGates invalid");
  if (!Array.isArray(data.events)) errors.push("events must be an array");
  if (errors.length) fail("registry_invalid", errors.join("; "));

  const ids = new Set();
  const phrases = new Map();
  data.entries.forEach((entry, index) => {
    const where = `entries[${index}]`;
    if (!entry || typeof entry !== "object") return errors.push(`${where}: must be an object`);
    if (typeof entry.id !== "string" || !ID.test(entry.id)) errors.push(`${where}: invalid id`);
    if (ids.has(entry.id)) errors.push(`${where}: duplicate id ${entry.id}`);
    ids.add(entry.id);
    ["project", "scope", "title", "decision", "reopenCondition", "nextAction", "changes"].forEach((field) => {
      if (!text(entry[field])) errors.push(`${where}: ${field} required`);
    });
    if (!STATES.includes(entry.state)) errors.push(`${where}: invalid state`);
    if (!PRIORITIES.includes(entry.priority)) errors.push(`${where}: invalid priority`);
    if (!CONFIDENCE.includes(entry.confidence)) errors.push(`${where}: invalid confidence`);
    if (!validDate(entry.updatedAt)) errors.push(`${where}: invalid updatedAt`);
    if (!Number.isInteger(entry.version) || entry.version < 1) errors.push(`${where}: invalid version`);
    if (entry.state === "BLOCKED" && !text(entry.blockedBy)) errors.push(`${where}: BLOCKED requires blockedBy`);
    if (!Array.isArray(entry.aliases)) errors.push(`${where}: aliases must be an array`);
    if (!Array.isArray(entry.evidence)) return errors.push(`${where}: evidence must be an array`);
    const refs = new Set();
    entry.evidence.forEach((item, i) => {
      validateEvidence(item, `${where}.evidence[${i}]`, errors);
      if (item && refs.has(item.ref)) errors.push(`${where}: duplicate evidence ref ${item.ref}`);
      if (item) refs.add(item.ref);
    });
    // Deduplication invariant: one phrase (title or alias) names one front.
    [entry.title, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].forEach((phrase) => {
      const key = normalize(phrase);
      if (!key) return errors.push(`${where}: empty alias`);
      if (phrases.has(key) && phrases.get(key) !== entry.id) errors.push(`${where}: alias "${phrase}" already names ${phrases.get(key)}`);
      phrases.set(key, entry.id);
    });
    if (entry.state === "CLOSED" && Array.isArray(entry.evidence) && errors.length === 0) {
      const gaps = closureGaps(entry);
      if (gaps.length) errors.push(`${where}: CLOSED without ${gaps.join(", ")}`);
    }
    return undefined;
  });

  const authIds = new Set();
  data.authorizations.forEach((auth, index) => {
    const where = `authorizations[${index}]`;
    if (!auth || typeof auth.id !== "string" || !AUTH_ID.test(auth.id)) return errors.push(`${where}: invalid id`);
    if (authIds.has(auth.id)) errors.push(`${where}: duplicate id`);
    authIds.add(auth.id);
    if (!Array.isArray(auth.actions) || auth.actions.length === 0 || auth.actions.some((a) => !ACTION.test(a))) errors.push(`${where}: invalid actions`);
    if (typeof auth.standing !== "boolean") errors.push(`${where}: standing must be boolean`);
    if (auth.scope !== undefined && (typeof auth.scope !== "object" || auth.scope === null || Array.isArray(auth.scope))) errors.push(`${where}: scope must be an object`);
    if (!text(auth.grantedBy) || !validDate(auth.grantedAt) || !text(auth.source)) errors.push(`${where}: grantedBy/grantedAt/source required`);
    if (auth.expiresAt !== null && auth.expiresAt !== undefined && !validDate(auth.expiresAt)) errors.push(`${where}: invalid expiresAt`);
    return undefined;
  });

  data.events.forEach((event, index) => {
    if (!event || !EVENT_TYPES.includes(event.type) || !validDate(event.at)) errors.push(`events[${index}]: invalid event`);
  });

  if (errors.length) fail("registry_invalid", errors.join("; "));
  return deepFreeze(clone(data));
}

function loadRegistry(registryPath = REGISTRY_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch (error) {
    fail("registry_missing", path.basename(registryPath));
  }
  let data;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (error) {
    fail("registry_invalid", "not valid JSON");
  }
  return validateRegistry(data);
}

// Validated before anything touches the disk; temp + rename, never a torn file.
function saveRegistry(registry, registryPath = REGISTRY_PATH) {
  const valid = validateRegistry(registry);
  const temp = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  fs.renameSync(temp, registryPath);
  return valid;
}

// The canon is consumed, not assumed: without it there is no preflight.
function loadCanon(canonPath = CANON_PATH) {
  let content;
  try {
    content = fs.readFileSync(canonPath, "utf8");
  } catch (error) {
    fail("canon_missing", path.basename(canonPath));
  }
  const section = content.split(/^## Preflight de continuidad obligatorio\s*$/m)[1] || "";
  const rules = (section.split(/^## /m)[0].match(/^\d+\.\s+.+$/gm) || []).map((line) => line.replace(/^\d+\.\s+/, "").trim());
  if (rules.length === 0) fail("canon_invalid", "preflight rules not found");
  return deepFreeze({
    path: path.relative(ROOT, canonPath).split(path.sep).join("/"),
    sha256: createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex"),
    rules,
  });
}

function phrasesOf(entry) {
  return [entry.id, entry.title, ...entry.aliases].map(normalize).filter(Boolean);
}

function matchEntries(registry, query) {
  const haystack = ` ${normalize(query)} `;
  if (haystack.trim() === "") return [];
  return registry.entries.filter((entry) => phrasesOf(entry).some((phrase) => haystack.includes(` ${phrase} `)));
}

function findEntry(registry, id) {
  return registry.entries.find((entry) => entry.id === id) || null;
}

function expired(auth, now) {
  return auth.expiresAt ? time(auth.expiresAt) <= time(now) : false;
}

function scopeMatches(authScope, context) {
  return Object.entries(authScope || {}).every(([key, value]) => context && context[key] === value);
}

// A consolidated authorization is never asked again. A human gate (merge,
// deploy, production, secrets...) is opened only by a scoped, non-standing
// authorization for exactly that scope; a standing one never opens a gate.
function authorizationFor(registry, action, context = {}, now = new Date().toISOString()) {
  const gate = registry.humanGates.includes(action);
  const match = registry.authorizations.find((auth) => auth.actions.includes(action)
    && !expired(auth, now)
    && auth.consumed !== true
    && scopeMatches(auth.scope, context)
    && (!gate || (auth.standing === false && Object.keys(auth.scope || {}).length > 0)));
  if (match) return deepFreeze({ action, status: "GRANTED", authorizationId: match.id, source: match.source });
  return deepFreeze({ action, status: gate ? "HUMAN_GATE" : "NOT_GRANTED", authorizationId: null, source: null });
}

function classifyGap(priority) {
  if (!PRIORITIES.includes(priority)) fail("priority_invalid", String(priority));
  return priority === "P0" || priority === "P1" ? "PENDING" : "BACKLOG";
}

function frontView(entry) {
  return {
    id: entry.id,
    title: entry.title,
    state: entry.state,
    priority: entry.priority,
    decision: entry.decision,
    nextAction: entry.nextAction,
    reopenCondition: entry.reopenCondition,
    confidence: entry.confidence,
    blockedBy: entry.blockedBy || null,
    updatedAt: entry.updatedAt,
    evidence: entry.evidence.slice(-4).map((item) => ({ ref: item.ref, kind: item.kind, result: item.result, observedAt: item.observedAt })),
  };
}

// Material evidence for reopening a CLOSED front: unknown ref, contradicting
// it, and observed after the latest proof that keeps it CLOSED. A declaration
// is not proof: a front declared CLOSED later still yields to a newer failure.
function isMaterial(entry, item) {
  return Boolean(item && typeof item.ref === "string"
    && !entry.evidence.some((known) => known.ref === item.ref)
    && validDate(item.observedAt) && time(item.observedAt) > latestProofAt(entry)
    && contradicts(item));
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

// PREFLIGHT DE CONTINUIDAD: runs before any plan. Returns what OXKIO already
// knows, refuses reopening CLOSED fronts without material evidence, resolves
// requested actions against consolidated authorizations and human gates.
function preflight({ registry, canon, mission = "", workOn = [], evidence = [], actions = [], context = {}, now = new Date().toISOString() } = {}) {
  if (!registry) fail("registry_required");
  if (!canon || typeof canon.sha256 !== "string") fail("canon_required");
  const mentioned = matchEntries(registry, [mission, ...workOn].join(" \n "));
  const targets = [];
  const unknownTopics = [];
  workOn.forEach((topic) => {
    const found = matchEntries(registry, topic);
    if (found.length === 0) unknownTopics.push(topic);
    found.forEach((entry) => { if (!targets.includes(entry)) targets.push(entry); });
  });
  const refusals = [];
  const reopenable = [];
  targets.filter((entry) => entry.state === "CLOSED").forEach((entry) => {
    const material = evidence.filter((item) => (!item.entry || item.entry === entry.id) && isMaterial(entry, item));
    if (material.length) reopenable.push({ id: entry.id, evidence: material.map((item) => item.ref) });
    else refusals.push({ id: entry.id, reason: "closed_without_new_material_evidence", reopenCondition: entry.reopenCondition });
  });
  const verdict = refusals.length ? "REFUSE_REOPEN" : workOn.length && targets.length === 0 ? "UNKNOWN_TOPIC" : "PROCEED";
  const authorizations = actions.map((action) => authorizationFor(registry, action, context, now));
  const event = {
    type: "preflight",
    at: now,
    missionDigest: digest(mission),
    targets: targets.map((entry) => entry.id),
    verdict,
    canonSha256: canon.sha256,
  };
  return deepFreeze({
    canon: { path: canon.path, sha256: canon.sha256, rules: canon.rules.length },
    registryRevision: registry.revision,
    known: mentioned.length > 0,
    verdict,
    fronts: mentioned.map(frontView),
    targets: targets.map((entry) => entry.id),
    unknownTopics,
    refusals,
    reopenable,
    authorizations: {
      granted: authorizations.filter((a) => a.status === "GRANTED"),
      humanGate: authorizations.filter((a) => a.status === "HUMAN_GATE").map((a) => a.action),
      notGranted: authorizations.filter((a) => a.status === "NOT_GRANTED").map((a) => a.action),
    },
    backlog: mentioned.filter((entry) => entry.state === "BACKLOG").map((entry) => entry.id),
    event,
  });
}

function bump(next, now) {
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

function touch(entry, now, changes) {
  entry.version += 1;
  entry.updatedAt = now;
  if (changes) entry.changes = changes;
}

// Newest evidence wins. A newer contradiction reopens CLOSED as PENDING and is
// recorded as a continuity defect; an older one is kept as superseded history;
// a known ref is a duplicate and changes nothing.
function reconcile({ registry, observations = [], now = new Date().toISOString() } = {}) {
  const next = clone(registry);
  const changes = [];
  observations.forEach((item) => {
    const entry = next.entries.find((candidate) => candidate.id === item.entry);
    if (!entry) return changes.push({ type: "unmatched", ref: item.ref });
    if (entry.evidence.some((known) => known.ref === item.ref)) return changes.push({ type: "duplicate", entry: entry.id, ref: item.ref });
    const errors = [];
    validateEvidence(item, item.ref || "observation", errors);
    if (errors.length) fail("evidence_invalid", errors.join("; "));
    const evidence = { ref: item.ref, kind: item.kind, result: item.result, observedAt: item.observedAt, source: item.source, summary: item.summary };
    const material = entry.state === "CLOSED" && isMaterial(entry, item);
    // Older than what the front already knows, or a contradiction a newer
    // proof already outweighs: kept as history, without effect on state.
    const superseded = !material && ((entry.state === "CLOSED" && contradicts(item))
      || time(item.observedAt) <= latestEvidenceAt(entry));
    entry.evidence.push(evidence);
    if (material) {
      const from = entry.state;
      entry.state = classifyGap(entry.priority) === "PENDING" ? "PENDING" : "BACKLOG";
      touch(entry, now, `Reabierto por evidencia más reciente ${item.ref}: ${item.summary}`);
      next.events.push({ type: "continuity_defect", at: now, entry: entry.id, ref: item.ref, note: "CLOSED contradicho por evidencia más reciente" });
      next.events.push({ type: "reopened_by_evidence", at: now, entry: entry.id, from, to: entry.state, ref: item.ref });
      return changes.push({ type: "reopened", entry: entry.id, from, to: entry.state, ref: item.ref });
    }
    if (superseded) {
      touch(entry, now);
      next.events.push({ type: "superseded_evidence", at: now, entry: entry.id, ref: item.ref });
      return changes.push({ type: "superseded", entry: entry.id, ref: item.ref });
    }
    touch(entry, now);
    next.events.push({ type: "evidence_added", at: now, entry: entry.id, ref: item.ref });
    const closable = entry.state !== "CLOSED" && closureGaps(entry).length === 0;
    return changes.push({ type: closable ? "closable" : "evidence_added", entry: entry.id, ref: item.ref });
  });
  if (changes.some((change) => !["duplicate", "unmatched"].includes(change.type))) bump(next, now);
  return { registry: validateRegistry(next), changes: deepFreeze(changes) };
}

function addEvidence(entry, items) {
  items.forEach((item) => {
    const errors = [];
    validateEvidence(item, item.ref || "evidence", errors);
    if (errors.length) fail("evidence_invalid", errors.join("; "));
    if (!entry.evidence.some((known) => known.ref === item.ref)) {
      entry.evidence.push({ ref: item.ref, kind: item.kind, result: item.result, observedAt: item.observedAt, source: item.source, summary: item.summary });
    }
  });
}

// CLOSED only with the canonical criteria; otherwise the front stays open and
// the missing kinds are reported.
function close({ registry, id, evidence = [], decision, nextAction, now = new Date().toISOString() } = {}) {
  const next = clone(registry);
  const entry = next.entries.find((candidate) => candidate.id === id);
  if (!entry) fail("entry_not_found", id);
  addEvidence(entry, evidence);
  const gaps = closureGaps(entry);
  if (gaps.length) fail("closure_criteria_missing", gaps.join(","));
  const from = entry.state;
  entry.state = "CLOSED";
  delete entry.blockedBy;
  if (decision) entry.decision = decision;
  if (nextAction) entry.nextAction = nextAction;
  touch(entry, now, `Cerrado con ${entry.evidence.slice(-3).map((item) => item.ref).join(", ")}`);
  next.events.push({ type: "closed", at: now, entry: id, from, to: "CLOSED" });
  return validateRegistry(bump(next, now));
}

// PENDING / BLOCKED / BACKLOG moves. Leaving CLOSED is only possible through
// reconcile() with material evidence; entering CLOSED only through close().
function transition({ registry, id, state, blockedBy, nextAction, note, evidence = [], now = new Date().toISOString() } = {}) {
  const next = clone(registry);
  const entry = next.entries.find((candidate) => candidate.id === id);
  if (!entry) fail("entry_not_found", id);
  if (!["PENDING", "BLOCKED", "BACKLOG"].includes(state)) fail("transition_invalid", String(state));
  if (entry.state === "CLOSED") fail("closed_requires_material_evidence", id);
  addEvidence(entry, evidence);
  const from = entry.state;
  entry.state = state;
  if (state === "BLOCKED") {
    if (!text(blockedBy)) fail("blocked_requires_reason", id);
    entry.blockedBy = blockedBy;
  } else {
    delete entry.blockedBy;
  }
  if (nextAction) entry.nextAction = nextAction;
  touch(entry, now, note || `${from} → ${state}`);
  next.events.push({ type: "state_changed", at: now, entry: id, from, to: state, ...(note ? { note } : {}) });
  return validateRegistry(bump(next, now));
}

// A front that already exists (same id, title or alias) is merged, never
// duplicated: aliases and evidence are united; its state is not overwritten.
function upsert({ registry, entry: input, now = new Date().toISOString() } = {}) {
  const next = clone(registry);
  const phrases = [input.id, input.title, ...(input.aliases || [])].map(normalize).filter(Boolean);
  const existing = next.entries.find((entry) => entry.id === input.id
    || phrasesOf(entry).some((phrase) => phrases.includes(phrase)));
  if (existing) {
    const known = new Set(existing.aliases.map(normalize));
    (input.aliases || []).forEach((alias) => {
      if (!known.has(normalize(alias)) && normalize(alias) !== normalize(existing.title)) existing.aliases.push(alias);
    });
    addEvidence(existing, input.evidence || []);
    touch(existing, now);
    next.events.push({ type: "merged_duplicate", at: now, entry: existing.id, ...(input.id && input.id !== existing.id ? { duplicateId: input.id } : {}) });
    return { registry: validateRegistry(bump(next, now)), id: existing.id, merged: true };
  }
  const state = input.state || classifyGap(input.priority);
  if (state === "CLOSED") fail("closed_requires_close", input.id);
  next.entries.push({
    aliases: [],
    evidence: [],
    ...clone(input),
    state,
    version: 1,
    updatedAt: now,
  });
  next.events.push({ type: "created", at: now, entry: input.id, to: state });
  return { registry: validateRegistry(bump(next, now)), id: input.id, merged: false };
}

function recordEvent({ registry, event, now = new Date().toISOString() } = {}) {
  const next = clone(registry);
  next.events.push({ ...clone(event), at: event.at || now });
  return validateRegistry(bump(next, now));
}

// OXKIO's automation over GitHub CI: each job of a run on main becomes
// evidence for the fronts that declare that job as a signal.
function observationsFromRuns(registry, runs) {
  const observations = [];
  runs.forEach((run) => {
    (run.jobs || []).forEach((job) => {
      if (!["success", "failure"].includes(job.conclusion)) return;
      registry.entries.filter((entry) => Array.isArray(entry.signals) && entry.signals.includes(job.name)).forEach((entry) => {
        observations.push({
          entry: entry.id,
          ref: `ci:${run.id}#${job.name}`,
          kind: job.conclusion === "success" ? "ci_green" : "ci_failure",
          result: job.conclusion,
          observedAt: job.completedAt || run.updatedAt,
          source: `github-actions:${run.branch}@${String(run.sha).slice(0, 7)}`,
          summary: `${job.name} ${job.conclusion} en ${run.event} ${run.branch} @ ${String(run.sha).slice(0, 7)}`,
        });
      });
    });
  });
  return observations;
}

// Audit of CLOSED fronts against an independent source (GitHub PR facts):
// every pr_merged evidence must name a PR that is MERGED at that commit.
function auditClosures(registry, prFacts) {
  const findings = [];
  registry.entries.filter((entry) => entry.state === "CLOSED").forEach((entry) => {
    entry.evidence.filter((item) => item.kind === "pr_merged").forEach((item) => {
      const number = (item.ref.match(/^pr:(\d+)$/) || [])[1];
      const fact = number ? prFacts[number] : null;
      const sha = (item.summary.match(/\b[0-9a-f]{7,40}\b/) || [])[0];
      if (!fact) findings.push({ entry: entry.id, ref: item.ref, status: "unverified" });
      else if (fact.state !== "MERGED") findings.push({ entry: entry.id, ref: item.ref, status: "contradicted", detail: `state ${fact.state}` });
      else if (sha && !String(fact.mergeCommit || "").startsWith(sha)) findings.push({ entry: entry.id, ref: item.ref, status: "contradicted", detail: `merge ${String(fact.mergeCommit).slice(0, 7)}` });
      else findings.push({ entry: entry.id, ref: item.ref, status: "verified" });
    });
  });
  return deepFreeze(findings);
}

function byPriority(a, b) {
  return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.id.localeCompare(b.id);
}

function nextAction(registry) {
  const open = registry.entries.filter((entry) => entry.state === "PENDING" || entry.state === "BLOCKED").sort(byPriority);
  return open[0] ? { id: open[0].id, state: open[0].state, action: open[0].nextAction } : null;
}

const EVENT_LABELS = {
  created: "alta", merged_duplicate: "duplicado fusionado", evidence_added: "evidencia",
  superseded_evidence: "evidencia antigua (sin efecto)", continuity_defect: "DEFECTO DE CONTINUIDAD",
  reopened_by_evidence: "reabierto por evidencia", reopen_refused: "reapertura rechazada",
  state_changed: "cambio de estado", closed: "cerrado", human_decision: "decisión humana",
  automation_run: "automatización", preflight: "preflight", daily_report: "parte diario",
};

function describeEvent(event) {
  const parts = [EVENT_LABELS[event.type] || event.type];
  if (event.entry) parts.push(event.entry);
  if (event.from || event.to) parts.push(`${event.from || "∅"} → ${event.to || "∅"}`);
  if (event.ref) parts.push(event.ref);
  if (event.name) parts.push(event.name);
  if (event.result) parts.push(`resultado: ${event.result}`);
  if (event.verdict) parts.push(`veredicto: ${event.verdict}`);
  if (event.note) parts.push(event.note);
  return parts.join(" · ");
}

// PARTE DIARIO generated from OXKIO's own registry, for Xatai to audit and
// deliver. It states its source and what must be checked independently.
function buildDailyReport({ registry, date, since, now = new Date().toISOString() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fail("date_invalid", String(date));
  const from = since || `${date}T00:00:00.000Z`;
  const events = registry.events.filter((event) => time(event.at) >= time(from) && event.type !== "daily_report");
  const list = (items, render, empty = "- (ninguno)") => (items.length ? items.map(render).join("\n") : empty);
  const entries = [...registry.entries].sort(byPriority);
  const of = (state) => entries.filter((entry) => entry.state === state);
  const evidenceSince = registry.entries.flatMap((entry) => entry.evidence
    .filter((item) => time(item.observedAt) >= time(from))
    .map((item) => ({ entry: entry.id, ...item })));
  const next = nextAction(registry);
  const toAudit = [...new Set(registry.entries.flatMap((entry) => entry.evidence
    .filter((item) => /^(pr|ci):/.test(item.ref)).map((item) => item.ref)))].sort();
  const markdown = [
    `# Parte Diario OXKIO — ${date}`,
    "",
    `Fuente primaria: OXKIO · registro de continuidad \`orchestration/CONTINUITY-REGISTRY.json\` (revisión ${registry.revision}, actualizado ${registry.updatedAt}).`,
    `Canon: \`${registry.canon.path}\`. Generado: ${now}. Ventana: desde ${from}.`,
    "Auditor: Xatai contrasta este parte con GitHub/CI (sección «Para auditar») antes de entregarlo a José Antonio.",
    "",
    "## Cambios materiales",
    list(events.filter((event) => event.type !== "preflight" && event.type !== "automation_run"), (event) => `- ${event.at} · ${describeEvent(event)}`),
    "",
    "## Hitos cerrados (CLOSED)",
    list(of("CLOSED"), (entry) => `- **${entry.id}** ${entry.title} — ${entry.decision} Evidencia: ${entry.evidence.filter((item) => !contradicts(item)).slice(-3).map((item) => item.ref).join(", ")}.`),
    "",
    "## Pendientes (PENDING)",
    list(of("PENDING"), (entry) => `- **${entry.id}** [${entry.priority}] ${entry.title} — siguiente: ${entry.nextAction}`),
    "",
    "## Bloqueos (BLOCKED)",
    list(of("BLOCKED"), (entry) => `- **${entry.id}** [${entry.priority}] ${entry.title} — bloqueado por: ${entry.blockedBy}. Siguiente: ${entry.nextAction}`),
    "",
    "## Backlog (no bloqueante)",
    list(of("BACKLOG"), (entry) => `- **${entry.id}** [${entry.priority}] ${entry.title}`),
    "",
    "## Decisiones humanas reales",
    list(events.filter((event) => event.type === "human_decision"), (event) => `- ${event.at} · ${event.by || "José Antonio"}: ${event.note}`, "- (ninguna registrada en la ventana)"),
    "",
    "## Automatizaciones ejecutadas",
    list(events.filter((event) => event.type === "automation_run" || event.type === "preflight"), (event) => `- ${event.at} · ${describeEvent(event)}`),
    "",
    "## Evidencia nueva",
    list(evidenceSince, (item) => `- ${item.entry} · ${item.kind}/${item.result} · ${item.ref} — ${item.summary}`),
    "",
    "## Siguiente acción",
    next ? `- ${next.id} (${next.state}): ${next.action}` : "- (sin frentes abiertos)",
    "",
    "## Para auditar (Xatai)",
    list(toAudit, (ref) => `- ${ref}`),
    "",
  ].join("\n");
  return deepFreeze({
    markdown,
    summary: {
      date,
      since: from,
      revision: registry.revision,
      counts: Object.fromEntries(STATES.map((state) => [state, of(state).length])),
      changes: events.length,
      nextAction: next,
    },
  });
}

// Read-only projection for ProjectManagerService → Ecosystem Observer. Never
// throws: a missing or invalid registry is reported, not hidden.
function getContinuityView(registryPath = REGISTRY_PATH) {
  let registry;
  try {
    registry = loadRegistry(registryPath);
  } catch (error) {
    return deepFreeze({ available: false, reason: error.code || "registry_unavailable", revision: null, updatedAt: null, counts: {}, open: [], nextAction: null });
  }
  const open = registry.entries.filter((entry) => entry.state === "PENDING" || entry.state === "BLOCKED").sort(byPriority);
  return deepFreeze({
    available: true,
    reason: null,
    revision: registry.revision,
    updatedAt: registry.updatedAt,
    counts: Object.fromEntries(STATES.map((state) => [state, registry.entries.filter((entry) => entry.state === state).length])),
    open: open.slice(0, 5).map((entry) => ({ id: entry.id, title: entry.title, state: entry.state, priority: entry.priority, nextAction: entry.nextAction })),
    nextAction: nextAction(registry),
  });
}

module.exports = {
  CANON_PATH,
  REGISTRY_PATH,
  SCHEMA,
  STATES,
  auditClosures,
  authorizationFor,
  buildDailyReport,
  classifyGap,
  close,
  closureGaps,
  findEntry,
  getContinuityView,
  loadCanon,
  loadRegistry,
  matchEntries,
  observationsFromRuns,
  preflight,
  reconcile,
  recordEvent,
  saveRegistry,
  transition,
  upsert,
  validateRegistry,
};
