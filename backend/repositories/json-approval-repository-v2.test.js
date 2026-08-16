'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { JsonApprovalRepositoryV2 } = require('./json-approval-repository-v2');
const {
  runApprovalRepositoryV2ContractTests,
  SYNTHETIC_RECORD,
  SYNTHETIC_SCOPE,
} = require('./approval-repository-v2-contract');

function tempFilePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-approval-v2-'));
  return path.join(dir, 'approvals-v2.json');
}

// Suite de contrato comun (async, CAS, not_found, execution_id_mismatch, ...)
// ejecutada contra el backend JSON de FASE A1.
runApprovalRepositoryV2ContractTests(
  async () => new JsonApprovalRepositoryV2({ filePath: tempFilePath() }),
  { label: 'json' },
);

// ── Declaracion explicita: este backend NO es multiinstancia-seguro ────────

test('JsonApprovalRepositoryV2 self-declares local_only persistence', () => {
  const repo = new JsonApprovalRepositoryV2({ filePath: tempFilePath() });
  assert.equal(repo.persistence, 'local_only');
});

// ── PASO 11: fresh reads entre dos instancias sobre el MISMO fichero ───────

test('two repository instances on the same file observe each other\'s writes without reconstructing', async () => {
  const filePath = tempFilePath();
  const repoA = new JsonApprovalRepositoryV2({ filePath });
  const repoB = new JsonApprovalRepositoryV2({ filePath });

  const created = await repoA.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
  const seenByB = await repoB.getById(created.item.id, SYNTHETIC_SCOPE);
  assert.equal(seenByB.ok, true);
  assert.equal(seenByB.item.version, 1);
  assert.equal(seenByB.item.status, 'pending');

  const approvedByA = await repoA.approve(created.item.id, { expectedVersion: created.item.version });
  assert.equal(approvedByA.ok, true);

  const seenByBAfterApprove = await repoB.getById(created.item.id, SYNTHETIC_SCOPE);
  assert.equal(seenByBAfterApprove.item.status, 'approved');
  assert.equal(seenByBAfterApprove.item.version, approvedByA.item.version);

  // repoB tambien puede mutar y repoA lo ve, sin que ninguna de las dos
  // instancias mantenga una copia en memoria del snapshot completo.
  const claimByB = await repoB.claimExecution(created.item.id, {
    expectedVersion: approvedByA.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-cross-instance',
    leaseTtlMs: 60000,
  });
  assert.equal(claimByB.ok, true);

  const seenByAAfterClaim = await repoA.getById(created.item.id, SYNTHETIC_SCOPE);
  assert.equal(seenByAAfterClaim.item.status, 'executing');
  assert.equal(seenByAAfterClaim.item.executionId, 'exec-cross-instance');
});

// ── PASO 13: persistencia entre reinicios del mismo proceso ────────────────

test('state survives destroying the repository reference and recreating it against the same file', async () => {
  const filePath = tempFilePath();
  let repoA = new JsonApprovalRepositoryV2({ filePath });
  const created = await repoA.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
  const approved = await repoA.approve(created.item.id, { expectedVersion: created.item.version });
  repoA = null; // simula destruir la instancia (reinicio del proceso)

  const repoB = new JsonApprovalRepositoryV2({ filePath });
  const reloaded = await repoB.getById(created.item.id, SYNTHETIC_SCOPE);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.item.status, 'approved');
  assert.equal(reloaded.item.version, approved.item.version);
});

// ── Corrupcion => FAIL CLOSED, nunca "vacio" silencioso ─────────────────────

test('a malformed JSON file throws instead of being silently treated as empty', async () => {
  const filePath = tempFilePath();
  fs.writeFileSync(filePath, '{not valid json', 'utf8');
  const repo = new JsonApprovalRepositoryV2({ filePath });
  await assert.rejects(() => repo.listPending(SYNTHETIC_SCOPE), /JSON ilegible/);
});

test('a well-formed but wrong-shaped JSON file throws instead of being silently treated as empty', async () => {
  const filePath = tempFilePath();
  fs.writeFileSync(filePath, JSON.stringify({ pending: [], history: [] }), 'utf8'); // forma V1, no V2
  const repo = new JsonApprovalRepositoryV2({ filePath });
  await assert.rejects(() => repo.listPending(SYNTHETIC_SCOPE), /contenido invalido/);
});

test('a missing file is treated as legitimately empty (first run), not as corruption', async () => {
  const filePath = tempFilePath();
  fs.rmSync(filePath, { force: true });
  const repo = new JsonApprovalRepositoryV2({ filePath });
  const pending = await repo.listPending(SYNTHETIC_SCOPE);
  assert.deepEqual(pending, []);
});

// ── Escritura atomica: temp file + rename, sin residuos ─────────────────────

test('writes leave no stray .tmp files behind and content matches what was written', async () => {
  const filePath = tempFilePath();
  const repo = new JsonApprovalRepositoryV2({ filePath });
  await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
  await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);

  const dir = path.dirname(filePath);
  const leftovers = fs.readdirSync(dir).filter((entry) => entry.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(onDisk.records.length, 2);
});

// ── Identificadores: UUID de aplicacion, no dependiente del reloj ──────────

test('generated ids are unique UUIDs even when created back-to-back in the same millisecond', async () => {
  const repo = new JsonApprovalRepositoryV2({ filePath: tempFilePath() });
  const results = await Promise.all(
    Array.from({ length: 25 }, () => repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE)),
  );
  const ids = results.map((result) => result.item.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.doesNotMatch(id, /^\d+-\d+$/); // no es el formato Date.now()-sequence de V1
  });
});
