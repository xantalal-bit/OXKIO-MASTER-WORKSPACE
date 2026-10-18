'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const continuity = require('./continuity-registry');

const {
  SCHEMA, auditClosures, authorizationFor, buildDailyReport, classifyGap, close, closureGaps,
  findEntry, getContinuityView, loadCanon, loadRegistry, matchEntries, observationsFromRuns,
  preflight, reconcile, saveRegistry, transition, upsert, validateRegistry,
} = continuity;

const T0 = '2026-10-17T10:00:00.000Z';
const T1 = '2026-10-17T11:00:00.000Z';
const T2 = '2026-10-17T12:00:00.000Z';
const T3 = '2026-10-17T13:00:00.000Z';
const NOW = '2026-10-17T14:00:00.000Z';

const ev = (ref, kind, result, observedAt, summary = `${kind} ${ref}`) => ({
  ref, kind, result, observedAt, source: 'fixture', summary,
});

function closedFront(overrides = {}) {
  return {
    id: 'CZ-PG-RLS',
    project: 'OXKIO',
    scope: 'persistencia',
    title: 'PostgreSQL/RLS real',
    aliases: ['postgres', 'rls'],
    state: 'CLOSED',
    priority: 'P1',
    decision: 'Approval validado contra PostgreSQL real.',
    reopenCondition: 'Fallo real de approval-postgres-integration posterior al cierre.',
    nextAction: 'Ninguna.',
    changes: 'Alta.',
    confidence: 'high',
    requiresRealTest: true,
    signals: ['approval-postgres-integration'],
    version: 1,
    updatedAt: T1,
    evidence: [
      ev('pr:48', 'pr_merged', 'success', T1, 'PR #48 mergeada en 67b8fe9'),
      ev('ci:100#approval-postgres-integration', 'ci_green', 'success', T0),
      ev('ci:100#real', 'real_test', 'success', T0),
    ],
    ...overrides,
  };
}

function fixture(entries = [closedFront()]) {
  return validateRegistry({
    schema: SCHEMA,
    revision: 1,
    updatedAt: T1,
    canon: { path: 'KNOWLEDGE-CURATOR/CLIENT-ZERO/XATAI-CLIENT-ZERO-CANON.md' },
    humanGates: ['merge', 'deploy', 'push', 'production', 'secrets'],
    authorizations: [
      {
        id: 'AUTH-SELF-REPAIR', actions: ['test_only_fix', 'local_commit', 'merge'], standing: true,
        grantedBy: 'José Antonio', grantedAt: T0, source: 'Canon Cliente Cero: autorreparación supervisada', expiresAt: null,
      },
      {
        id: 'AUTH-MERGE-PR51', actions: ['merge'], standing: false, scope: { pr: 51 },
        grantedBy: 'José Antonio', grantedAt: T0, source: 'fixture: merge de la PR #51', expiresAt: null,
      },
      {
        id: 'AUTH-OLD', actions: ['ephemeral_local_db'], standing: true,
        grantedBy: 'José Antonio', grantedAt: T0, source: 'fixture caducada', expiresAt: T1,
      },
    ],
    entries,
    events: [],
  });
}

const CANON = loadCanon();

test('the real canon is consumed: preflight rules, digest and a fail-closed absence', () => {
  assert.equal(CANON.path, 'KNOWLEDGE-CURATOR/CLIENT-ZERO/XATAI-CLIENT-ZERO-CANON.md');
  assert.equal(CANON.rules.length, 10);
  assert.match(CANON.rules[3], /No reabrir `CLOSED` sin evidencia material nueva/);
  assert.match(CANON.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => loadCanon(path.join(os.tmpdir(), 'no-canon-here.md')), { code: 'canon_missing' });
  assert.throws(() => preflight({ registry: fixture(), canon: null, mission: 'x' }), { code: 'canon_required' });
});

