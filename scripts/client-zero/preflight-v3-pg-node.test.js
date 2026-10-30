'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflight } = require('./preflight-v3-pg-node');

const guards = {
  ROLE_STATE_SQL: 'ROLE_STATE_SQL',
  PLAINTEXT_SAFETY_SQL: 'PLAINTEXT_SAFETY_SQL',
  checkRole: (row) => { if (!row?.ok || row.login) throw new Error('unsafe role'); },
  verifyClientTls: (db, host) => { if (!db.connection?.verified || host !== 'ep-fake.neon.tech') throw new Error('unverified TLS'); },
  loggingBlockers: (row) => (row?.loggingSafe ? [] : ['log_statement'])
};
const opts = { expectedHost: 'ep-fake.neon.tech' };
// Neon-like default: the client socket is verified TLS, but pg_stat_ssl reports false.
function fakeDb(role = { ok: true, login: false }, session = { server_tls: false, loggingSafe: true }, fail = false, verified = true) {
  const calls = [];
  return {
    calls,
    connection: { verified },
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (fail && sql === 'PLAINTEXT_SAFETY_SQL') throw new Error('synthetic query error');
      if (sql === 'ROLE_STATE_SQL') return { rows: [role] };
      if (sql === 'PLAINTEXT_SAFETY_SQL') return { rows: [session] };
      return { rows: [] };
    }
  };
}
test('preflight is strictly read-only and returns only sanitized statuses', async () => {
  const db = fakeDb();
  const result = await preflight(db, guards, opts);
  assert.deepEqual(db.calls.map(x => x.sql), ['BEGIN READ ONLY','ROLE_STATE_SQL','PLAINTEXT_SAFETY_SQL','COMMIT']);
  assert.deepEqual(db.calls[1].params, ['oxkio_v3_runtime']);
  assert.equal(result.status, 'DB_PREFLIGHT_PASS_ONLY');
  assert.equal(result.tls, 'PASS');
  assert.equal(result.serverReportedTls, false);
  assert.deepEqual(result.loggingBlockers, []);
  assert.equal(result.provisioningExecuted, false);
  assert.equal(result.secretManagerVerified, false);
  assert.equal(JSON.stringify(result).includes('password'), false);
});
test('TLS, logging and role mismatches block preflight without writes', async () => {
  for (const [role, session, verified, expect] of [
    [{ ok: true, login: true }, { server_tls: true, loggingSafe: true }, true, { role: 'BLOCKED', tls: 'PASS', sessionLoggingGate: 'PASS' }],
    // pg_stat_ssl=true does not replace the client-side verification.
    [{ ok: true, login: false }, { server_tls: true, loggingSafe: true }, false, { role: 'NOLOGIN_LEAST_PRIVILEGE', tls: 'BLOCKED', sessionLoggingGate: 'PASS' }],
    // Logging is reported on its own, not as a side effect of TLS.
    [{ ok: true, login: false }, { server_tls: false, loggingSafe: false }, true, { role: 'NOLOGIN_LEAST_PRIVILEGE', tls: 'PASS', sessionLoggingGate: 'BLOCKED' }],
    [null, null, false, { role: 'BLOCKED', tls: 'BLOCKED', sessionLoggingGate: 'BLOCKED' }]
  ]) {
    const db = fakeDb(role, session, false, verified);
    const result = await preflight(db, guards, opts);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual({ role: result.role, tls: result.tls, sessionLoggingGate: result.sessionLoggingGate }, expect);
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.ok(db.calls.every(x => !/ALTER|INSERT|UPDATE|DELETE|CREATE|DROP|SET_PASSWORD/.test(x.sql)));
  }
});
test('query errors roll back the read-only transaction without printing details', async () => {
  const db = fakeDb(undefined, undefined, true);
  await assert.rejects(preflight(db, guards, opts), /synthetic query error/);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});
test('a verified socket for a different host than requested blocks TLS', async () => {
  const result = await preflight(fakeDb(), guards, { expectedHost: 'evil.example' });
  assert.equal(result.tls, 'BLOCKED');
  assert.equal(result.status, 'BLOCKED');
});
