'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

// XATAI CORE V2.1: Public Web Fetcher. The only real network read of the
// company-opportunity circuit: plain HTTPS GETs of public pages of ONE
// authorized site, with no API key, no account and no paid service. It
// never posts, submits forms or logs in.
//
// Every hop (first request and each redirect) is re-checked, fail closed:
// - https only, port 443, no credentials in the URL;
// - the host belongs to the authorized site (exact host, or its www /
//   non-www twin; never a suffix match) — otherwise `off_site_url` on the
//   first hop and `off_site_redirect` on a redirect, which is not followed;
// - DNS is resolved once per hop and every address must be public; the
//   connection is then PINNED to that validated address (custom lookup),
//   so a second resolution can never send it to localhost, a private or
//   link-local network or a metadata service (DNS rebinding). TLS is still
//   verified against the host name;
// - robots.txt (RFC 9309 subset) is checked for the exact URL being read,
//   on every hop: 2xx rules apply, 4xx means allowed, 5xx / network error /
//   off-site robots redirect means "assume disallowed";
// - bounded time, bounded bytes, text/html or text/plain only.

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_ROBOTS_REDIRECTS = 5;
const ROBOTS_MAX_BYTES = 512 * 1024;
const ROBOTS_TOKEN = 'oxkio-xatai-research';
const USER_AGENT = 'OXKIO-XATAI-Research/2.1 (+read-only; no automated contact)';
const ALLOWED_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)\b/i;
// Refused destinations are a permission matter (never retried); an
// unreachable robots.txt (5xx, network) is a transient tool failure: reading
// stays forbidden, but the Sentinel may retry before asking a human.
const PERMISSION_CODES = new Set([
  'url_not_allowed', 'off_site_url', 'off_site_redirect', 'robots_disallowed', 'private_address',
]);

class PublicWebError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PublicWebError';
    this.code = code;
    // Sentinel failure kinds: a tool problem can be retried with another
    // strategy; a refused destination is a permission matter for a human.
    this.failureKind = PERMISSION_CODES.has(code) ? 'permission' : (code === 'timeout' ? 'timeout' : 'tool_error');
  }
}

// ------------------------------------------------------------ addresses

