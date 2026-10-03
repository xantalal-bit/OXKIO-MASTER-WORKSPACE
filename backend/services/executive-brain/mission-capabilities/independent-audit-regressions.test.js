'use strict';

// Independent audit of PR #22 @ 7ccce24 (AUDIT_RESULT = FAIL): each test
// reproduces a finding exactly as reported and proves it closed. No network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  createHttpsTransport, isPrivateAddress, normalizePageText, normalizeRobotsPath, parseIPv6, robotsAllows,
} = require('./public-web-fetcher');
const { AGENTS, canonicalUnit, scopeOf } = require('./company-opportunity-agents');
const { runCompanyOpportunity } = require('./company-opportunity');
const { submitCommercialReview } = require('./approval-review-adapter');
const ApprovalQueue = require('../../../core/approvalQueue');

const NOW = '2026-10-03T10:00:00.000Z';
const WEBSITE = 'https://www.empresa.es/';
const PROFILE = Object.freeze({
  id: 'test-seller', name: 'Vendedor de prueba', offering: 'Software de gestión.',
  services: [
    { id: 'stock', name: 'Gestión de stock', description: 'Control de stock.', needLabel: 'centralizar el stock', signals: ['stock'], valueStatement: 'Visibilidad del stock.' },
    { id: 'orders', name: 'Pedidos online', description: 'Integración de pedidos.', needLabel: 'integrar pedidos', signals: ['pedidos'], valueStatement: 'Menos trabajo manual.' },
  ],
  prohibitedClaims: ['ahorro garantizado'], scope: 'Diagnóstico.', callToAction: '¿Hablamos?', nextAction: 'Revisar.', signature: 'Equipo',
});
const NO_MATCH = Object.freeze({ ...PROFILE, services: PROFILE.services.map((service) => ({ ...service, signals: ['palabra-inexistente'] })) });
const STOCK_SITE = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Distribución."><p>Gestionamos el stock del almacén.</p>' };

function fetcherFor(pages) {
  return {
    async fetchPage(url) {
      if (!pages[url]) throw Object.assign(new Error('http_404'), { code: 'http_404', failureKind: 'tool_error' });
      return { url, fetchedAt: NOW, text: normalizePageText(pages[url]) };
    },
  };
}

async function mission({ pages = STOCK_SITE, sellerProfile = PROFILE, agentOverrides } = {}) {
  const result = await runCompanyOpportunity({
    target: { company: 'Empresa', website: WEBSITE }, sellerProfile, fetcher: fetcherFor(pages), sourceOrigin: 'fixture',
    memorySearch: async () => [], agentOverrides, now: () => NOW,
  });
  return { ...result, byKey: Object.fromEntries(result.state.tasks.map((task) => [task.key, task])) };
}

const proposalWith = (mutate) => ({ proposal: async (input) => mutate(await AGENTS.proposal(input), input) });