test('preflight answers what OXKIO already knows before planning, and says so when it knows nothing', () => {
  const known = preflight({ registry: fixture(), canon: CANON, mission: 'Revisar el estado de Postgres', now: NOW });
  assert.equal(known.known, true);
  assert.equal(known.verdict, 'PROCEED');
  assert.equal(known.fronts[0].id, 'CZ-PG-RLS');
  assert.equal(known.fronts[0].state, 'CLOSED');
  assert.equal(known.canon.sha256, CANON.sha256);
  assert.equal(known.event.type, 'preflight');
  assert.doesNotMatch(JSON.stringify(known.event), /Revisar el estado/);

  const unknown = preflight({ registry: fixture(), canon: CANON, mission: 'tema nuevo', workOn: ['facturación SII'], now: NOW });
  assert.equal(unknown.known, false);
  assert.equal(unknown.verdict, 'UNKNOWN_TOPIC');
  assert.deepEqual(unknown.unknownTopics, ['facturación SII']);
});

test('no-reopen: a CLOSED front is refused without new, newer, contradicting evidence', () => {
  const registry = fixture();
  const bare = preflight({ registry, canon: CANON, mission: 'Revalidar RLS', workOn: ['rls'], now: NOW });
  assert.equal(bare.verdict, 'REFUSE_REOPEN');
  assert.deepEqual(bare.refusals.map((r) => r.reason), ['closed_without_new_material_evidence']);
  assert.match(bare.refusals[0].reopenCondition, /approval-postgres-integration/);

  // Known ref, older than the closing proof, or not contradicting: still refused.
  [
    ev('ci:100#approval-postgres-integration', 'ci_failure', 'failure', T3),
    ev('ci:99#approval-postgres-integration', 'ci_failure', 'failure', '2026-10-17T09:00:00.000Z'),
    ev('ci:101#approval-postgres-integration', 'ci_green', 'success', T3),
  ].forEach((item) => {
    const result = preflight({ registry, canon: CANON, workOn: ['rls'], evidence: [item], now: NOW });
    assert.equal(result.verdict, 'REFUSE_REOPEN', item.ref);
  });

  const material = preflight({
    registry, canon: CANON, workOn: ['rls'], now: NOW,
    evidence: [ev('ci:102#approval-postgres-integration', 'ci_failure', 'failure', T3)],
  });
  assert.equal(material.verdict, 'PROCEED');
  assert.deepEqual(material.reopenable, [{ id: 'CZ-PG-RLS', evidence: ['ci:102#approval-postgres-integration'] }]);
});

test('contradiction: the newest evidence wins and is recorded as a continuity defect', () => {
  const registry = fixture();
  const older = reconcile({ registry, now: NOW, observations: [
    { entry: 'CZ-PG-RLS', ...ev('ci:99#approval-postgres-integration', 'ci_failure', 'failure', '2026-10-17T09:00:00.000Z') },
  ] });
  assert.deepEqual(older.changes.map((c) => c.type), ['superseded']);
  assert.equal(findEntry(older.registry, 'CZ-PG-RLS').state, 'CLOSED');

  const newer = reconcile({ registry: older.registry, now: NOW, observations: [
    { entry: 'CZ-PG-RLS', ...ev('ci:102#approval-postgres-integration', 'ci_failure', 'failure', T2, 'falla en main') },
  ] });
  const reopened = findEntry(newer.registry, 'CZ-PG-RLS');
  assert.deepEqual(newer.changes, [{ type: 'reopened', entry: 'CZ-PG-RLS', from: 'CLOSED', to: 'PENDING', ref: 'ci:102#approval-postgres-integration' }]);
  assert.equal(reopened.state, 'PENDING');
  assert.match(reopened.changes, /Reabierto por evidencia más reciente ci:102/);
  assert.deepEqual(newer.registry.events.map((e) => e.type), ['superseded_evidence', 'continuity_defect', 'reopened_by_evidence']);
  assert.equal(newer.registry.revision, registry.revision + 2);

  // Closing again needs green CI and the real test newer than the failure.
  assert.deepEqual(closureGaps(reopened), ['ci_green', 'real_test']);
  assert.throws(() => close({ registry: newer.registry, id: 'CZ-PG-RLS', now: NOW }), { code: 'closure_criteria_missing' });
  const recovered = reconcile({ registry: newer.registry, now: NOW, observations: [
    { entry: 'CZ-PG-RLS', ...ev('ci:103#approval-postgres-integration', 'ci_green', 'success', T3) },
  ] });
  assert.deepEqual(recovered.changes.map((c) => c.type), ['evidence_added']);
  const closed = close({ registry: recovered.registry, id: 'CZ-PG-RLS', now: NOW,
    evidence: [ev('ci:103#real', 'real_test', 'success', T3)] });
  assert.equal(findEntry(closed, 'CZ-PG-RLS').state, 'CLOSED');
  assert.equal(closed.events.at(-1).type, 'closed');
});

