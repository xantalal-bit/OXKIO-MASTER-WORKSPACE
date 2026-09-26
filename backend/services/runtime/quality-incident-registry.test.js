'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  AUTO_REPAIR_KINDS,
  DEFAULT_PRIORITY,
  INCIDENT_TYPES,
  PRIORITIES,
  STATUSES,
  QualityIncidentRegistry,
  formatQualitySummary,
} = require('./quality-incident-registry');

function createClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 26, 10, 0, tick++)).toISOString();
}

function createRegistry(options = {}) {
  return new QualityIncidentRegistry({ now: createClock(), ...options });
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

const GMAIL_FAILURE = Object.freeze({
  type: 'INTEGRATION_FAILURE',
  priority: 'P2',
  component: 'executive-chat.context.gmail',
  errorCode: 'gmail_unavailable',
  summary: 'Contexto de Gmail no disponible en Executive Chat.',
});

test('create: a report produces one compact OPEN incident with the minimal schema', () => {
  const registry = createRegistry();
  const incident = registry.report(GMAIL_FAILURE);
  assert.deepEqual(Object.keys(incident).sort(), [
    'component', 'errorCode', 'fingerprint', 'firstSeenAt', 'id', 'lastSeenAt', 'occurrenceCount',
    'prevention', 'priority', 'relatedCapability', 'relatedIncidentId', 'reopenCount', 'repairId',
    'requiresHumanDecision', 'resolution', 'resolvedAt', 'resolvedBy', 'status', 'summary', 'type',
  ]);
  assert.equal(incident.id, 'QI-1');
  assert.equal(incident.status, STATUSES.OPEN);
  assert.equal(incident.priority, 'P2');
  assert.equal(incident.occurrenceCount, 1);
  assert.equal(incident.firstSeenAt, incident.lastSeenAt);
  assert.equal(incident.resolution, null);
  assert.equal(incident.prevention, null);
  assert.equal(incident.resolvedBy, null);
  assert.equal(incident.requiresHumanDecision, false);
  assert.ok(Object.isFrozen(incident));
  assert.equal(registry.persistence, 'memory_only');
});

test('types and priorities: exactly the canonical enums; defaults never above what the type implies', () => {
  assert.deepEqual(Object.keys(INCIDENT_TYPES), [
    'TECHNICAL_BUG', 'RUNTIME_FAILURE', 'CAPABILITY_MISMATCH', 'WRONG_RESPONSE', 'USER_COMPLAINT',
    'UX_FRICTION', 'INTEGRATION_FAILURE', 'REGRESSION', 'POLICY_GAP', 'REPAIR_FAILURE', 'OTHER',
  ]);
  assert.deepEqual(PRIORITIES, ['P0', 'P1', 'P2', 'P3']);
  assert.deepEqual(Object.keys(STATUSES), ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX']);
  // P0 is never a default: it must be stated explicitly.
  assert.equal(Object.values(DEFAULT_PRIORITY).includes('P0'), false);

  const registry = createRegistry();
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, type: 'MYSTERY' })), 'QUALITY_INVALID_TYPE');
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, priority: 'P4' })), 'QUALITY_INVALID_PRIORITY');
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, priority: 'high' })), 'QUALITY_INVALID_PRIORITY');
  const ux = registry.report({ type: 'UX_FRICTION', component: 'executive-chat.ui', summary: 'Botón poco visible.' });
  assert.equal(ux.priority, 'P3');
});

test('case A: CAPABILITY_MISMATCH defaults to P1 and carries the related capability', () => {
  const registry = createRegistry();
  const incident = registry.report({
    type: 'CAPABILITY_MISMATCH',
    component: 'executive-chat.answer',
    relatedCapability: 'calendar.read',
    summary: 'OXKIO dijo no poder leer la agenda aunque calendar.read está disponible.',
  });
  assert.equal(incident.priority, 'P1');
  assert.equal(incident.relatedCapability, 'calendar.read');
});

