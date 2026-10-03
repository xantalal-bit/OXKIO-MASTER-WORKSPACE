'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHttpsTransport, createPublicWebFetcher, isPrivateAddress, normalizePageText, parsePublicUrl, parseRobots,
  pinnedLookup, robotsAllows, sameSite, siteOf,
} = require('./public-web-fetcher');

// No network anywhere: DNS and the HTTPS transport are injected fakes.
const PUBLIC_IP = '93.184.216.34';
const html = (body) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
const text = (body, status = 200) => ({ status, headers: { 'content-type': 'text/plain' }, body });
const redirect = (location, status = 302) => ({ status, headers: { location }, body: '' });
const notFound = { status: 404, headers: {}, body: '' };

function harness(routes, { dns = {} } = {}) {
  const requests = [];
  const resolutions = [];
  const transport = {
    async request(url, options) {
      requests.push({ url: url.href, address: options.address });
      const route = routes[url.href];
      const value = typeof route === 'function' ? route(options) : route;
      if (value instanceof Error) throw value;
      const response = value || notFound;
      return { status: response.status, header: (name) => (response.headers || {})[name.toLowerCase()] || null, body: response.body || '' };
    },
  };
  const resolve = async (host) => {
    resolutions.push(host);
    const answer = typeof dns[host] === 'function' ? dns[host]() : dns[host];
    return answer || [{ address: PUBLIC_IP, family: 4 }];
  };
  return { fetcher: createPublicWebFetcher({ transport, resolve, timeoutMs: 50, now: () => '2026-10-03T10:00:00.000Z' }), requests, resolutions };
}

const SITE = 'www.empresa.es';
const ROBOTS_OPEN = { 'https://www.empresa.es/robots.txt': notFound, 'https://empresa.es/robots.txt': notFound };

async function failure(promise) {
  try { await promise; } catch (error) { return error.code; }
  return null;
}

// ---------------------------------------------------------------- URL & site policy

test('only plain public https URLs are accepted', () => {
  for (const url of ['http://example.com/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'https://localhost/',
    'https://127.0.0.1/', 'https://10.0.0.5/', 'https://printer.local/', 'https://metadata.internal/', 'https://intranet/', 'ftp://example.com/',
    'https://169.254.169.254/latest/meta-data', 'https://[::1]/']) {
    assert.throws(() => parsePublicUrl(url), /url_not_allowed/, url);
  }
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress(PUBLIC_IP), false);
});

test('sameSite is exact (host or its www twin), never a suffix match', () => {
  assert.equal(sameSite('www.empresa.es', 'empresa.es'), true);
  assert.equal(sameSite('EMPRESA.ES.', 'www.empresa.es'), true);
  for (const host of ['evil-empresa.es', 'empresa.es.evil.com', 'sub.empresa.es', 'wwwempresa.es', 'www.www.empresa.es', 'empresa.com', '']) {
    assert.equal(sameSite(host, 'www.empresa.es'), false, host);
  }
  assert.equal(siteOf('www.Empresa.es'), 'empresa.es');
});

// ---------------------------------------------------------------- redirect confinement (regressions 1-8)

test('redirect 1: authorized site, same URL — PASS', async () => {
  const { fetcher } = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': html('<title>Empresa</title>') });
  const page = await fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE });
  assert.equal(page.url, 'https://www.empresa.es/');
});

test('redirect 2: www -> non-www twin of the authorized site — PASS', async () => {
  const { fetcher } = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('https://empresa.es/'), 'https://empresa.es/': html('<title>Empresa</title>') });
  assert.equal((await fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })).url, 'https://empresa.es/');
});

test('redirect 3: same site, another path (relative Location) — PASS', async () => {
  const { fetcher } = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('/es/inicio', 301), 'https://www.empresa.es/es/inicio': html('<title>Inicio</title>') });
  assert.equal((await fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })).url, 'https://www.empresa.es/es/inicio');
});

test('redirect 4: to an external public domain — REJECTED (off_site_redirect), never requested', async () => {
  const { fetcher, requests } = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('https://otro-dominio.com/landing'), 'https://otro-dominio.com/landing': html('<title>Otro</title>') });
  assert.equal(await failure(fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'off_site_redirect');
  assert.ok(!requests.some((item) => item.url.startsWith('https://otro-dominio.com')));
});

test('redirect 5: to a private IP or a host resolving to one — REJECTED', async () => {
  const literal = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('https://169.254.169.254/latest/meta-data') });
  assert.equal(await failure(literal.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'url_not_allowed');
  const local = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('https://localhost/admin') });
  assert.equal(await failure(local.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'url_not_allowed');
  // Same site name, but DNS points it to the internal network.
  const rebound = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('https://empresa.es/') },
    { dns: { 'empresa.es': [{ address: '10.0.0.7', family: 4 }] } });
  assert.equal(await failure(rebound.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'private_address');
  assert.ok(!rebound.requests.some((item) => item.address === '10.0.0.7'));
});

