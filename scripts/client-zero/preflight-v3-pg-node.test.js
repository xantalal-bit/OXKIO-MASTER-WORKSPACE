'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflight } = require('./preflight-v3-pg-node');

const guards = {
  ROLE_STATE_SQL: 'ROLE_STATE_SQL',
  PLAINTEXT_SAFETY_SQL: 'PLAINTEXT_SAFETY_SQL',
  checkRole: (row) => { if (!row?.ok || row.login) throw new Error('unsafe role'); },
  checkPlaintextSafety: (row) => { if (!row?.tls || !row?.loggingSafe) throw new Error('unsafe session'); }
};
function fakeDb(role = { ok: true, login: false }, session = { tls: true, loggingSafe: true }, fail = false) {
  const calls = [];
  return {
    calls,
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
  const result = await preflight(db, guards);
  assert.deepEqual(db.calls.map(x => x.sql), ['BEGIN READ ONLY','ROLE_STATE_SQL','PLAINTEXT_SAFETY_SQL','COMMIT']);
  assert.deepEqual(db.calls[1].params, ['oxkio_v3_runtime']);
  assert.equal(result.status, 'DB_PREFLIGHT_PASS_ONLY');
  assert.equal(result.provisioningExecuted, false);
  assert.equal(result.secretManagerVerified, false);
  assert.equal(JSON.stringify(result).includes('password'), false);
});
test('TLS, logging and role mismatches block preflight without writes', async () => {
  for (const [role, session] of [
    [{ ok: true, login: true }, { tls: true, loggingSafe: true }],
    [{ ok: true, login: false }, { tls: false, loggingSafe: true }],
    [{ ok: true, login: false }, { tls: true, loggingSafe: false }],
    [null, null]
  ]) {
    const db = fakeDb(role, session);
    const result = await preflight(db, guards);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.ok(db.calls.every(x => !/ALTER|INSERT|UPDATE|DELETE|CREATE|DROP|SET_PASSWORD/.test(x.sql)));
  }
});
test('query errors roll back the read-only transaction without printing details', async () => {
  const db = fakeDb(undefined, undefined, true);
  await assert.rejects(preflight(db, guards), /synthetic query error/);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});