// Classification works on numbers, never on text prefixes: IPv4 as four
// octets, IPv6 parsed into eight 16-bit groups (so "::1",
// "0:0:0:0:0:0:0:1" and "0000::0001" are the same address).
function isPrivateIPv4Octets([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function parseIPv4(address) {
  if (!net.isIPv4(address)) return null;
  return address.split('.').map(Number);
}

// Returns eight 16-bit groups, or null when the text is not a valid IPv6.
function parseIPv6(address) {
  let text = String(address).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!net.isIPv6(text)) return null;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const octets = parseIPv4(tail[1]);
    if (!octets) return null;
    text = `${text.slice(0, -tail[1].length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [head, rest] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = rest === null ? [] : (rest ? rest.split(':') : []);
  const missing = 8 - left.length - right.length;
  if (rest === null ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array(rest === null ? 0 : missing).fill('0'), ...right].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function embeddedIPv4(groups, from) {
  return [groups[from] >> 8, groups[from] & 0xff, groups[from + 1] >> 8, groups[from + 1] & 0xff];
}

function isPrivateIPv6Groups(g) {
  const zeroUntil = (index) => g.slice(0, index).every((group) => group === 0);
  if (g.every((group) => group === 0)) return true; // :: unspecified
  if (zeroUntil(7) && g[7] === 1) return true; // ::1 loopback
  if (zeroUntil(5) && g[5] === 0xffff) return isPrivateIPv4Octets(embeddedIPv4(g, 6)); // ::ffff:a.b.c.d mapped
  if (zeroUntil(6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:a.b.c.d translated
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x2001 && g[1] < 0x200) return true; // 2001::/23 IETF special purpose (incl. Teredo 2001::/32)
  if (g[0] === 0x2002) return isPrivateIPv4Octets(embeddedIPv4(g, 1)); // 6to4 embeds an IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isPrivateAddress(address) {
  const v4 = parseIPv4(address);
  if (v4) return isPrivateIPv4Octets(v4);
  const v6 = parseIPv6(address);
  if (v6) return isPrivateIPv6Groups(v6);
  return true; // anything unparseable is refused
}

// ------------------------------------------------------------ site policy

function hostKey(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

// A site is one host and its www twin. No suffix logic: "evil-empresa.es",
// "empresa.es.evil.com" or "sub.empresa.es" are NOT the site "empresa.es".
function siteOf(hostname) {
  const key = hostKey(hostname);
  return key.startsWith('www.') ? key.slice(4) : key;
}

function sameSite(left, right) {
  const a = siteOf(left);
  return a.length > 0 && a === siteOf(right);
}

function parsePublicUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch (error) { throw new PublicWebError('url_not_allowed'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new PublicWebError('url_not_allowed');
  }
  const host = hostKey(url.hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || (net.isIP(host) && isPrivateAddress(host)) || (!net.isIP(host) && !host.includes('.'))) {
    throw new PublicWebError('url_not_allowed');
  }
  url.hash = '';
  return url;
}

// ------------------------------------------------------------ robots.txt

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      // Consecutive user-agent lines share one group; a user-agent line
      // after rules starts a new group.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return groups;
}

// RFC 9309 §2.2.2: rules and paths are compared after the same
// percent-encoding normalization, in a single pass (no double decoding):
// - %XX of an unreserved character (A-Z a-z 0-9 - . _ ~) is decoded,
//   so "/%70rivado" and "/privado" are the same path;
// - any other %XX keeps its encoding with upper-case hex, so reserved
//   characters keep their meaning ("%2F" never becomes "/");
// - non-ASCII characters are percent-encoded as UTF-8;
// - a malformed "%" (not followed by two hex digits) is encoded as "%25",
//   identically in rules and paths, so it can never match a different
//   resource by accident.
const UNRESERVED = /[A-Za-z0-9\-._~]/;

function normalizeRobotsPath(value) {
  let out = '';
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '%') {
      const hex = text.slice(index + 1, index + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        const decoded = String.fromCharCode(parseInt(hex, 16));
        out += UNRESERVED.test(decoded) ? decoded : `%${hex.toUpperCase()}`;
        index += 2;
      } else {
        out += '%25';
      }
    } else if (char.charCodeAt(0) > 0x7e || char.charCodeAt(0) < 0x21) {
      out += encodeURIComponent(char);
    } else {
      out += char;
    }
  }
  return out;
}

function patternMatches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*').map((part) => normalizeRobotsPath(part).replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(normalizeRobotsPath(path));
}

// RFC 9309: the group naming our product token wins over "*"; among the
// matching rules the longest pattern wins; on a tie, allow wins. An empty
// Disallow allows everything. /robots.txt itself is always allowed.
function robotsAllows(robotsText, path, token = ROBOTS_TOKEN) {
  if (path === '/robots.txt') return true;
  const groups = parseRobots(robotsText);
  const own = groups.filter((group) => group.agents.some((agent) => agent !== '*' && token.startsWith(agent)));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
  const matching = chosen.flatMap((group) => group.rules)
    .filter((rule) => rule.pattern && patternMatches(rule.pattern, path));
  if (matching.length === 0) return true;
  matching.sort((l, r) => (r.pattern.length - l.pattern.length) || (Number(r.allow) - Number(l.allow)));
  return matching[0].allow;
}

// ------------------------------------------------------------ transport

function normalizePageText(raw) {
  return decodeEntities(String(raw)).replace(/\s+/g, ' ').trim();
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

// The connection goes to exactly this validated address, whatever DNS says
// later. Supports both lookup call shapes (single address or `all`).
function pinnedLookup(address, family) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    if (opts.all) done(null, [{ address, family }]);
    else done(null, address, family);
  };
}

// One HTTPS GET to a pinned address, no redirects followed, body capped.
function createHttpsTransport({ requestImpl = https.request } = {}) {
  return Object.freeze({
    request(url, { address, family, timeoutMs, maxBytes }) {
      return new Promise((resolvePromise, rejectPromise) => {
        let timer = null;
        const resolve = (value) => { clearTimeout(timer); resolvePromise(value); };
        const reject = (error) => { clearTimeout(timer); rejectPromise(error); };
        const host = hostKey(url.hostname);
        const request = requestImpl({
          method: 'GET',
          host,
          servername: net.isIP(host) ? undefined : host,
          port: 443,
          path: `${url.pathname}${url.search}`,
          agent: false,
          lookup: pinnedLookup(address, family),
          timeout: timeoutMs,
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9', 'accept-encoding': 'identity' },
        }, (response) => {
          const declared = Number(response.headers['content-length']);
          if (Number.isFinite(declared) && declared > maxBytes) {
            response.destroy();
            reject(new PublicWebError('too_large'));
            return;
          }
          const chunks = [];
          let total = 0;
          response.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
              response.destroy();
              reject(new PublicWebError('too_large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({
            status: response.statusCode,
            header: (name) => {
              const value = response.headers[name.toLowerCase()];
              return Array.isArray(value) ? value[0] : (value || null);
            },
            body: Buffer.concat(chunks).toString('utf8'),
          }));
          response.on('error', () => reject(new PublicWebError('network_error')));
        });
        // Idle timeout from Node plus a hard deadline for the whole request.
        timer = setTimeout(() => request.destroy(new PublicWebError('timeout')), timeoutMs);
        request.on('timeout', () => request.destroy(new PublicWebError('timeout')));
        request.on('error', (error) => reject(error instanceof PublicWebError ? error : new PublicWebError('network_error')));
        request.end();
      });
    },
  });
}

// ------------------------------------------------------------ fetcher

function createPublicWebFetcher({
  transport = createHttpsTransport(),
  resolve = (host) => dns.lookup(host, { all: true }),
  now = () => new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!transport || typeof transport.request !== 'function') throw new TypeError('transport required');
  const robotsCache = new Map();

  // Resolve once and validate every address; the request is pinned to it.
  async function pinnedAddress(url) {
    const host = hostKey(url.hostname);
    if (net.isIP(host)) {
      if (isPrivateAddress(host)) throw new PublicWebError('private_address');
      return { address: host, family: net.isIP(host) };
    }
    let records;
    try { records = await resolve(host); } catch (error) { throw new PublicWebError('dns_failed'); }
    const list = (Array.isArray(records) ? records : [records]).filter((record) => record && record.address);
    if (list.length === 0 || list.some((record) => isPrivateAddress(record.address))) throw new PublicWebError('private_address');
    return { address: list[0].address, family: list[0].family || net.isIP(list[0].address) };
  }

  async function get(url, limit = maxBytes) {
    const pin = await pinnedAddress(url);
    return transport.request(url, { ...pin, timeoutMs, maxBytes: limit });
  }

  // robots.txt of one origin, following redirects only inside the site.
  async function robotsFor(url, allowedSite) {
    const origin = url.origin;
    if (robotsCache.has(origin)) return robotsCache.get(origin);
    let target = new URL('/robots.txt', origin);
    let outcome = { available: false, text: '' };
    try {
      for (let hop = 0; hop <= MAX_ROBOTS_REDIRECTS; hop += 1) {
        const response = await get(target, ROBOTS_MAX_BYTES);
        if (response.status >= 300 && response.status < 400) {
          const location = response.header('location');
          if (!location) break;
          const next = parsePublicUrl(new URL(location, target).href);
          if (!sameSite(next.hostname, allowedSite)) break;
          target = next;
          continue;
        }
        if (response.status >= 200 && response.status < 300) outcome = { available: true, text: response.body };
        else if (response.status >= 400 && response.status < 500) outcome = { available: true, text: '' };
        break;
      }
    } catch (error) {
      // A refused destination is reported as such (never as "robots
      // unavailable"), and is not cached as an answer for the origin.
      if (error instanceof PublicWebError && PERMISSION_CODES.has(error.code)) throw error;
      outcome = { available: false, text: '' };
    }
    robotsCache.set(origin, outcome);
    return outcome;
  }

  async function assertRobots(url, allowedSite) {
    const robots = await robotsFor(url, allowedSite);
    if (!robots.available) throw new PublicWebError('robots_unavailable');
    if (!robotsAllows(robots.text, `${url.pathname}${url.search}`)) throw new PublicWebError('robots_disallowed');
  }

  // fetchPage(url, { allowedSite }): allowedSite is mandatory; every hop
  // must stay inside it.
  async function fetchPage(rawUrl, { allowedSite } = {}) {
    if (typeof allowedSite !== 'string' || !siteOf(allowedSite)) throw new PublicWebError('url_not_allowed');
    let url = parsePublicUrl(rawUrl);
    if (!sameSite(url.hostname, allowedSite)) throw new PublicWebError('off_site_url');
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertRobots(url, allowedSite);
      const response = await get(url);
      if (response.status >= 300 && response.status < 400) {
        const location = response.header('location');
        if (!location) throw new PublicWebError('bad_redirect');
        const next = parsePublicUrl(new URL(location, url).href);
        if (!sameSite(next.hostname, allowedSite)) throw new PublicWebError('off_site_redirect');
        url = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new PublicWebError(`http_${response.status}`);
      const contentType = response.header('content-type') || '';
      if (!ALLOWED_TYPES.test(contentType)) throw new PublicWebError('unsupported_content_type');
      return Object.freeze({
        requestedUrl: String(rawUrl),
        url: url.href,
        status: response.status,
        fetchedAt: now(),
        contentType: contentType.split(';')[0].trim().toLowerCase(),
        text: normalizePageText(response.body),
      });
    }
    throw new PublicWebError('too_many_redirects');
  }

  return Object.freeze({ fetchPage });
}

module.exports = {
  PublicWebError,
  ROBOTS_TOKEN,
  createHttpsTransport,
  createPublicWebFetcher,
  isPrivateAddress,
  normalizePageText,
  normalizeRobotsPath,
  parseIPv6,
  parsePublicUrl,
  parseRobots,
  pinnedLookup,
  robotsAllows,
  sameSite,
  siteOf,
};