test('deduplication: one front per topic, one evidence per ref, two failing runs reopen once', () => {
  const registry = fixture();
  const merged = upsert({ registry, now: NOW, entry: {
    id: 'CZ-POSTGRES-DUP', project: 'OXKIO', scope: 'persistencia', title: 'Postgres', aliases: ['row level security'],
    priority: 'P1', decision: 'd', reopenCondition: 'r', nextAction: 'n', changes: 'c', confidence: 'low',
    evidence: [ev('pr:48', 'pr_merged', 'success', T1)],
  } });
  assert.equal(merged.merged, true);
  assert.equal(merged.id, 'CZ-PG-RLS');
  assert.equal(merged.registry.entries.length, 1);
  assert.equal(findEntry(merged.registry, 'CZ-PG-RLS').evidence.filter((e) => e.ref === 'pr:48').length, 1);
  assert.ok(findEntry(merged.registry, 'CZ-PG-RLS').aliases.includes('row level security'));
  assert.equal(merged.registry.events.at(-1).type, 'merged_duplicate');

  assert.throws(() => fixture([closedFront(), closedFront({ id: 'CZ-OTHER', title: 'Otro', aliases: ['RLS'] })]),
    { code: 'registry_invalid', message: /alias "RLS" already names CZ-PG-RLS/ });

  const same = reconcile({ registry, now: NOW, observations: [
    { entry: 'CZ-PG-RLS', ...ev('ci:100#approval-postgres-integration', 'ci_green', 'success', T0) },
  ] });
  assert.deepEqual(same.changes.map((c) => c.type), ['duplicate']);
  assert.equal(same.registry.revision, registry.revision);

  const twice = reconcile({ registry, now: NOW, observations: [
    { entry: 'CZ-PG-RLS', ...ev('ci:200#approval-postgres-integration', 'ci_failure', 'failure', T2, 'push a main') },
    { entry: 'CZ-PG-RLS', ...ev('ci:201#approval-postgres-integration', 'ci_failure', 'failure', T3, 'PR de documentación') },
    { entry: 'CZ-PG-RLS', ...ev('ci:201#approval-postgres-integration', 'ci_failure', 'failure', T3, 'repetida') },
  ] });
  assert.deepEqual(twice.changes.map((c) => c.type), ['reopened', 'evidence_added', 'duplicate']);
  assert.equal(twice.registry.entries.length, 1);
  assert.equal(twice.registry.events.filter((e) => e.type === 'reopened_by_evidence').length, 1);
  assert.deepEqual(matchEntries(twice.registry, 'el job de RLS en PostgreSQL/RLS real').map((e) => e.id), ['CZ-PG-RLS']);
});

test('multi-signal fronts: a green job never outweighs a newer failure of another job', () => {
  const matrix = closedFront({
    id: 'CZ-MATRIX', title: 'Matriz Node', aliases: ['node 22'], requiresRealTest: false,
    signals: ['backend-tests (node 22)', 'backend-tests (node 24)'],
    evidence: [
      ev('pr:47', 'pr_merged', 'success', T0),
      ev('ci:1#backend-tests (node 22)', 'ci_green', 'success', T0),
      ev('ci:1#backend-tests (node 24)', 'ci_green', 'success', T0),
    ],
  });
  const registry = fixture([matrix]);
  const run = observationsFromRuns(registry, [{
    id: 2, branch: 'main', event: 'push', sha: 'abcdef1234567', updatedAt: T3,
    jobs: [
      { name: 'backend-tests (node 24)', conclusion: 'success', completedAt: T3 },
      { name: 'backend-tests (node 22)', conclusion: 'failure', completedAt: T2 },
    ],
  }]);
  const { registry: next, changes } = reconcile({ registry, observations: run, now: NOW });
  assert.deepEqual(changes.map((c) => c.type), ['evidence_added', 'reopened']);
  const front = findEntry(next, 'CZ-MATRIX');
  assert.equal(front.state, 'PENDING');
  // Only a newer green of the same job answers the failure.
  assert.deepEqual(closureGaps(front), ['ci_green']);
  const healed = reconcile({ registry: next, now: NOW, observations: [
    { entry: 'CZ-MATRIX', ...ev('ci:3#backend-tests (node 22)', 'ci_green', 'success', NOW) },
  ] });
  assert.deepEqual(healed.changes.map((c) => c.type), ['closable']);
});

