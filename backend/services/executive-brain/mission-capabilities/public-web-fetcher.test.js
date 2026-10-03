'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPublicWebFetcher, isPrivateAddress, normalizePageText, parsePublicUrl, robotsAllows,
} = require('./public-web-fetcher');

// No network: fetch and DNS are injected fakes.
function response({ status = 200, body = '', headers = {} } = {}) {
  const map = new Map(Object.entries({ 'content-type': 'text/html; charset=utf-8', ...headers }));
  return { status, ok: status >= 200 && status < 300, headers: { get: (key) => map.get(key.toLowerCase()) || null }, text: async () => body };
}

function fetcherWith(routes, { resolve = async () => [{ address: '93.184.216.34' }], timeoutMs = 50, maxBytes } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect });
    const route = routes[url];
    if (route === 'hang') return new Promise((resolveHang, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return route ? route() : response({ status: 404 });
  };
  return { fetcher: createPublicWebFetcher({ fetchImpl, resolve, timeoutMs, maxBytes, now: () => '2026-10-03T10:00:00.000Z' }), calls };
}

function code(promise) {
  return promise.then(() => null, (error) => error.code);
}

test('only plain public https URLs are accepted', () => {
  for (const url of ['http://example.com/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'https://localhost/',
    'https://127.0.0.1/', 'https://10.0.0.5/', 'https://printer.local/', 'https://metadata.internal/', 'https://intranet/', 'ftp://example.com/']) {
    assert.throws(() => parsePublicUrl(url), /url_not_allowed/, url);
  }
  assert.equal(parsePublicUrl('https://www.example.com/a#b').href, 'https://www.example.com/a');
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('93.184.216.34'), false);
});

test('a host resolving to a private address is refused (SSRF), as is a redirect to one', async () => {
  const privateDns = fetcherWith({ 'https://example.com/': () => response({ body: '<title>x</title>' }) }, { resolve: async () => [{ address: '10.0.0.8' }] });
  assert.equal(await code(privateDns.fetcher.fetchPage('https://example.com/')), 'private_address');
  assert.equal(privateDns.calls.length, 0);
  const redirect = fetcherWith({ 'https://example.com/': () => response({ status: 302, headers: { location: 'https://127.0.0.1/admin' } }) });
  assert.equal(await code(redirect.fetcher.fetchPage('https://example.com/')), 'url_not_allowed');
});

test('robots.txt is honoured for user-agent *', async () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', '/private/x'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /public', '/public/page'), true);
  assert.equal(robotsAllows('User-agent: otherbot\nDisallow: /', '/'), true);
  const blocked = fetcherWith({
    'https://example.com/robots.txt': () => response({ body: 'User-agent: *\nDisallow: /', headers: { 'content-type': 'text/plain' } }),
    'https://example.com/': () => response({ body: '<title>x</title>' }),
  });
  assert.equal(await code(blocked.fetcher.fetchPage('https://example.com/')), 'robots_disallowed');
  assert.ok(!blocked.calls.some((call) => call.url === 'https://example.com/'));
});

test('a public page is read with GET only, normalized, and redirects are re-validated', async () => {
  const { fetcher, calls } = fetcherWith({
    'https://example.com/': () => response({ status: 301, headers: { location: 'https://www.example.com/' } }),
    'https://www.example.com/': () => response({ body: '<title>ACME &amp; Co</title>\n\n<p>Hola   mundo</p>' }),
  });
  const page = await fetcher.fetchPage('https://example.com/');
  assert.equal(page.url, 'https://www.example.com/');
  assert.equal(page.text, '<title>ACME & Co</title> <p>Hola mundo</p>');
  assert.ok(calls.every((call) => call.method === 'GET' && call.redirect === 'manual'));
  assert.equal(normalizePageText('a&nbsp;&#233;&#x41;'), 'a éA');
});

test('timeouts, oversized bodies, errors and non-text content fail closed with a typed code', async () => {
  const { fetcher } = fetcherWith({
    'https://slow.com/': 'hang',
    'https://big.com/': () => response({ body: 'x'.repeat(2000) }),
    'https://pdf.com/': () => response({ body: '%PDF', headers: { 'content-type': 'application/pdf' } }),
    'https://down.com/': () => response({ status: 503 }),
  }, { maxBytes: 1000 });
  const errorOf = (url) => fetcher.fetchPage(url).then(() => null, (error) => error);
  const slow = await errorOf('https://slow.com/');
  assert.deepEqual([slow.code, slow.failureKind], ['timeout', 'timeout']);
  assert.equal((await errorOf('https://big.com/')).code, 'too_large');
  assert.equal((await errorOf('https://pdf.com/')).code, 'unsupported_content_type');
  const down = await errorOf('https://down.com/');
  assert.deepEqual([down.code, down.failureKind], ['http_503', 'tool_error']);
  const refused = await errorOf('http://down.com/');
  assert.equal(refused.failureKind, 'permission');
});
