'use strict';
const { randomUUID } = require('node:crypto');
const { createMembershipResolver } = require('../../security/membership-resolver');
const ID = /^[A-Za-z0-9:_-]{3,128}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function copy(value) { return structuredClone(value); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
// Authority is a private object identity, never a tenant id provided by a prompt.
function createScopeSessions({ membershipProvider }) {
  const resolver = createMembershipResolver({ provider: membershipProvider });
  const sessions = new WeakMap();
  async function open(authenticatedUserId) {
    const scope = await resolver.resolveMembership({ authenticatedUserId });
    const handle = Object.freeze({}); sessions.set(handle, scope); return handle;
  }
  function scope(handle) { const value = sessions.get(handle); if (!value) fail('session_invalid'); return value; }
  async function current(handle) {
    const previous = scope(handle); const fresh = await resolver.resolveMembership({ authenticatedUserId: previous.userId });
    if (JSON.stringify(previous) !== JSON.stringify(fresh)) { sessions.delete(handle); fail('session_authority_changed'); }
    return fresh;
  }
  function key(handle) { const s = scope(handle); return JSON.stringify([s.tenantId, s.clientId, s.userId]); }
  return Object.freeze({ open, scope, current, key });
}
// Adapter contract: keys are arrays encoded without delimiter ambiguities. No caller
// can choose a tenant namespace. In-memory storage is explicit and restart-ephemeral.
// Capacity is per owner, so one owner can never exhaust another owner's space.
function createScopedStore(sessions, { maxRecords = 2000 } = {}) {
  const rows = new Map(); const counts = new Map();
  const key = (handle, kind, id) => JSON.stringify([sessions.key(handle), kind, id]);
  function put(handle, kind, id, value) {
    if (!ID.test(id) || !ID.test(kind)) fail('resource_id_invalid');
    const owner = sessions.key(handle); const k = key(handle, kind, id);
    if (!rows.has(k)) { if ((counts.get(owner) || 0) >= maxRecords) fail('store_capacity'); counts.set(owner, (counts.get(owner) || 0) + 1); }
    rows.set(k, freeze(copy(value))); return copy(value);
  }
  function remove(handle, kind, id) { const k = key(handle, kind, id); if (rows.delete(k)) { const owner = sessions.key(handle); counts.set(owner, counts.get(owner) - 1); } }
  function get(handle, kind, id) { if (!ID.test(id)) fail('resource_id_invalid'); const v = rows.get(key(handle, kind, id)); if (!v) fail('resource_not_found'); return copy(v); }
  function list(handle, kind) { const namespace = sessions.key(handle); return [...rows].filter(([k]) => { const parts = JSON.parse(k); return parts[0] === namespace && parts[1] === kind; }).map(([, v]) => copy(v)); }
  return Object.freeze({ put, get, list, remove, newId: () => randomUUID(), persistence: 'EPHEMERAL' });
}
module.exports = { createScopeSessions, createScopedStore, copy, freeze, fail };
