'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { createSecretRuntime, createEnvironmentSecretProvider } = require('../../security/secret-runtime');
// Custody of OXKIO_V3_INTEGRITY_KEY (04/10/2026): the launcher loads version 1
// of the Secret Manager secret into the process environment; server.js reads
// it through the registered secret runtime. These tests follow that exact path
// with a synthetic key in the custody format (64 hex chars = 32 random bytes).
const UID = 'cliente-cero-controlled';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const identity = authorize({ uid: UID }).identity;
// Same expression as server.js: a missing secret means no V3 composition.
const keyFrom = env => { try { return createSecretRuntime({ provider: createEnvironmentSecretProvider({ env }) }).getSecret('OXKIO_V3_INTEGRITY_KEY'); } catch (error) { return null; } };
function boot(memoryRoot, env) {
 const server = createServerComposition({ enabled: true, cohortUids: UID, memoryRoot, authorizeIdentity: authorize, integrityKey: keyFrom(env) });
 return async query => {
  const req = Readable.from([JSON.stringify({ query, includeDetails: true })]); req.oxkioIdentity = identity;
  let status, body; await server.handle(req, { writeHead(s) { status = s; }, end(b) { body = b; } });
  return { status, data: body ? JSON.parse(body) : null };
 };
}
test('custodied key: sealed memory written before a restart opens after it; another key or no key fails closed', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-custody-'));
 const custodied = { OXKIO_V3_INTEGRITY_KEY: randomBytes(32).toString('hex') };
 try {
  const first = boot(root, custodied);
  assert.equal((await first('Recuerda que la custodia de la clave V3 se ha verificado')).data.details.status, 'COMPLETED');
  // Process restart: a new composition, the key re-read from the same custody.
  const restarted = boot(root, { ...custodied });
  const recalled = await restarted('Recupera memoria');
  assert.equal(recalled.status, 200); assert.match(recalled.data.response, /custodia de la clave V3/);
  // A rotated or wrong key never trusts the old records.
  const wrong = await boot(root, { OXKIO_V3_INTEGRITY_KEY: randomBytes(32).toString('hex') })('Recupera memoria');
  assert.equal(wrong.status, 409); assert.equal(wrong.data.code, 'stored_integrity_invalid');
  // Without the secret V3 is not composed at all (server.js keeps Executive Chat).
  assert.throws(() => boot(root, {}), error => error.code === 'integrity_key_invalid');
  assert.throws(() => boot(root, { OXKIO_V3_INTEGRITY_KEY: 'short' }), error => error.code === 'integrity_key_invalid');
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('the key never reaches the sealed store: no stored file contains it', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-custody-'));
 const key = randomBytes(32).toString('hex');
 try {
  await boot(root, { OXKIO_V3_INTEGRITY_KEY: key })('Recuerda que esta nota no contiene la clave');
  const files = []; const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(root); assert.ok(files.length > 0);
  for (const file of files) assert.equal(fs.readFileSync(file, 'utf8').includes(key), false, file);
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('authorization-B switch: off by default, only "true" with a ready provider, never opens CONFIDENTIAL', () => {
 const { reasoningEgressFromEnv } = require('./server-composition');
 const ready = { status: 'ready', provider: 'openai' };
 assert.deepEqual(reasoningEgressFromEnv({}, ready), {});
 assert.deepEqual(reasoningEgressFromEnv({ OXKIO_V3_REASONING_INTERNAL_EGRESS: 'TRUE' }, ready), {});
 assert.deepEqual(reasoningEgressFromEnv({ OXKIO_V3_REASONING_INTERNAL_EGRESS: 'true' }, { status: 'not_configured' }), {});
 const on = reasoningEgressFromEnv({ OXKIO_V3_REASONING_INTERNAL_EGRESS: 'true' }, ready);
 assert.equal(on.requestPrivacyFloor, 'INTERNAL');
 assert.deepEqual(on.privacyPolicy.internalProviders, [{ providerId: 'openai' }]);
 assert.deepEqual(on.privacyPolicy.confidentialProviders, []);
 const { ENVIRONMENT_VARIABLES } = require('../../config/environment-contract');
 assert.equal(ENVIRONMENT_VARIABLES.OXKIO_V3_REASONING_INTERNAL_EGRESS.kind, 'governance');
});

test('V3 has its own reasoning provider: OXKIO_V3_REASONING_* maps onto the provider contract; shared OXKIO_REASONING_* never leaks in', () => {
 const { v3ReasoningEnv } = require('./server-composition');
 const { createExecutiveReasoningProvider } = require('../executive-brain/executive-reasoning-provider');
 const secretRuntime = { getSecret: () => 'not-a-real-key' };
 const shared = { OXKIO_REASONING_PROVIDER: 'openai', OXKIO_REASONING_MODEL: 'shared-model', OXKIO_REASONING_BASE_URL: 'https://api.openai.com/v1', OXKIO_REASONING_INPUT_USD_PER_MILLION: '1', OXKIO_REASONING_OUTPUT_USD_PER_MILLION: '1', OXKIO_REASONING_PRICING_REVIEWED_AT: '2026-10-04' };
 // Only shared config present: V3's provider stays NOT_CONFIGURED.
 assert.equal(createExecutiveReasoningProvider({ env: v3ReasoningEnv(shared), secretRuntime }).status, 'not_configured');
 const v3 = { OXKIO_V3_REASONING_PROVIDER: 'openai', OXKIO_V3_REASONING_MODEL: 'gpt-5.6-luna', OXKIO_V3_REASONING_BASE_URL: 'https://api.openai.com/v1', OXKIO_V3_REASONING_INPUT_USD_PER_MILLION: '0.2', OXKIO_V3_REASONING_OUTPUT_USD_PER_MILLION: '1.2', OXKIO_V3_REASONING_PRICING_REVIEWED_AT: '2026-10-04' };
 const p = createExecutiveReasoningProvider({ env: v3ReasoningEnv({ ...shared, ...v3 }), secretRuntime });
 assert.equal(p.status, 'ready'); assert.equal(p.modelId, 'openai:gpt-5.6-luna');
 // And V3's config never configures the shared provider.
 assert.equal(createExecutiveReasoningProvider({ env: v3, secretRuntime }).status, 'not_configured');
});