test('authorization already granted is not asked again; human gates need an exact scope', () => {
  const registry = fixture();
  assert.equal(authorizationFor(registry, 'test_only_fix', {}, NOW).status, 'GRANTED');
  assert.equal(authorizationFor(registry, 'test_only_fix', {}, NOW).authorizationId, 'AUTH-SELF-REPAIR');
  // A standing authorization never opens a gate, even if it lists the action.
  assert.equal(authorizationFor(registry, 'merge', {}, NOW).status, 'HUMAN_GATE');
  assert.equal(authorizationFor(registry, 'merge', { pr: 52 }, NOW).status, 'HUMAN_GATE');
  assert.equal(authorizationFor(registry, 'merge', { pr: 51 }, NOW).authorizationId, 'AUTH-MERGE-PR51');
  assert.equal(authorizationFor(registry, 'deploy', { pr: 51 }, NOW).status, 'HUMAN_GATE');
  assert.equal(authorizationFor(registry, 'ephemeral_local_db', {}, NOW).status, 'NOT_GRANTED');
  assert.equal(authorizationFor(registry, 'ephemeral_local_db', {}, '2026-10-17T10:30:00.000Z').status, 'GRANTED');

  const result = preflight({ registry, canon: CANON, mission: 'arreglo de test', now: NOW,
    actions: ['test_only_fix', 'local_commit', 'push', 'merge', 'iam_change'] });
  assert.deepEqual(result.authorizations.granted.map((a) => a.action), ['test_only_fix', 'local_commit']);
  assert.deepEqual(result.authorizations.humanGate, ['push', 'merge']);
  assert.deepEqual(result.authorizations.notGranted, ['iam_change']);
});

test('gaps are classified: P0/P1 pending, P2/P3 backlog; CLOSED only through close()', () => {
  assert.equal(classifyGap('P0'), 'PENDING');
  assert.equal(classifyGap('P1'), 'PENDING');
  assert.equal(classifyGap('P2'), 'BACKLOG');
  assert.equal(classifyGap('P3'), 'BACKLOG');
  assert.throws(() => classifyGap('P9'), { code: 'priority_invalid' });

  const added = upsert({ registry: fixture(), now: NOW, entry: {
    id: 'CZ-TLS-REAL', project: 'OXKIO', scope: 'persistencia', title: 'TLS de la factory sin prueba real',
    priority: 'P3', decision: 'No bloquea.', reopenCondition: 'n/a', nextAction: 'Probar con TLS.', changes: 'Alta.', confidence: 'medium',
  } });
  assert.equal(findEntry(added.registry, 'CZ-TLS-REAL').state, 'BACKLOG');
  assert.throws(() => transition({ registry: added.registry, id: 'CZ-PG-RLS', state: 'PENDING', now: NOW }), { code: 'closed_requires_material_evidence' });
  assert.throws(() => transition({ registry: added.registry, id: 'CZ-TLS-REAL', state: 'BLOCKED', now: NOW }), { code: 'blocked_requires_reason' });
  const blocked = transition({ registry: added.registry, id: 'CZ-TLS-REAL', state: 'BLOCKED', blockedBy: 'puerta humana: push', now: NOW });
  assert.equal(findEntry(blocked, 'CZ-TLS-REAL').blockedBy, 'puerta humana: push');
  assert.throws(() => fixture([closedFront({ evidence: [ev('pr:48', 'pr_merged', 'success', T1)] })]),
    { code: 'registry_invalid', message: /CLOSED without ci_green, real_test/ });
});

