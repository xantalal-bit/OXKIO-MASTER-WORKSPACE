'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkRole, provision } = require('./provision-v3-pg-secret');

const safeRole = () => ({
  rolname:'oxkio_v3_runtime', rolcanlogin:false, rolsuper:false,
  rolbypassrls:false, rolcreaterole:false, rolcreatedb:false,
  password_set:false, can_read:true, can_write:true, can_delete:false,
  can_schema_create:false
});
const goodPassword = 'A'.repeat(64);

test('rejects elevated privileges, existing passwords and login', () => {
  for (const field of ['rolcanlogin','rolsuper','rolbypassrls','rolcreaterole',
    'rolcreatedb','password_set','can_delete','can_schema_create']) {
    assert.throws(() => checkRole({ ...safeRole(), [field]: true }));
  }
  assert.throws(() => checkRole(null));
  assert.throws(() => checkRole({...safeRole(), can_read:false}));
});

test('fails closed before secret creation when preconditions are unsafe', async () => {
  let creates = 0;
  const db = { query: async () => ({ rows:[{...safeRole(),rolbypassrls:true}] }) };
  const secrets = { createSecret: async () => { creates++; } };
  await assert.rejects(provision({ db, secrets, makePassword: () => goodPassword }));
  assert.equal(creates, 0);
});

test('does not overwrite existing Google secret', async () => {
  let creates = 0;
  const db = {query: async () => ({ rows:[safeRole()] })};
  const secrets = { getSecret:async()=>({}),createSecret:async()=>{creates++;}};
  await assert.rejects(provision({db,secrets,makePassword:()=>goodPassword}), /already exists/);
  assert.equal(creates,0);
});

test('creates secret and verifies custody before login; never returns password', async () => {
  const calls=[];
  const db={query:async (sql)=>{ calls.push('SQL:'+sql.slice(0,14)); return {
    rows:[sql.startsWith('SELECT rolname')?safeRole():{rolcanlogin:true,rolbypassrls:false,password_set:true}]}; }};
  const secrets={
    getSecret:async()=>{const e=new Error('not found');e.code=5;throw e;},
    createSecret:async()=>{calls.push('CREATE_SECRET');},
    addSecretVersion:async()=>{calls.push('ADD_VERSION');},
    accessSecretVersion:async()=>{calls.push('READ_VERSION');return [{payload:{data:Buffer.from(goodPassword)}}];}
  };
  const result=await provision({db,secrets,makePassword:()=>goodPassword});
  assert.equal(result.verified,true);
  assert.equal(JSON.stringify(result).includes(goodPassword),false);
  assert.deepEqual(calls.slice(1,4),['CREATE_SECRET','ADD_VERSION','READ_VERSION']);
  assert.match(calls[4],/^SQL:ALTER ROLE/);
});

test('does not enable login if Secret Manager returns unexpected payload', async () => {
  const calls=[];
  const db={query:async (sql)=>{calls.push(sql);return {rows:[safeRole()]};}};
  const secrets={
    getSecret:async()=>{const e=new Error();e.code=5;throw e;},
    createSecret:async()=>{},
    addSecretVersion:async()=>{},
    accessSecretVersion:async()=>[{payload:{data:Buffer.from('different')}}]
  };
  await assert.rejects(provision({db,secrets,makePassword:()=>goodPassword}), /custody verification/);
  assert.equal(calls.some(x=>x.startsWith('ALTER ROLE')),false);
});

test('database failure after secret custody requests NOLOGIN rollback', async () => {
  const calls=[];
  const db={query:async (sql)=>{
    calls.push(sql);
    if (sql.startsWith('SELECT rolname')) return {rows:[safeRole()]};
    if (sql.includes(' PASSWORD ')) throw new Error('synthetic DB failure');
    return {rows:[]};
  }};
  const secrets={
    getSecret:async()=>{const e=new Error();e.code=5;throw e;},
    createSecret:async()=>{},
    addSecretVersion:async()=>{},
    accessSecretVersion:async()=>[{payload:{data:Buffer.from(goodPassword)}}]
  };
  await assert.rejects(provision({db,secrets,makePassword:()=>goodPassword}), /Database provisioning failed/);
  assert.equal(calls.some(x=>x==='ALTER ROLE oxkio_v3_runtime NOLOGIN'),true);
});