test('dedupe + occurrenceCount: the same stable cause increments one incident instead of creating more', () => {
  const registry = createRegistry();
  const first = registry.report(GMAIL_FAILURE);
  for (let index = 0; index < 7; index += 1) registry.report(GMAIL_FAILURE);
  const latest = registry.get(first.id);
  assert.equal(registry.list().length, 1);
  assert.equal(latest.occurrenceCount, 8);
  assert.equal(latest.firstSeenAt, first.firstSeenAt);
  assert.ok(latest.lastSeenAt > first.lastSeenAt);

  // A different stable cause (errorCode) is a different incident.
  registry.report({ ...GMAIL_FAILURE, errorCode: 'gmail_quota' });
  assert.equal(registry.list().length, 2);
});

test('dedupe never keys on free text: a different summary for the same cause is the same incident', () => {
  const registry = createRegistry();
  const first = registry.report(GMAIL_FAILURE);
  const second = registry.report({ ...GMAIL_FAILURE, summary: 'Gmail volvió a fallar.' });
  assert.equal(second.id, first.id);
  assert.equal(second.occurrenceCount, 2);
  assert.equal(first.fingerprint.includes('Gmail volvió'), false);
  assert.equal(first.fingerprint, 'INTEGRATION_FAILURE|executive-chat.context.gmail|gmail_unavailable|-');
});

test('priority: a more urgent report raises the incident, a less urgent one never lowers it', () => {
  const registry = createRegistry();
  const { id } = registry.report(GMAIL_FAILURE);
  registry.report({ ...GMAIL_FAILURE, priority: 'P1' });
  assert.equal(registry.get(id).priority, 'P1');
  registry.report({ ...GMAIL_FAILURE, priority: 'P3' });
  assert.equal(registry.get(id).priority, 'P1');
});

test('resolve + prevention: a human resolution keeps summary, resolution, prevention and occurrenceCount', () => {
  const registry = createRegistry();
  const { id } = registry.report(GMAIL_FAILURE);
  registry.report(GMAIL_FAILURE);
  assert.equal(registry.markInProgress(id).status, STATUSES.IN_PROGRESS);
  assert.equal(codeOf(() => registry.resolve(id, { resolvedBy: 'human', resolution: 'Hecho.' })), 'QUALITY_INVALID_TEXT');
  const resolved = registry.resolve(id, {
    resolvedBy: 'human',
    resolution: 'Se corrigió el refresco del token de Gmail.',
    prevention: 'Test de regresión añadido para el refresco de Gmail.',
  });
  assert.equal(resolved.status, STATUSES.RESOLVED);
  assert.equal(resolved.summary, GMAIL_FAILURE.summary);
  assert.equal(resolved.occurrenceCount, 2);
  assert.equal(resolved.resolvedBy, 'human');
  assert.ok(resolved.resolvedAt);
  assert.equal(codeOf(() => registry.resolve(id, {
    resolvedBy: 'human', resolution: 'Otra vez.', prevention: 'Nada.',
  })), 'QUALITY_INCIDENT_CLOSED');
});

test('reopen/repeat: the same cause after RESOLVED reopens it, keeping the last resolution as audit', () => {
  const registry = createRegistry();
  const { id } = registry.report(GMAIL_FAILURE);
  registry.resolve(id, { resolvedBy: 'human', resolution: 'Arreglado.', prevention: 'Test añadido.' });
  const reopened = registry.report(GMAIL_FAILURE);
  assert.equal(reopened.id, id);
  assert.equal(reopened.status, STATUSES.OPEN);
  assert.equal(reopened.reopenCount, 1);
  assert.equal(reopened.occurrenceCount, 2);
  assert.equal(reopened.resolution, 'Arreglado.');
  assert.equal(reopened.prevention, 'Test añadido.');
});

test('WONT_FIX is a human-only closure and later occurrences only increment it', () => {
  const registry = createRegistry();
  const { id } = registry.report({ type: 'UX_FRICTION', component: 'executive-chat.ui', summary: 'Animación lenta.' });
  const closed = registry.markWontFix(id, { resolution: 'Se acepta por ahora.' });
  assert.equal(closed.status, STATUSES.WONT_FIX);
  assert.equal(closed.resolvedBy, 'human');
  const again = registry.report({ type: 'UX_FRICTION', component: 'executive-chat.ui', summary: 'Animación lenta.' });
  assert.equal(again.status, STATUSES.WONT_FIX);
  assert.equal(again.occurrenceCount, 2);
});