test('continuity record round-trips through the repository file and fails closed when broken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-continuity-'));
  try {
    const file = path.join(dir, 'CONTINUITY-REGISTRY.json');
    const { registry } = reconcile({ registry: fixture(), now: NOW, observations: [
      { entry: 'CZ-PG-RLS', ...ev('ci:300#approval-postgres-integration', 'ci_failure', 'failure', T2) },
    ] });
    saveRegistry(registry, file);
    assert.deepEqual(fs.readdirSync(dir), ['CONTINUITY-REGISTRY.json']);
    const loaded = loadRegistry(file);
    assert.deepEqual(loaded, registry);
    assert.equal(Object.isFrozen(loaded.entries[0].evidence), true);
    const view = getContinuityView(file);
    assert.equal(view.available, true);
    assert.deepEqual(view.counts, { CLOSED: 0, PENDING: 1, BLOCKED: 0, BACKLOG: 0 });
    assert.deepEqual(view.nextAction, { id: 'CZ-PG-RLS', state: 'PENDING', action: 'Ninguna.' });

    fs.writeFileSync(file, '{"schema":', 'utf8');
    assert.throws(() => loadRegistry(file), { code: 'registry_invalid' });
    assert.equal(getContinuityView(file).available, false);
    assert.equal(getContinuityView(path.join(dir, 'missing.json')).reason, 'registry_missing');
    assert.throws(() => saveRegistry({ ...registry, entries: [{ id: 'bad' }] }, file), { code: 'registry_invalid' });
    assert.equal(fs.readFileSync(file, 'utf8'), '{"schema":');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GitHub CI runs become evidence for their fronts, and CLOSED fronts are audited against PR facts', () => {
  const registry = fixture();
  const observations = observationsFromRuns(registry, [{
    id: 400, branch: 'main', event: 'push', sha: '67b8fe90475da24eadddecf7e1ba58c7124301be', updatedAt: T2,
    jobs: [
      { name: 'approval-postgres-integration', conclusion: 'failure', completedAt: T2 },
      { name: 'backend-tests', conclusion: 'success', completedAt: T2 },
      { name: 'docker-image-build', conclusion: 'skipped', completedAt: T2 },
    ],
  }]);
  assert.deepEqual(observations.map((o) => [o.entry, o.ref, o.kind]), [
    ['CZ-PG-RLS', 'ci:400#approval-postgres-integration', 'ci_failure'],
  ]);
  assert.match(observations[0].summary, /push main @ 67b8fe9/);

  assert.deepEqual(auditClosures(registry, { 48: { state: 'MERGED', mergeCommit: '67b8fe90475da24eadddecf7e1ba58c7124301be' } })
    .map((f) => f.status), ['verified']);
  assert.deepEqual(auditClosures(registry, { 48: { state: 'MERGED', mergeCommit: 'dc339ce1c8d871ef6f19fe9b9108a468cfaec6cb' } })
    .map((f) => f.status), ['contradicted']);
  assert.deepEqual(auditClosures(registry, {}).map((f) => f.status), ['unverified']);
});

