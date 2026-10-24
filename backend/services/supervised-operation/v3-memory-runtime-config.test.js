'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { v3MemoryRuntimeOptions } = require('./v3-memory-runtime-config');
const { ENVIRONMENT_VARIABLES } = require('../../config/environment-contract');
const { createSecretRuntime, createSyntheticSecretProvider } = require('../../security/secret-runtime');

const synthetic = {
  OXKIO_V3_ENABLED: 'true',
  OXKIO_V3_MEMORY_BACKEND: 'postgres',
  OXKIO_V3_PG_HOST: 'pg.internal.example',
  OXKIO_V3_PG_DATABASE: 'v3_memory',
  OXKIO_V3_PG_USER: 'oxkio_v3_runtime',
};
const secret = 'fake-test-only-not-a-real-password';
const secrets = createSecretRuntime({provider:createSyntheticSecretProvider({OXKIO_V3_PG_PASSWORD:secret})});

test('postgres V3 environment classifications register names but no values', () => {
  assert.equal(ENVIRONMENT_VARIABLES.OXKIO_V3_PG_PASSWORD.kind, 'secret');
  for (const id of ['MEMORY_BACKEND','PG_HOST','PG_PORT','PG_DATABASE','PG_USER','PG_SSL'])
    assert.ok(ENVIRONMENT_VARIABLES['OXKIO_V3_'+id], id);
  assert.equal(secrets.getSecret('OXKIO_V3_PG_PASSWORD'),secret);
});
test('disabled and default modes do not request any credential', () => {
  const forbidden=()=>{throw Error('should not be called')};
  assert.deepEqual(v3MemoryRuntimeOptions({},forbidden),{memoryBackend:'local'});
  assert.deepEqual(v3MemoryRuntimeOptions({OXKIO_V3_ENABLED:'true'},forbidden),{memoryBackend:'local'});
  assert.deepEqual(v3MemoryRuntimeOptions({...synthetic,OXKIO_V3_ENABLED:'false'},forbidden),{memoryBackend:'local'});
});
test('remote opt-in validates TLS certificates and uses only the dedicated secret', () => {
  const x=v3MemoryRuntimeOptions(synthetic,secrets.getSecret);
  assert.equal(x.memoryBackend,'postgres');
  assert.deepEqual(x.postgresMemoryConnection,{
    host:'pg.internal.example',port:5432,database:'v3_memory',
    user:'oxkio_v3_runtime',password:secret,ssl:{rejectUnauthorized:true}
  });
});
test('fails closed on missing secret, bad backend, missing host, invalid port and TLS downgrade', () => {
  const errors=[
    [{...synthetic,OXKIO_V3_MEMORY_BACKEND:'POSTGRES'},'memory_backend_invalid'],
    [{...synthetic,OXKIO_V3_PG_HOST:''},'postgres_connection_required'],
    [{...synthetic,OXKIO_V3_PG_PORT:'0'},'postgres_connection_required'],
    [{...synthetic,OXKIO_V3_PG_PORT:'invalid'},'postgres_connection_required'],
    [{...synthetic,OXKIO_V3_PG_SSL:'false'},'postgres_tls_required']
  ];
  for(const [env,code] of errors) assert.throws(()=>v3MemoryRuntimeOptions(env,secrets.getSecret),{code});
  assert.throws(()=>v3MemoryRuntimeOptions(synthetic),{code:'postgres_credentials_required'});
  assert.throws(()=>v3MemoryRuntimeOptions(synthetic,()=>''),{code:'postgres_credentials_required'});
  const noSecret=createSecretRuntime({provider:createSyntheticSecretProvider()});
  assert.throws(()=>v3MemoryRuntimeOptions(synthetic,noSecret.getSecret),{code:'secret_missing'});
});
test('IPv4 and IPv6 loopback may opt out of TLS for isolated runners only',()=>{
  for(const host of ['localhost','127.0.0.1','::1']){
    const x=v3MemoryRuntimeOptions({...synthetic,OXKIO_V3_PG_HOST:host,OXKIO_V3_PG_SSL:'false'},secrets.getSecret);
    assert.equal(x.postgresMemoryConnection.ssl,false);
  }
});