test('human gate: P0 and POLICY_GAP always require a human decision and never auto-resolve', () => {
  const registry = createRegistry();
  const critical = registry.report({
    type: 'TECHNICAL_BUG', priority: 'P0', component: 'security.secrets', errorCode: 'secret_exposed',
    summary: 'Posible exposición de secreto en un log.',
  });
  assert.equal(critical.requiresHumanDecision, true);
  const gap = registry.report({ type: 'POLICY_GAP', component: 'governance', summary: 'No hay política para X.' });
  assert.equal(gap.requiresHumanDecision, true);
  for (const { id } of [critical, gap]) {
    assert.equal(codeOf(() => registry.resolve(id, {
      resolvedBy: 'automatic', repairKind: 'safe_retry', resolution: 'Reintentado.', prevention: 'Nada.',
    })), 'QUALITY_HUMAN_DECISION_REQUIRED');
  }
  const flagged = registry.report({ ...GMAIL_FAILURE, errorCode: 'needs_provider', requiresHumanDecision: true });
  assert.equal(codeOf(() => registry.resolve(flagged.id, {
    resolvedBy: 'automatic', repairKind: 'safe_retry', resolution: 'Reintentado.', prevention: 'Nada.',
  })), 'QUALITY_HUMAN_DECISION_REQUIRED');
  assert.equal(registry.resolve(flagged.id, {
    resolvedBy: 'human', resolution: 'Decidido por José Antonio.', prevention: 'Regla documentada.',
  }).status, STATUSES.RESOLVED);
});

test('auto-fix: only allow-listed, reversible repair kinds can be declared automatically', () => {
  assert.deepEqual(AUTO_REPAIR_KINDS, [
    'safe_retry', 'known_fallback', 'non_destructive_reinit', 'format_repair',
    'approved_technical_fix', 'safe_self_revert',
  ]);
  const registry = createRegistry();
  const { id } = registry.report(GMAIL_FAILURE);
  for (const repairKind of [undefined, 'grant_permission', 'change_policy', 'new_provider', 'increase_budget']) {
    assert.equal(codeOf(() => registry.resolve(id, {
      resolvedBy: 'automatic', repairKind, resolution: 'Hecho.', prevention: 'Nada.',
    })), 'QUALITY_AUTO_REPAIR_NOT_ALLOWED', String(repairKind));
  }
  assert.equal(codeOf(() => registry.resolve(id, {
    resolvedBy: 'self', resolution: 'Hecho.', prevention: 'Nada.',
  })), 'QUALITY_INVALID_RESOLVER');
  const resolved = registry.resolve(id, {
    resolvedBy: 'automatic', repairKind: 'safe_retry', repairId: 'retry-1',
    resolution: 'Reintento seguro completado.', prevention: 'Reintento ya contemplado por política.',
  });
  assert.equal(resolved.resolvedBy, 'automatic');
  assert.equal(resolved.repairId, 'retry-1');
});

test('case B: a user complaint is recorded but never auto-resolved into policy', () => {
  const registry = createRegistry();
  for (const type of ['USER_COMPLAINT', 'WRONG_RESPONSE']) {
    const incident = registry.report({ type, component: 'executive-chat.answer', summary: 'El usuario indicó que la respuesta era incorrecta.' });
    assert.equal(incident.priority, 'P2');
    assert.equal(codeOf(() => registry.resolve(incident.id, {
      resolvedBy: 'automatic', repairKind: 'approved_technical_fix', resolution: 'Hecho.', prevention: 'Nada.',
    })), 'QUALITY_HUMAN_DECISION_REQUIRED');
  }
});