test('the Parte Diario is generated from the registry, names its source and what to audit', () => {
  const paperwork = {
    id: 'CZ-AAA-DOC', project: 'OXKIO', scope: 'docs', title: 'Documento pendiente de merge', aliases: [], state: 'BLOCKED',
    priority: 'P1', blockedBy: 'puerta humana: merge', decision: 'd', reopenCondition: 'r', nextAction: 'Merge del documento.',
    changes: 'c', confidence: 'high', version: 1, updatedAt: T1, evidence: [],
  };
  const { registry } = reconcile({ registry: fixture([closedFront(), paperwork]), now: T2, observations: [
    { entry: 'CZ-PG-RLS', ...ev('ci:500#approval-postgres-integration', 'ci_failure', 'failure', T2, 'falla en main') },
  ] });
  const late = continuity.recordEvent({ registry, now: T3, event: { type: 'human_decision', at: T0, note: 'Decisión anotada tarde.' } });
  const blocked = transition({ registry: late, id: 'CZ-PG-RLS', state: 'BLOCKED', blockedBy: 'puerta humana: push', nextAction: 'Autorizar push del arreglo.', now: T3 });
  const report = buildDailyReport({ registry: blocked, date: '2026-10-17', now: NOW });
  const md = report.markdown;
  assert.match(md, /^# Parte Diario OXKIO — 2026-10-17/);
  assert.match(md, /Fuente primaria: OXKIO · registro de continuidad/);
  assert.match(md, /Auditor: Xatai/);
  [
    'Cambios materiales', 'Hitos cerrados', 'Pendientes', 'Bloqueos', 'Backlog', 'Decisiones humanas reales',
    'Automatizaciones ejecutadas', 'Evidencia nueva', 'Siguiente acción', 'Para auditar',
  ].forEach((section) => assert.match(md, new RegExp(`## ${section}`)));
  assert.match(md, /DEFECTO DE CONTINUIDAD · CZ-PG-RLS/);
  assert.match(md, /CZ-PG-RLS\*\* \[P1\] PostgreSQL\/RLS real — bloqueado por: puerta humana: push/);
  // At equal priority the front contradicted by unanswered evidence goes first.
  assert.match(md, /## Siguiente acción\n- CZ-PG-RLS \(BLOCKED\): Autorizar push del arreglo\./);
  // Material changes in chronological order, whatever the order they were noted in.
  const changesSection = md.split('## Cambios materiales')[1].split('## Hitos')[0];
  assert.ok(changesSection.indexOf('Decisión anotada tarde.') < changesSection.indexOf('DEFECTO DE CONTINUIDAD'));
  assert.match(md, /- ci:500#approval-postgres-integration/);
  assert.deepEqual(report.summary.counts, { CLOSED: 0, PENDING: 0, BLOCKED: 2, BACKLOG: 0 });
  assert.throws(() => buildDailyReport({ registry: blocked, date: '17/10/2026' }), { code: 'date_invalid' });
});

test('the repository registry is valid, uses the real canon and keeps the declared Client Zero milestones', () => {
  const registry = loadRegistry();
  assert.equal(registry.canon.path, CANON.path);
  ['CZ-CI-NODE22-24', 'CZ-LEDGER-PID', 'CZ-APPROVAL-BIGINT', 'CZ-PG-RLS-REAL', 'CZ-CONTINUITY-PREFLIGHT'].forEach((id) => {
    assert.ok(findEntry(registry, id), id);
  });
  // Every CLOSED front satisfies the canonical criteria (validateRegistry) and
  // every front carries its reopen condition and next action.
  registry.entries.forEach((entry) => {
    assert.ok(entry.reopenCondition.length > 0, entry.id);
    assert.ok(entry.nextAction.length > 0, entry.id);
    if (entry.state === 'CLOSED') assert.deepEqual(closureGaps(entry), [], entry.id);
  });
  ['merge', 'deploy', 'production', 'neon', 'secrets', 'iam', 'spend', 'push'].forEach((gate) => {
    assert.ok(registry.humanGates.includes(gate), gate);
    assert.equal(authorizationFor(registry, gate).status, 'HUMAN_GATE', gate);
  });
});

test('a merge recorded after an observation of the same PR is refused aloud, kept as pr:N#merge and audited', () => {
  const observed = closedFront({
    id: 'CZ-PREFLIGHT', title: 'Preflight', aliases: ['preflight'], state: 'BLOCKED', blockedBy: 'merge de la PR #52',
    requiresRealTest: false, signals: undefined,
    evidence: [ev('pr:52', 'observation', 'info', T0, 'PR #52 abierta')],
  });
  const registry = fixture([observed]);
  // The same ref with another kind used to be dropped silently, leaving the
  // front without its merge and the audit without anything to verify.
  assert.throws(() => close({ registry, id: 'CZ-PREFLIGHT', now: NOW, evidence: [ev('pr:52', 'pr_merged', 'success', T2, 'PR #52 mergeada en f97910b')] }),
    (error) => error.code === 'evidence_ref_conflict');
  const closed = close({ registry, id: 'CZ-PREFLIGHT', now: NOW, evidence: [
    ev('pr:52#merge', 'pr_merged', 'success', T2, 'PR #52 mergeada en f97910b'),
    ev('ci:200#backend-tests', 'ci_green', 'success', T3),
  ] });
  assert.equal(findEntry(closed, 'CZ-PREFLIGHT').state, 'CLOSED');
  // The same fact again is a no-op, not a conflict.
  assert.doesNotThrow(() => transition({ registry: fixture([observed]), id: 'CZ-PREFLIGHT', state: 'PENDING', now: NOW, evidence: [ev('pr:52', 'observation', 'info', T0, 'PR #52 abierta')] }));
  assert.deepEqual(auditClosures(closed, { 52: { state: 'MERGED', mergeCommit: 'f97910bdeadbeef' } }).map((f) => [f.ref, f.status]), [['pr:52#merge', 'verified']]);
  assert.deepEqual(auditClosures(closed, { 52: { state: 'CLOSED', mergeCommit: null } }).map((f) => f.status), ['contradicted']);
});
