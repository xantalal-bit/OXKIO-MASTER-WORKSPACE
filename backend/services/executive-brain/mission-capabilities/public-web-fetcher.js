'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

// XATAI CORE V2.1 (03/10/2026): Public Web Fetcher. The only real network
// read of the company-opportunity circuit: one plain HTTPS GET of a public
// web page, with no API key, no account and no paid service. It never
// posts, submits forms, logs in or follows anything but same-rule redirects.
//
// Safety (fail closed):
// - https only, default port, no credentials in the URL;
// - the host must resolve only to public addresses (no localhost, private,
//   link-local, CGNAT, multicast or reserved ranges), checked on every hop;
// - robots.txt is honoured for user-agent "*";
// - bounded time, bounded bytes, text/html or text/plain only.
// Residual risk (documented): DNS can change between the check and the
// connection (rebinding); acceptable for read-only public pages in V2.1.

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'OXKIO-XATAI-Research/2.1 (+read-only; no automated contact)';
const ALLOWED_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)\b/i;

class PublicWebError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PublicWebError';
    this.code = code;
    // Sentinel failure kinds: a tool problem can be retried with another
    // strategy; a refused URL is a permission matter for a human.
    this.failureKind = ['url_not_allowed', 'robots_disallowed', 'private_address'].includes(code)
      ? 'permission' : (code === 'timeout' ? 'timeout' : 'tool_error');
  }
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateIPv4(address);
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd')
      || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')
      || lower.startsWith('ff');
  }
  return true;
}

function parsePublicUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch (error) { throw new PublicWebError('url_not_allowed'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new PublicWebError('url_not_allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || (net.isIP(host) && isPrivateAddress(host)) || !host.includes('.')) {
    throw new PublicWebError('url_not_allowed');
  }
  url.hash = '';
  return url;
}

// robots.txt: only the "User-agent: *" group, Disallow prefixes, Allow
// overrides of equal or longer length. Unreachable robots.txt = allowed.
function robotsAllows(robotsText, path) {
  const lines = String(robotsText || '').split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim());
  let applies = false;
  let inGroup = false;
  const rules = [];
  for (const line of lines) {
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (!inGroup) applies = false;
      inGroup = true;
      if (value === '*') applies = true;
    } else {
      inGroup = false;
      if (applies && (key === 'disallow' || key === 'allow') && value) rules.push({ allow: key === 'allow', prefix: value });
    }
  }
  const matching = rules.filter((rule) => path.startsWith(rule.prefix)).sort((l, r) => r.prefix.length - l.prefix.length);
  return matching.length === 0 || matching[0].allow;
}

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return Object.hasOwn(ENTITIES, entity.toLowerCase()) ? ENTITIES[entity.toLowerCase()] : match;
  });
}

// Canonical form every excerpt is checked against: entities decoded and all
// whitespace collapsed. Extractors quote from this exact text.
function normalizePageText(raw) {
  return decodeEntities(String(raw)).replace(/\s+/g, ' ').trim();
}

function createPublicWebFetcher({
  fetchImpl = globalThis.fetch,
  resolve = (host) => dns.lookup(host, { all: true }),
  now = () => new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');

  async function assertPublicHost(url) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return;
    let records;
    try { records = await resolve(host); } catch (error) { throw new PublicWebError('dns_failed'); }
    const addresses = (Array.isArray(records) ? records : [records]).map((record) => record && record.address).filter(Boolean);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new PublicWebError('private_address');
  }

  async function request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9' },
      });
    } catch (error) {
      throw new PublicWebError(controller.signal.aborted ? 'timeout' : 'network_error');
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBody(response) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new PublicWebError('too_large');
    // Stream with a hard cap so an oversized body is never fully buffered.
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new PublicWebError('too_large');
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new PublicWebError('too_large');
    return text;
  }

  async function robotsAllowed(url) {
    const robotsUrl = new URL('/robots.txt', url.origin);
    try {
      await assertPublicHost(robotsUrl);
      const response = await request(robotsUrl);
      if (!response.ok) return true;
      return robotsAllows(await readBody(response), url.pathname || '/');
    } catch (error) {
      if (error.code === 'private_address') throw error;
      return true;
    }
  }

  async function fetchPage(rawUrl) {
    let url = parsePublicUrl(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(url);
      if (hop === 0 && !(await robotsAllowed(url))) throw new PublicWebError('robots_disallowed');
      const response = await request(url);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new PublicWebError('bad_redirect');
        url = parsePublicUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) throw new PublicWebError(`http_${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!ALLOWED_TYPES.test(contentType)) throw new PublicWebError('unsupported_content_type');
      const raw = await readBody(response);
      return Object.freeze({
        requestedUrl: String(rawUrl),
        url: url.href,
        status: response.status,
        fetchedAt: now(),
        contentType: contentType.split(';')[0].trim().toLowerCase(),
        text: normalizePageText(raw),
      });
    }
    throw new PublicWebError('too_many_redirects');
  }

  return Object.freeze({ fetchPage });
}

module.exports = {
  PublicWebError,
  createPublicWebFetcher,
  isPrivateAddress,
  normalizePageText,
  parsePublicUrl,
  robotsAllows,
};