test('case D: a REPAIR_FAILURE links the original incident and sends it back to a human', () => {
  const registry = createRegistry();
  const original = registry.report(GMAIL_FAILURE);
  registry.resolve(original.id, {
    resolvedBy: 'automatic', repairKind: 'safe_retry', resolution: 'Reintento aplicado.', prevention: 'Nada.',
  });
  assert.equal(codeOf(() => registry.report({
    type: 'REPAIR_FAILURE', component: 'executive-chat.context.gmail', summary: 'El reintento falló.',
  })), 'QUALITY_RELATED_INCIDENT_REQUIRED');
  const failure = registry.report({
    type: 'REPAIR_FAILURE', component: 'executive-chat.context.gmail', relatedIncidentId: original.id,
    repairId: 'retry-1', summary: 'El reintento automático produjo otro fallo.',
  });
  assert.equal(failure.relatedIncidentId, original.id);
  assert.equal(failure.priority, 'P1');
  const back = registry.get(original.id);
  assert.equal(back.status, STATUSES.OPEN);
  assert.equal(back.requiresHumanDecision, true);
  assert.equal(codeOf(() => registry.resolve(original.id, {
    resolvedBy: 'automatic', repairKind: 'safe_retry', resolution: 'Otra vez.', prevention: 'Nada.',
  })), 'QUALITY_HUMAN_DECISION_REQUIRED');
});

