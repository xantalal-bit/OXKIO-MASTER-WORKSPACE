'use strict';
// Real node-postgres sockets against a minimal PostgreSQL TLS front end (like
// Neon's proxy: TLS ends before the backend, so pg_stat_ssl would say false).
// Certificates are generated per run with openssl; no key is stored in the repo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { verifyClientTls, PLAINTEXT_SAFETY_SQL } = require('./provision-v3-pg-secret');
const { preflight } = require('./preflight-v3-pg-node');
const guards = require('./provision-v3-pg-secret');

function makeCerts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-tls-'));
  const run = (args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '1',
    '-subj', '/CN=oxkio-test-ca', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  const leaf = (name, dns, signed) => {
    fs.writeFileSync(path.join(dir, name + '.ext'), `subjectAltName=DNS:${dns}\n`);
    if (signed) {
      run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + dns]);
      run(['x509', '-req', '-in', name + '.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
        '-out', name + '.crt', '-days', '1', '-extfile', name + '.ext']);
    } else {
      run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.crt', '-days', '1',
        '-subj', '/CN=' + dns, '-addext', 'subjectAltName=DNS:' + dns]);
    }
    return { key: read(name + '.key'), cert: read(name + '.crt') };
  };
  const certs = { ca: read('ca.crt'), localhost: leaf('good', 'localhost', true),
    otherHost: leaf('other', 'other.example', true), selfSigned: leaf('self', 'localhost', false) };
  fs.rmSync(dir, { recursive: true, force: true });
  return certs;
}

let certs = null;
try { certs = makeCerts(); } catch { certs = null; }
const skip = certs ? false : 'openssl not available';

// Answers SSLRequest with 'S' (TLS with the given identity) or 'N', then
// authenticates any startup message and reports ReadyForQuery.
async function pgFrontEnd(identity) {
  const ready = Buffer.concat([
    Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]), // AuthenticationOk
    Buffer.from([0x5a, 0, 0, 0, 5, 0x49])         // ReadyForQuery (idle)
  ]);
  const speak = (sock) => {
    sock.on('error', () => {});
    sock.once('data', () => sock.write(ready));
  };
  const server = net.createServer((raw) => {
    raw.on('error', () => {});
    raw.once('data', (buf) => {
      const sslRequest = buf.length === 8 && buf.readInt32BE(4) === 80877103;
      if (!sslRequest) { raw.write(ready); return; }
      if (!identity) { raw.write('N'); speak(raw); return; }
      raw.write('S');
      speak(new tls.TLSSocket(raw, { isServer: true, ...identity }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

async function connect(t, identity, ssl) {
  const fe = await pgFrontEnd(identity);
  const client = new Client({ host: 'localhost', port: fe.port, user: 'x', database: 'x', ssl });
  client.on('error', () => {});
  t.after(async () => { client.connection.stream.destroy(); await fe.close(); });
  await client.connect();
  return client;
}

test('real socket: CA-verified certificate for the requested host passes', { skip }, async (t) => {
  const client = await connect(t, certs.localhost, { ca: certs.ca, rejectUnauthorized: true });
  verifyClientTls(client, 'localhost');
  assert.throws(() => verifyClientTls(client, 'ep-other.neon.tech'), /Client TLS is not verified/);
});

test('real socket: Neon-like proxy (pg_stat_ssl=false) still yields tls PASS on a verified socket', { skip }, async (t) => {
  const client = await connect(t, certs.localhost, { ca: certs.ca, rejectUnauthorized: true });
  const db = { connection: client.connection, query: async (sql) => {
    if (sql === PLAINTEXT_SAFETY_SQL) return { rows: [{ server_tls: false, log_statement: 'none', log_min_duration_statement: '-1',
      log_min_duration_sample: '-1', log_transaction_sample_rate: '0', log_parameter_max_length_on_error: '0', pgss: false, pgss_track: null }] };
    if (sql === guards.ROLE_STATE_SQL) return { rows: [{ rolname: 'oxkio_v3_runtime', rolcanlogin: false, schema_usage: true,
      can_read: true, can_write: true, can_update: true }] };
    return { rows: [] };
  } };
  const result = await preflight(db, guards, { expectedHost: 'localhost' });
  assert.deepEqual({ status: result.status, tls: result.tls, serverReportedTls: result.serverReportedTls, gate: result.sessionLoggingGate },
    { status: 'DB_PREFLIGHT_PASS_ONLY', tls: 'PASS', serverReportedTls: false, gate: 'PASS' });
});

test('real socket: certificate for another host is refused by the handshake and by the guard', { skip }, async (t) => {
  await assert.rejects(connect(t, certs.otherHost, { ca: certs.ca, rejectUnauthorized: true }), /localhost|altnames|Hostname/i);
  const lax = await connect(t, certs.otherHost, { ca: certs.ca, rejectUnauthorized: false });
  assert.throws(() => verifyClientTls(lax, 'localhost'), /Client TLS is not verified/);
});

test('real socket: untrusted self-signed certificate is refused by the handshake and by the guard', { skip }, async (t) => {
  await assert.rejects(connect(t, certs.selfSigned, { rejectUnauthorized: true }), /self[- ]signed/i);
  const lax = await connect(t, certs.selfSigned, { rejectUnauthorized: false });
  assert.equal(lax.connection.stream.encrypted, true);
  assert.throws(() => verifyClientTls(lax, 'localhost'), /Client TLS is not verified/);
});

test('real socket: a server without TLS is refused by the client and by the guard', { skip }, async (t) => {
  await assert.rejects(connect(t, null, { ca: certs.ca, rejectUnauthorized: true }), /does not support SSL/);
  const plain = await connect(t, null, false);
  assert.throws(() => verifyClientTls(plain, 'localhost'), /Client TLS is not verified/);
});
