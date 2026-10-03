'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');
const { fail } = require('./scope-session');
// Persisted V3 records are trusted only when their MAC verifies. The key is
// injected by the composition root (a registered secret in production, an
// ephemeral key in tests) and is never written next to the data it protects.
const MIN_KEY_BYTES = 32;
function createHmacIntegrity({ key, keyId = 'v3-hmac-1' } = {}) {
 const material = Buffer.isBuffer(key) ? Buffer.from(key) : typeof key === 'string' ? Buffer.from(key, 'utf8') : null;
 if (!material || material.length < MIN_KEY_BYTES || !/^[a-z0-9-]{3,32}$/.test(keyId)) fail('integrity_key_invalid');
 const seal = parts => keyId + ':' + createHmac('sha256', material).update(JSON.stringify(parts)).digest('hex');
 function verify(parts, tag) {
  if (typeof tag !== 'string') return false;
  const expected = Buffer.from(seal(parts)); const given = Buffer.from(tag);
  return expected.length === given.length && timingSafeEqual(expected, given);
 }
 return Object.freeze({ keyId, seal, verify });
}
module.exports = { createHmacIntegrity, MIN_KEY_BYTES };