test('privacy: private-looking text, unknown fields and free-text identifiers are rejected, not stored', () => {
  const registry = createRegistry();
  for (const summary of [
    'Fallo al leer juan.ficticio@example.com',
    'Error en C:\\Users\\jose\\secret.json',
    'Authorization: Bearer abc.def.ghi',
    '-----BEGIN PRIVATE KEY-----',
    'api_key=CLAVE-FICTICIA-9981',
    'Llamar al +34 600 123 456',
    'TypeError: boom at handle (/srv/app.js:10:5)',
    'Ver https://mail.google.com/mail/u/0/#inbox/abc',
    'x'.repeat(161),
  ]) {
    const code = codeOf(() => registry.report({ ...GMAIL_FAILURE, summary }));
    assert.ok(['QUALITY_SENSITIVE_TEXT', 'QUALITY_INVALID_TEXT'].includes(code), summary);
  }
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, query: '¿qué tengo hoy?' })), 'QUALITY_UNEXPECTED_FIELD');
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, prompt: 'x' })), 'QUALITY_UNEXPECTED_FIELD');
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, stack: 'x' })), 'QUALITY_UNEXPECTED_FIELD');
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, component: 'Juan Ficticio' })), 'QUALITY_INVALID_IDENTIFIER');
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, errorCode: 'mail from juan' })), 'QUALITY_INVALID_IDENTIFIER');
  assert.equal(registry.list().length, 0);

  const secretError = registry.report({ ...GMAIL_FAILURE, summary: 'Contexto de Gmail no disponible en Executive Chat.' });
  const text = JSON.stringify([secretError, registry.summary(), formatQualitySummary(registry.summary())]);
  for (const forbidden of ['example.com', 'Bearer', 'CLAVE-FICTICIA', 'query', 'prompt', 'stack']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('summary: P0-P3 open lists, top recurrence, recently repaired and pending human decisions', () => {
  const registry = createRegistry();
  const gmail = registry.report(GMAIL_FAILURE);
  for (let index = 0; index < 7; index += 1) registry.report(GMAIL_FAILURE);
  const critical = registry.report({
    type: 'TECHNICAL_BUG', priority: 'P0', component: 'security.secrets', summary: 'Posible secreto en un log.',
  });
  registry.report({ type: 'CAPABILITY_MISMATCH', component: 'executive-chat.answer', relatedCapability: 'calendar.read', summary: 'Dijo no poder leer la agenda.' });
  const fixed = registry.report({ type: 'UX_FRICTION', component: 'executive-chat.ui', summary: 'Texto cortado.' });
  registry.resolve(fixed.id, { resolvedBy: 'human', resolution: 'Se ajustó el CSS.', prevention: 'Test visual añadido.' });

  const summary = registry.summary();
  assert.equal(summary.persistence, 'memory_only');
  assert.deepEqual(summary.totals, { total: 4, active: 3, resolved: 1, wontFix: 0 });
  assert.deepEqual(summary.openByPriority.P0.map((item) => item.id), [critical.id]);
  assert.equal(summary.openByPriority.P1.length, 1);
  assert.deepEqual(summary.openByPriority.P2.map((item) => [item.id, item.occurrenceCount]), [[gmail.id, 8]]);
  assert.equal(summary.openByPriority.P3.length, 0);
  assert.equal(summary.topRecurring[0].id, gmail.id);
  assert.deepEqual(summary.recentlyResolved.map((item) => [item.id, item.prevention]), [[fixed.id, 'Test visual añadido.']]);
  assert.deepEqual(summary.pendingHumanDecision.map((item) => item.id), [critical.id]);

  const text = formatQualitySummary(summary);
  assert.match(text, /P2 abiertos: 1\n {2}QI-1 P2 OPEN x8 — Contexto de Gmail no disponible en Executive Chat\./);
  assert.match(text, /Reparadas recientemente:\n {2}QI-4 P3 RESOLVED x1 — Texto cortado\. \| Se ajustó el CSS\. \| Prevención: Test visual añadido\./);
});

test('persistence: an injected snapshot repository round-trips incidents and ids without changing callers', () => {
  let stored = null;
  const repository = {
    loadSnapshot: () => (stored ? JSON.parse(JSON.stringify(stored)) : { incidents: [] }),
    saveSnapshot: (snapshot) => { stored = JSON.parse(JSON.stringify(snapshot)); },
  };
  const first = createRegistry({ repository });
  assert.equal(first.persistence, 'repository');
  const { id } = first.report(GMAIL_FAILURE);
  first.report(GMAIL_FAILURE);

  const second = createRegistry({ repository });
  assert.equal(second.get(id).occurrenceCount, 2);
  assert.equal(second.report(GMAIL_FAILURE).occurrenceCount, 3);
  assert.equal(second.report({ ...GMAIL_FAILURE, errorCode: 'other' }).id, 'QI-2');

  assert.throws(() => new QualityIncidentRegistry({ repository: { loadSnapshot() {} } }), /QualityIncidentRepository/);
  const failing = createRegistry({ repository: { loadSnapshot: () => ({}), saveSnapshot() { throw new Error('disk secret'); } } });
  assert.equal(codeOf(() => failing.report(GMAIL_FAILURE)), 'QUALITY_PERSISTENCE_FAILED');
});

test('bounded: a full registry evicts the oldest closed incident, and refuses rather than dropping open ones', () => {
  const registry = createRegistry({ maxIncidents: 2 });
  const first = registry.report({ ...GMAIL_FAILURE, errorCode: 'a' });
  registry.report({ ...GMAIL_FAILURE, errorCode: 'b' });
  assert.equal(codeOf(() => registry.report({ ...GMAIL_FAILURE, errorCode: 'c' })), 'QUALITY_REGISTRY_FULL');
  registry.resolve(first.id, { resolvedBy: 'human', resolution: 'Hecho.', prevention: 'Test.' });
  registry.report({ ...GMAIL_FAILURE, errorCode: 'c' });
  assert.equal(registry.get(first.id), null);
  assert.equal(registry.list().length, 2);
});

test('no action and no policy change: the registry only records; it cannot execute, approve or send', () => {
  const registry = createRegistry();
  const methods = Object.getOwnPropertyNames(QualityIncidentRegistry.prototype).sort();
  assert.deepEqual(methods, [
    'commit', 'constructor', 'evictOneClosed', 'get', 'getActive', 'list', 'load', 'markInProgress',
    'markWontFix', 'persistence', 'report', 'resolve', 'summary',
  ]);
  const source = fs.readFileSync(path.join(__dirname, 'quality-incident-registry.js'), 'utf8');
  const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  assert.deepEqual(requires, ['../../repositories/repository-contracts']);
  for (const forbidden of ['executionEnabled', 'approvalQueue', 'fetch(', 'child_process', 'gmail.users', 'calendar.events']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  registry.report({ type: 'USER_COMPLAINT', component: 'executive-chat.answer', summary: 'No me gusta el tono.' });
  assert.equal(registry.list().length, 1);

  const serverSource = fs.readFileSync(path.join(__dirname, '..', '..', 'api', 'server.js'), 'utf8');
  assert.match(serverSource, /executionEnabled: false,/);
  assert.doesNotMatch(serverSource, /executionEnabled: true/);
});
