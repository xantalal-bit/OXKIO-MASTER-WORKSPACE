'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { REGISTRY_PATH, loadRegistry } = require('../../backend/projects/continuity-registry');
const { main, parse } = require('./continuity');

function capture(argv) {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    return { code: main(argv), out };
  } finally {
    process.stdout.write = original;
  }
}

test('arguments: repeatable topics, actions and typed scope', () => {
  assert.deepEqual(parse(['preflight', '--work-on', 'rls', '--work-on', 'node 22', '--action', 'merge', '--scope', 'pr=51', '--record']), {
    _: ['preflight'], workOn: ['rls', 'node 22'], action: ['merge'], branch: [], scope: { pr: 51 }, record: true,
  });
  assert.throws(() => parse(['preflight', '--mission']), { code: 'argument_missing' });
});

test('preflight is the gate before planning: reopening a CLOSED front exits 3 and writes nothing', () => {
  const before = fs.readFileSync(REGISTRY_PATH, 'utf8');
  // Any CLOSED front of the live registry: the gate does not depend on which.
  const closed = loadRegistry().entries.find((entry) => entry.state === 'CLOSED');
  assert.ok(closed, 'the registry keeps at least one CLOSED front');
  const refused = capture(['preflight', '--mission', 'Volver a abrir el frente', '--work-on', closed.id, '--action', 'test_only_fix', '--action', 'merge']);
  assert.equal(refused.code, 3);
  const result = JSON.parse(refused.out);
  assert.equal(result.verdict, 'REFUSE_REOPEN');
  assert.equal(result.refusals[0].id, closed.id);
  assert.match(result.canon.path, /XATAI-CLIENT-ZERO-CANON\.md$/);
  assert.deepEqual(result.authorizations.granted.map((a) => a.action), ['test_only_fix']);
  assert.deepEqual(result.authorizations.humanGate, ['merge']);

  const unknown = capture(['ask', 'facturación', 'electrónica']);
  assert.equal(unknown.code, 0);
  assert.match(unknown.out, /OXKIO no tiene registro de este tema/);
  const known = capture(['ask', closed.aliases[0] || closed.id]);
  assert.match(known.out, new RegExp(`${closed.id} — `));
  assert.match(known.out, /Reapertura solo si:/);
  assert.equal(fs.readFileSync(REGISTRY_PATH, 'utf8'), before);
});