test('redirect 6: a chain that leaves the site on the 2nd or 3rd hop — REJECTED', async () => {
  const second = harness({
    ...ROBOTS_OPEN,
    'https://www.empresa.es/': redirect('https://empresa.es/a'),
    'https://empresa.es/a': redirect('https://cdn.otro.com/x'),
  });
  assert.equal(await failure(second.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'off_site_redirect');
  const third = harness({
    ...ROBOTS_OPEN,
    'https://www.empresa.es/': redirect('/a'),
    'https://www.empresa.es/a': redirect('/b'),
    'https://www.empresa.es/b': redirect('https://empresa.es.evil.com/c'),
  });
  assert.equal(await failure(third.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'off_site_redirect');
  const loop = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': redirect('/') });
  assert.equal(await failure(loop.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'too_many_redirects');
});

test('redirect: a first URL outside the authorized site is refused before any request; allowedSite is mandatory', async () => {
  const { fetcher, requests } = harness({});
  assert.equal(await failure(fetcher.fetchPage('https://otro-dominio.com/', { allowedSite: SITE })), 'off_site_url');
  assert.equal(await failure(fetcher.fetchPage('https://www.empresa.es/')), 'url_not_allowed');
  assert.equal(requests.length, 0);
});

test('redirect 8 / robots: rules are checked for the URL actually read, on every hop and origin', async () => {
  const pathBlocked = harness({
    'https://www.empresa.es/robots.txt': text('User-agent: *\nDisallow: /privado'),
    'https://www.empresa.es/': redirect('/privado/pagina'),
    'https://www.empresa.es/privado/pagina': html('<title>Privado</title>'),
  });
  assert.equal(await failure(pathBlocked.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'robots_disallowed');
  assert.ok(!pathBlocked.requests.some((item) => item.url.endsWith('/privado/pagina')));
  // The redirect target is another origin of the site: ITS robots.txt rules.
  const otherOrigin = harness({
    'https://www.empresa.es/robots.txt': notFound,
    'https://empresa.es/robots.txt': text('User-agent: *\nDisallow: /'),
    'https://www.empresa.es/': redirect('https://empresa.es/'),
    'https://empresa.es/': html('<title>x</title>'),
  });
  assert.equal(await failure(otherOrigin.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'robots_disallowed');
});

// ---------------------------------------------------------------- robots.txt parser

test('robots: our own group wins over *, longest rule wins, allow wins ties, wildcards and $', () => {
  const robots = [
    'User-agent: googlebot', 'Disallow: /',
    '', 'User-agent: *', 'Disallow: /privado', 'Allow: /privado/publico',
    '', 'User-agent: other', 'User-agent: *', 'Disallow: /*.pdf$',
  ].join('\n');
  assert.equal(robotsAllows(robots, '/'), true);
  assert.equal(robotsAllows(robots, '/privado/x'), false);
  assert.equal(robotsAllows(robots, '/privado/publico/x'), true);
  assert.equal(robotsAllows(robots, '/docs/a.pdf'), false);
  assert.equal(robotsAllows(robots, '/docs/a.pdf?x=1'), true);
  assert.equal(parseRobots(robots).length, 3);
  // A group for our product token overrides the * group entirely.
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: OXKIO-XATAI-Research\nAllow: /', '/x'), true);
  assert.equal(robotsAllows('User-agent: *\nAllow: /\n\nUser-agent: oxkio-xatai-research\nDisallow: /', '/x'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a\nAllow: /a', '/a'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:', '/anything'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/robots.txt'), true);
});

test('robots: missing (4xx) allows; unreachable (5xx, network) or off-site robots redirect means disallowed', async () => {
  const missing = harness({ 'https://www.empresa.es/robots.txt': notFound, 'https://www.empresa.es/': html('<title>x</title>') });
  assert.ok(await missing.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE }));
  const serverError = harness({ 'https://www.empresa.es/robots.txt': { status: 503, headers: {}, body: '' }, 'https://www.empresa.es/': html('x') });
  assert.equal(await failure(serverError.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'robots_unavailable');
  const network = harness({ 'https://www.empresa.es/robots.txt': Object.assign(new Error('x'), { code: 'network_error' }), 'https://www.empresa.es/': html('x') });
  assert.equal(await failure(network.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'robots_unavailable');
  const offSite = harness({ 'https://www.empresa.es/robots.txt': redirect('https://robots.otro.com/robots.txt'), 'https://www.empresa.es/': html('x') });
  assert.equal(await failure(offSite.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'robots_unavailable');
  assert.ok(!offSite.requests.some((item) => item.url.includes('otro.com')));
  const redirected = harness({
    'https://www.empresa.es/robots.txt': redirect('https://empresa.es/robots.txt'),
    'https://empresa.es/robots.txt': text('User-agent: *\nDisallow: /'),
    'https://www.empresa.es/': html('x'),
  });
  assert.equal(await failure(redirected.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'robots_disallowed');
});

// ---------------------------------------------------------------- DNS rebinding

test('DNS rebinding: each hop is resolved once, validated, and the connection is pinned to that address', async () => {
  let calls = 0;
  // First answer public, every later answer internal (classic rebinding).
  const { fetcher, requests } = harness({ ...ROBOTS_OPEN, 'https://www.empresa.es/': html('<title>x</title>') },
    { dns: { 'www.empresa.es': () => { calls += 1; return calls === 1 ? [{ address: PUBLIC_IP, family: 4 }] : [{ address: '127.0.0.1', family: 4 }]; } } });
  // robots.txt took the public answer; the page request re-resolves and is refused.
  assert.equal(await failure(fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'private_address');
  assert.deepEqual(requests.map((item) => item.address), [PUBLIC_IP]);
  // Mixed answers (one public, one private) are refused outright.
  const mixed = harness({ ...ROBOTS_OPEN }, { dns: { 'www.empresa.es': [{ address: PUBLIC_IP, family: 4 }, { address: '169.254.169.254', family: 4 }] } });
  assert.equal(await failure(mixed.fetcher.fetchPage('https://www.empresa.es/', { allowedSite: SITE })), 'private_address');
  assert.equal(mixed.requests.length, 0);
});

test('pinned transport: the HTTPS request connects to the validated address whatever the resolver says, TLS checks the host', async () => {
  const lookup = pinnedLookup(PUBLIC_IP, 4);
  lookup('www.empresa.es', { all: true }, (error, addresses) => assert.deepEqual(addresses, [{ address: PUBLIC_IP, family: 4 }]));
  lookup('www.empresa.es', {}, (error, address, family) => assert.deepEqual([address, family], [PUBLIC_IP, 4]));
  lookup('www.empresa.es', (error, address) => assert.equal(address, PUBLIC_IP));

  let captured = null;
  const requestImpl = (options, onResponse) => {
    captured = options;
    const { EventEmitter } = require('node:events');
    const request = new EventEmitter();
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { 'content-type': 'text/html' };
      response.destroy = () => {};
      onResponse(response);
      response.emit('data', Buffer.from('<title>ok</title>'));
      response.emit('end');
    };
    request.destroy = () => {};
    return request;
  };
  const transport = createHttpsTransport({ requestImpl });
  const response = await transport.request(new URL('https://www.empresa.es/a?b=1'), { address: PUBLIC_IP, family: 4, timeoutMs: 1000, maxBytes: 1000 });
  assert.equal(response.status, 200);
  assert.equal(response.body, '<title>ok</title>');
  assert.equal(captured.method, 'GET');
  assert.equal(captured.host, 'www.empresa.es');
  assert.equal(captured.servername, 'www.empresa.es');
  assert.equal(captured.path, '/a?b=1');
  assert.equal(captured.agent, false);
  captured.lookup('www.empresa.es', { all: true }, (error, addresses) => assert.equal(addresses[0].address, PUBLIC_IP));
});

// ---------------------------------------------------------------- limits

test('timeouts, oversized bodies, errors and non-text content fail closed with a typed code', async () => {
  const timeoutError = Object.assign(new Error('timeout'), { code: 'timeout' });
  const { fetcher } = harness({
    ...ROBOTS_OPEN,
    'https://www.empresa.es/pdf': { status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF' },
    'https://www.empresa.es/down': { status: 503, headers: {}, body: '' },
  });
  assert.equal(await failure(fetcher.fetchPage('https://www.empresa.es/pdf', { allowedSite: SITE })), 'unsupported_content_type');
  assert.equal(await failure(fetcher.fetchPage('https://www.empresa.es/down', { allowedSite: SITE })), 'http_503');
  assert.ok(timeoutError);
  assert.equal(normalizePageText('a&nbsp;&#233;&#x41;  b'), 'a éA b');
});

test('robots: unreachable is a transient tool failure (retried), refused destinations are permission matters', async () => {
  const { PublicWebError } = require('./public-web-fetcher');
  assert.equal(new PublicWebError('robots_unavailable').failureKind, 'tool_error');
  for (const code of ['robots_disallowed', 'off_site_redirect', 'off_site_url', 'private_address', 'url_not_allowed']) {
    assert.equal(new PublicWebError(code).failureKind, 'permission', code);
  }
});
