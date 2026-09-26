'use strict';

// FAKE pool only: proves the adapter logic (scope, SQL shape, parameters,
// error sanitization), not real PostgreSQL, RLS, grants or Neon behaviour.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PostgresQualityIncidentRepository,
  PostgresQualityIncidentRepositoryError,
} = require('./postgres-quality-incident-repository');
const { QualityIncidentRegistry } = require('../services/runtime/quality-incident-registry');

function createFakePool({ rows = [], failOn = null, failCode = 'ECONNREFUSED' } = {}) {
  const queries = [];
  let released = 0;
  const pool = {
    queries,
    get released() { return released; },
    async connect() {
      if (failOn === 'connect') throw Object.assign(new Error('secret host db.internal password=x'), { code: failCode });
      return {
        async query(sql, params) {
          queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
          if (failOn === 'query' && /quality_incidents/.test(sql)) {
            throw Object.assign(new Error('secret relation detail'), { code: failCode });
          }
          if (/^\s*SELECT record/.test(sql)) return { rows: rows.map((record) => ({ record })) };
          if (/INSERT INTO oxkio\.quality_incidents/.test(sql)) {
            for (const row of JSON.parse(params[1])) {
              const index = rows.findIndex((record) => record.id === row.id);
              if (index >= 0) rows[index] = row.record; else rows.push(row.record);
            }
          }
          return { rows: [] };
        },
        release() { released += 1; },
      };
    },
  };
  return pool;
}

const SCOPE = { clientId: 'cliente-cero' };

test('constructor fails closed without an injected pool or a scope', () => {
  assert.throws(() => new PostgresQualityIncidentRepository({ scope: SCOPE }), (error) => error.code === 'pool_required');
  assert.throws(() => new PostgresQualityIncidentRepository({ pool: createFakePool(), scope: { clientId: ' ' } }),
    (error) => error.code === 'scope_required');
  const repository = new PostgresQualityIncidentRepository({ pool: createFakePool(), scope: SCOPE });
  assert.equal(repository.persistence, 'postgresql');
});

test('loadSnapshot runs in a scoped transaction and returns stored records', async () => {
  const stored = { id: 'QI-1', type: 'OTHER' };
  const pool = createFakePool({ rows: [stored] });
  const repository = new PostgresQualityIncidentRepository({ pool, scope: SCOPE });
  assert.deepEqual(await repository.loadSnapshot(), { incidents: [stored] });
  assert.deepEqual(pool.queries.map((query) => query.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'SELECT', 'COMMIT']);
  assert.deepEqual(pool.queries[1].params, ['cliente-cero']);
  assert.match(pool.queries[1].sql, /set_config\('app\.client_id'/);
  assert.match(pool.queries[2].sql, /FROM oxkio\.quality_incidents WHERE client_id = \$1 ORDER BY last_seen_at ASC, id ASC/);
  assert.deepEqual(pool.queries[2].params, ['cliente-cero']);
  assert.equal(pool.released, 1);
});

test('saveSnapshot upserts only the given incidents in one parameterized statement', async () => {
  const pool = createFakePool();
  const repository = new PostgresQualityIncidentRepository({ pool, scope: SCOPE, now: () => '2026-09-26T12:00:00.000Z' });
  await repository.saveSnapshot({ incidents: [] });
  assert.equal(pool.queries.length, 0, 'nothing to write, no connection');
  const incident = {
    id: 'QI-1', fingerprint: 'OTHER|c|-|-', type: 'OTHER', priority: 'P3', status: 'OPEN',
    firstSeenAt: '2026-09-26T10:00:00.000Z', lastSeenAt: '2026-09-26T11:00:00.000Z', summary: 'Resumen.',
  };
  await repository.saveSnapshot({ sequence: 1, incidents: [incident] });
  const upsert = pool.queries.find((query) => query.sql.startsWith('INSERT'));
  assert.match(upsert.sql, /ON CONFLICT \(client_id, id\) DO UPDATE SET priority = EXCLUDED\.priority/);
  assert.doesNotMatch(upsert.sql, /DELETE|TRUNCATE|DROP/);
  assert.equal(upsert.params[0], 'cliente-cero');
  assert.equal(upsert.params[2], '2026-09-26T12:00:00.000Z');
  const [row] = JSON.parse(upsert.params[1]);
  assert.deepEqual(row, {
    id: 'QI-1', fingerprint: 'OTHER|c|-|-', type: 'OTHER', priority: 'P3', status: 'OPEN', record: incident,
    first_seen_at: incident.firstSeenAt, last_seen_at: incident.lastSeenAt,
  });
});

test('database errors are sanitized to fixed codes and never leak the driver message', async () => {
  for (const [failOn, failCode, expected] of [
    ['connect', 'ECONNREFUSED', 'quality_repository_unavailable'],
    ['query', '57014', 'quality_repository_timeout'],
    ['query', '42P01', 'quality_repository_failure'],
  ]) {
    const repository = new PostgresQualityIncidentRepository({ pool: createFakePool({ failOn, failCode }), scope: SCOPE });
    await assert.rejects(repository.loadSnapshot(), (error) => {
      assert.ok(error instanceof PostgresQualityIncidentRepositoryError);
      assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /secret|password|db\.internal/);
      return true;
    });
  }
});

test('end-to-end with the registry: durable across a restart over the same (fake) table', async (t) => {
  t.mock.method(console, 'error', () => {});
  const pool = createFakePool();
  const makeRegistry = () => new QualityIncidentRegistry({
    repository: new PostgresQualityIncidentRepository({ pool, scope: SCOPE }),
  });
  const first = makeRegistry();
  assert.equal(await first.load(), 'durable');
  const report = {
    type: 'INTEGRATION_FAILURE', priority: 'P2', component: 'executive-chat.context.gmail',
    errorCode: 'gmail_unavailable', summary: 'Contexto de Gmail no disponible en Executive Chat.',
  };
  first.report(report);
  first.report(report);
  assert.equal(await first.flush(), 'durable');

  const second = makeRegistry();
  await second.load();
  assert.equal(second.report(report).occurrenceCount, 3);
  assert.equal(await second.flush(), 'durable');

  const broken = new QualityIncidentRegistry({
    repository: new PostgresQualityIncidentRepository({ pool: createFakePool({ failOn: 'connect' }), scope: SCOPE }),
  });
  assert.equal(await broken.load(), 'QUALITY_PERSISTENCE_EPHEMERAL');
  broken.report(report);
  assert.equal(broken.list().length, 1);
});