async function assertRejectedEndToEnd(result, label) {
  assert.notEqual(result.byKey.proposal.status, 'COMPLETED', `${label}: proposal`);
  assert.notEqual(result.byKey.communication.status, 'COMPLETED', `${label}: communication`);
  assert.equal(result.review.draft, null, `${label}: draft`);
  assert.equal(result.review.contact.decision, 'NO CONTACTAR TODAVÍA', `${label}: contact`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xatai-audit-'));
  try {
    const queue = new ApprovalQueue({ dataFile: path.join(dir, 'approvals.json') });
    const submitted = await submitCommercialReview({ approvalQueue: queue, review: result.review, recipient: 'compras@empresa.es', missionId: result.state.missionId });
    assert.equal(submitted.submitted, false, `${label}: queue`);
    assert.deepEqual(await queue.listPending(), [], `${label}: queue empty`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================== BLOCKER

test('BLOCKER 1+2: opportunities=[] and proposal invents op:invented with REVIEW_AND_CONTACT -> rejected end to end', async () => {
  const result = await mission({
    sellerProfile: NO_MATCH,
    agentOverrides: proposalWith((real) => ({
      ...real,
      opportunities: [{ opportunityId: 'op:invented', serviceId: 'stock', level: 'OBSERVED', label: 'OBSERVED', need: 'Necesitan un ERP.', text: 'Necesitan un ERP.', solution: 'Gestión de stock' }],
      solution: [{ label: 'RECOMMENDATION', name: 'Gestión de stock', description: 'Control de stock.' }],
      recommendation: 'REVIEW_AND_CONTACT',
    })),
  });
  assert.equal(JSON.parse(result.byKey.opportunities.output).opportunities.length, 0);
  assert.equal(result.state.attempts[result.byKey.proposal.taskId][0].failureCode, 'invalid_output:invented_opportunity');
  await assertRejectedEndToEnd(result, 'invented');
});

test('BLOCKER 2: opportunities=[] and proposal only claims REVIEW_AND_CONTACT -> rejected', async () => {
  const result = await mission({ sellerProfile: NO_MATCH, agentOverrides: proposalWith((real) => ({ ...real, recommendation: 'REVIEW_AND_CONTACT' })) });
  assert.equal(result.state.attempts[result.byKey.proposal.taskId][0].failureCode, 'invalid_output:recommendation_mismatch');
  await assertRejectedEndToEnd(result, 'recommendation');
});

test('BLOCKER 3: a verified opportunity copied exactly -> PASS through communication', async () => {
  const result = await mission();
  assert.equal(result.byKey.proposal.status, 'COMPLETED');
  const upstream = JSON.parse(result.byKey.opportunities.output).opportunities[0];
  const copied = JSON.parse(result.byKey.proposal.output).opportunities[0];
  for (const field of ['serviceId', 'level', 'need', 'basisFactIds', 'evidenceRefs', 'solution', 'expectedBenefit']) {
    assert.deepEqual(copied[field], upstream[field], field);
  }
  assert.equal(copied.opportunityId, upstream.id);
  assert.equal(result.review.contact.decision, 'CONTACTO PROPUESTO PARA REVISIÓN');
  assert.ok(result.review.draft);
});

for (const [label, mutate, code] of [
  ['4 opportunityId changed', (item) => ({ ...item, opportunityId: 'op:99' }), 'invented_opportunity'],
  ['5 serviceId changed', (item) => ({ ...item, serviceId: 'orders' }), 'altered_opportunity_serviceId'],
  ['6 INFERENCE relabelled OBSERVED', (item) => ({ ...item, level: 'OBSERVED', label: 'OBSERVED' }), 'altered_opportunity_level'],
  ['6b label alone relabelled', (item) => ({ ...item, label: 'OBSERVED' }), 'opportunity_relabelled'],
  ['7 basisFactIds invented', (item) => ({ ...item, basisFactIds: [...item.basisFactIds, 'cr:999'] }), 'altered_opportunity_basisFactIds'],
  ['8 evidenceRefs altered', (item) => ({ ...item, evidenceRefs: ['src:mission-x:company-research:1'] }), 'altered_opportunity_evidenceRefs'],
  ['8b solution changed', (item) => ({ ...item, solution: 'Pedidos online' }), 'altered_opportunity_solution'],
]) {
  test(`BLOCKER ${label} -> rejected, no communication, nothing queued`, async () => {
    const result = await mission({
      agentOverrides: proposalWith((real) => ({ ...real, opportunities: real.opportunities.map(mutate) })),
    });
    assert.equal(result.state.attempts[result.byKey.proposal.taskId][0].failureCode, `invalid_output:${code}`);
    await assertRejectedEndToEnd(result, label);
  });
}

test('BLOCKER 9: an opportunity removed upstream but kept by the proposal -> rejected', async () => {
  const reference = await mission();
  const stale = JSON.parse(reference.byKey.proposal.output).opportunities[0];
  const result = await mission({
    agentOverrides: {
      opportunities: async (input) => ({ ...(await AGENTS.opportunities(input)), opportunities: [] }),
      proposal: async (input) => ({ ...(await AGENTS.proposal(input)), opportunities: [stale], recommendation: 'REVIEW_AND_CONTACT' }),
    },
  });
  assert.equal(result.state.attempts[result.byKey.proposal.taskId][0].failureCode, 'invalid_output:invented_opportunity');
  await assertRejectedEndToEnd(result, 'removed upstream');
});

test('TRUST CHAIN: communication cannot introduce or alter an opportunity either', async () => {
  const result = await mission({
    agentOverrides: {
      communication: async (input) => {
        const real = await AGENTS.communication(input);
        const observed = { ...real.salesBriefing.inferences[0], level: 'OBSERVED', label: 'OBSERVED', opportunityId: 'op:new' };
        return { ...real, salesBriefing: { ...real.salesBriefing, observed: [observed] } };
      },
    },
  });
  assert.notEqual(result.byKey.communication.status, 'COMPLETED');
  assert.equal(result.review.draft, null);
});

// ============================================================== P1 robots

test('P1 robots: percent-encoding is normalized (RFC 9309 2.2.2) without double decoding or changing reserved chars', () => {
  const robots = 'User-agent: *\nDisallow: /privado';
  assert.equal(robotsAllows(robots, '/privado'), false);
  assert.equal(robotsAllows(robots, '/%70rivado'), false);
  assert.equal(robotsAllows(robots, '/pri%76ado'), false);
  assert.equal(robotsAllows(robots, '/PRIVADO'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /pri%76ado', '/privado'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a%2Fb', '/a/b'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a%2fb', '/a%2Fb'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a/b', '/a%2Fb'), true);
  assert.equal(normalizeRobotsPath('/%2570rivado'), '/%2570rivado');
  assert.equal(robotsAllows(robots, '/%2570rivado'), true);
  assert.equal(normalizeRobotsPath('/a%zz/%4'), '/a%25zz/%254');
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a%zz', '/a%25zz'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /niño', '/ni%C3%B1o'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*%2e%70df$', '/doc.pdf'), false);
});

// ============================================================== P1 IPv6

test('P1 IPv6: classification is numeric, expanded and compressed forms are the same address', () => {
  assert.deepEqual(parseIPv6('::1'), parseIPv6('0:0:0:0:0:0:0:1'));
  assert.deepEqual(parseIPv6('::'), parseIPv6('0:0:0:0:0:0:0:0'));
  assert.deepEqual(parseIPv6('::ffff:127.0.0.1'), parseIPv6('0:0:0:0:0:ffff:7f00:1'));
  for (const address of [
    '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::0001',
    '::', '0:0:0:0:0:0:0:0',
    'fe80::1', 'FE80::1', 'febf::1', 'fe80::1%eth0', 'fc00::1', 'fdff:ffff::1', 'ff02::1', 'ff0e::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:192.168.1.1',
    '::127.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2001::1', '2002:7f00:1::1', '2002:0a00:0001::1', '100::1', 'fec0::1',
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:93.184.216.34', '2002:5db8:d822::1', '93.184.216.34']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
  for (const address of ['203.0.113.7', '198.51.100.1', '192.0.2.1', '169.254.169.254', '0.0.0.0', 'not-an-ip', '::ffff:999.1.1.1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

// ============================================================== P1 units / P2 scope

function sizeFacts(...excerpts) {
  return excerpts.map((excerpt, index) => ({
    id: `f:${index + 1}`, kind: 'FACT', category: 'size', statement: `La web indica: "${excerpt}"`, excerpt, sourceRef: 'src:x', suspicious: false,
  }));
}
async function contradictionsFor(...excerpts) {
  const result = await AGENTS.analysis({ dependencies: [{ stageKey: 'company-research', data: { facts: sizeFacts(...excerpts), uncertainties: [] } }] });
  return result.contradictions;
}

test('P1 units: bilingual equivalents are compared; different units never are', async () => {
  assert.equal((await contradictionsFor('40 tiendas', '55 stores')).length, 1);
  assert.equal((await contradictionsFor('40 empleados', '55 employees')).length, 1);
  assert.equal((await contradictionsFor('40 trabajadores', '55 employees')).length, 1);
  assert.equal((await contradictionsFor('40 países', '55 countries')).length, 1);
  assert.equal((await contradictionsFor('40 oficinas', '55 offices')).length, 1);
  assert.equal((await contradictionsFor('40 clientes', '55 customers')).length, 1);
  assert.equal((await contradictionsFor('40 almacenes', '55 warehouses')).length, 1);
  assert.equal((await contradictionsFor('40 tiendas', '55 empleados')).length, 0);
  assert.equal((await contradictionsFor('40 tiendas', '55 establecimientos')).length, 0);
  assert.equal((await contradictionsFor('40 sedes', '55 oficinas')).length, 0);
  assert.equal((await contradictionsFor('40 tiendas', '40 stores')).length, 0);
  assert.equal(canonicalUnit('"numberOfEmployees": 120'), 'workforce');
});

test('P2 scope: explicit different places or years are not contradictions; same or unknown scope still is', async () => {
  assert.equal((await contradictionsFor('40 tiendas en España', '55 tiendas en Francia')).length, 0);
  assert.equal((await contradictionsFor('40 tiendas en España', '55 tiendas en España')).length, 1);
  assert.equal((await contradictionsFor('40 tiendas en España', '55 stores in Spain')).length, 1);
  assert.equal((await contradictionsFor('40 tiendas en 2024', '55 tiendas en 2025')).length, 0);
  assert.equal((await contradictionsFor('40 tiendas en 2024', '55 tiendas en 2024')).length, 1);
  // Unknown scope on one side: prudent, still a contradiction.
  assert.equal((await contradictionsFor('40 tiendas en España', '55 tiendas')).length, 1);
  assert.equal((await contradictionsFor('40 tiendas', '55 tiendas')).length, 1);
  assert.deepEqual(scopeOf('40 tiendas en España'), { place: 'es', year: null });
  // The count itself is never read as a year.
  assert.deepEqual(scopeOf('2000 empleados'), { place: null, year: null });
});

test('P1 units end to end: "40 tiendas" on the home page vs "55 stores" on another page is reported', async () => {
  const result = await mission({
    pages: {
      [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Retail."><p>Tenemos 40 tiendas.</p><a href="/empresa">Empresa</a>',
      'https://www.empresa.es/empresa': '<p>We operate 55 stores.</p>',
    },
  });
  assert.equal(result.review.contradictions.length, 1);
  assert.equal(result.review.contradictions[0].unit, 'stores');
});

// ============================================================== P2 transport

function fakeRequest({ respond, onDestroy } = {}) {
  let captured = null;
  const requestImpl = (options, onResponse) => {
    captured = options;
    const request = new EventEmitter();
    request.destroy = (error) => { if (onDestroy) onDestroy(); if (error) setImmediate(() => request.emit('error', error)); };
    request.end = () => { if (respond) setImmediate(() => respond(request, onResponse)); };
    return request;
  };
  return { requestImpl, options: () => captured };
}

function respondWith({ status = 200, headers = { 'content-type': 'text/html' }, chunks = [], streamError = false }) {
  return (request, onResponse) => {
    const response = new EventEmitter();
    response.statusCode = status;
    response.headers = headers;
    response.destroy = () => { response.destroyed = true; };
    onResponse(response);
    for (const chunk of chunks) {
      if (response.destroyed) return;
      response.emit('data', Buffer.from(chunk));
    }
    if (streamError) response.emit('error', new Error('ECONNRESET'));
    else if (!response.destroyed) response.emit('end');
  };
}

const URL_A = new URL('https://www.empresa.es/a?b=1');
const PIN = { address: '93.184.216.34', family: 4 };

async function code(promise) {
  try { await promise; } catch (error) { return error.code; }
  return 'resolved';
}

test('P2 transport (real createHttpsTransport): a response that never arrives times out', async () => {
  let destroyed = false;
  const { requestImpl } = fakeRequest({ onDestroy: () => { destroyed = true; } });
  const transport = createHttpsTransport({ requestImpl });
  assert.equal(await code(transport.request(URL_A, { ...PIN, timeoutMs: 30, maxBytes: 100 })), 'timeout');
  assert.equal(destroyed, true);
});

test('P2 transport (real createHttpsTransport): body over maxBytes (streamed or declared) is too_large; within the limit passes', async () => {
  const streamed = createHttpsTransport({ requestImpl: fakeRequest({ respond: respondWith({ chunks: ['x'.repeat(60), 'x'.repeat(60)] }) }).requestImpl });
  assert.equal(await code(streamed.request(URL_A, { ...PIN, timeoutMs: 1000, maxBytes: 100 })), 'too_large');
  const declared = createHttpsTransport({ requestImpl: fakeRequest({ respond: respondWith({ headers: { 'content-length': '5000' }, chunks: ['x'] }) }).requestImpl });
  assert.equal(await code(declared.request(URL_A, { ...PIN, timeoutMs: 1000, maxBytes: 100 })), 'too_large');
  const fine = createHttpsTransport({ requestImpl: fakeRequest({ respond: respondWith({ chunks: ['<title>', 'ok</title>'] }) }).requestImpl });
  const response = await fine.request(URL_A, { ...PIN, timeoutMs: 1000, maxBytes: 100 });
  assert.deepEqual([response.status, response.body, response.header('content-type')], [200, '<title>ok</title>', 'text/html']);
});

test('P2 transport (real createHttpsTransport): a stream or connection error is network_error', async () => {
  const stream = createHttpsTransport({ requestImpl: fakeRequest({ respond: respondWith({ chunks: ['partial'], streamError: true }) }).requestImpl });
  assert.equal(await code(stream.request(URL_A, { ...PIN, timeoutMs: 1000, maxBytes: 100 })), 'network_error');
  const refused = createHttpsTransport({
    requestImpl: fakeRequest({ respond: (request) => request.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })) }).requestImpl,
  });
  assert.equal(await code(refused.request(URL_A, { ...PIN, timeoutMs: 1000, maxBytes: 100 })), 'network_error');
});

// What this test proves (and what it does not): the request options keep
// TLS certificate verification at Node's default (rejectUnauthorized is
// never set), keep the original host name for SNI and certificate checks,
// disable connection reuse and pin DNS to the validated address. It does
// not run a TLS handshake against a bad certificate: that needs a local
// PKI, which this repository does not ship; Node's default is relied upon.
test('P2 transport options: TLS verification left at the secure default, SNI = original host, DNS pinned, no socket reuse', async () => {
  const { requestImpl, options } = fakeRequest({ respond: respondWith({ chunks: ['ok'] }) });
  await createHttpsTransport({ requestImpl }).request(URL_A, { ...PIN, timeoutMs: 1000, maxBytes: 100 });
  const opts = options();
  assert.equal(Object.hasOwn(opts, 'rejectUnauthorized'), false);
  assert.equal(opts.method, 'GET');
  assert.equal(opts.host, 'www.empresa.es');
  assert.equal(opts.servername, 'www.empresa.es');
  assert.equal(opts.port, 443);
  assert.equal(opts.path, '/a?b=1');
  assert.equal(opts.agent, false);
  opts.lookup('attacker-controlled.example', { all: true }, (error, addresses) => assert.deepEqual(addresses, [{ address: PIN.address, family: 4 }]));
  opts.lookup('attacker-controlled.example', {}, (error, address) => assert.equal(address, PIN.address));
  const source = fs.readFileSync(path.join(__dirname, 'public-web-fetcher.js'), 'utf8');
  assert.doesNotMatch(source, /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/);
});

// ============================================================== self-audit additions

test('SELF-AUDIT: the opportunities stage cannot inflate the need text of an inference', async () => {
  const result = await mission({
    agentOverrides: {
      opportunities: async (input) => {
        const real = await AGENTS.opportunities(input);
        return { ...real, opportunities: real.opportunities.map((item) => ({ ...item, need: 'La empresa necesita urgentemente un ERP.' })) };
      },
    },
  });
  assert.equal(result.state.attempts[result.byKey.opportunities.taskId][0].failureCode, 'invalid_output:opportunity_need_text');
  assert.notEqual(result.byKey.opportunities.status, 'COMPLETED');
  assert.equal(result.review.draft, null);
});

test('SELF-AUDIT: the email cannot pitch a service the proposal did not select', async () => {
  const result = await mission({
    agentOverrides: {
      communication: async (input) => {
        const real = await AGENTS.communication(input);
        return { ...real, email: { ...real.email, body: `${real.email.body}\nTambién os ofrecemos Pedidos online.` } };
      },
    },
  });
  assert.equal(result.state.attempts[result.byKey.communication.taskId][0].failureCode, 'invalid_output:unselected_service');
  assert.equal(result.review.draft, null);
});
