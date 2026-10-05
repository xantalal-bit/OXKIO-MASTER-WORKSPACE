'use strict';
// The decider's capability view (05/10/2026): the owner's catalogue() refined
// by connections, Self Repair and the Privacy Gate. Information, never authority.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapabilityManager } = require('./capability-manager');
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
// A connection manager double with the same read-only surface the manager uses.
function connections(state = {}, { connectable = [], egress = {} } = {}) {
 return {
  inspect: (h, provider, scope) => { const s = state[provider]; if (!s) return { ready: false, status: 'NOT_CONNECTED' }; if (s === 'EXPIRED') return { ready: false, status: 'EXPIRED', verified: true }; if (s === 'UNVERIFIED') return { ready: true, status: 'CONNECTED', verified: false }; return { ready: true, status: 'CONNECTED', verified: true }; },
  connectable: (h, provider) => connectable.includes(provider),
  capture: (h, provider) => { if (!state[provider] || state[provider] === 'EXPIRED') throw Object.assign(new Error('connection_required'), { code: 'connection_required' }); return { origin: 'fixture', egress: egress[provider] || { providerId: null, region: null } }; },
 };
}
const statusOf = (view, id) => view.capabilities.find(c => c.id === id).status;
test('functional and authorized capabilities are AVAILABLE_NOW; local ones need no connection', () => {
 const c = createCapabilityManager({ connections: connections({ calendar: 'OK', search: 'OK', fetch: 'OK' }) });
 const v = c.decisionView('h', { text: 'Organiza mi semana', privacyPolicy: POLICY });
 for (const id of ['calendar.read', 'web.search', 'research.web', 'memory.search', 'data.analyze']) assert.equal(statusOf(v, id), 'AVAILABLE_NOW', id);
});
test('missing, expired or unvalidated connections are never AVAILABLE_NOW', () => {
 const c = createCapabilityManager({ connections: connections({ calendar: 'EXPIRED', mail: 'UNVERIFIED' }, { connectable: ['calendar', 'mail', 'storage'] }) });
 const v = c.decisionView('h', { text: 'Organiza mi semana', privacyPolicy: POLICY });
 assert.equal(statusOf(v, 'calendar.read'), 'NEEDS_CONNECTION');
 assert.equal(statusOf(v, 'gmail.read'), 'NEEDS_CONNECTION');
 assert.equal(statusOf(v, 'documents.read'), 'NEEDS_CONNECTION');
 // Without a connection flow for this account the capability does not exist for it.
 const none = createCapabilityManager({ connections: connections({}) }).decisionView('h', { text: 'x', privacyPolicy: POLICY });
 for (const id of ['calendar.read', 'gmail.read', 'documents.read', 'storage.propose', 'web.search', 'research.web']) assert.equal(statusOf(none, id), 'UNAVAILABLE', id);
});
test('declared-but-missing capabilities are UNAVAILABLE; external writes and model-initiated memory writes are BLOCKED', () => {
 const v = createCapabilityManager({ connections: connections({}) }).decisionView('h', { text: 'x', privacyPolicy: POLICY });
 for (const id of ['reminders.schedule', 'drive.read', 'onedrive.read', 'outlook.read', 'documents.extract']) assert.equal(statusOf(v, id), 'UNAVAILABLE', id);
 assert.equal(statusOf(v, 'external.write'), 'BLOCKED');
 assert.equal(statusOf(v, 'memory.remember'), 'BLOCKED');
});
test('a proposal capability is visible only as AVAILABLE_WITH_APPROVAL', () => {
 const v = createCapabilityManager({ connections: connections({ storage: 'OK' }) }).decisionView('h', { text: 'Organiza mis archivos', privacyPolicy: POLICY });
 assert.equal(statusOf(v, 'storage.propose'), 'AVAILABLE_WITH_APPROVAL');
 assert.equal(statusOf(v, 'documents.read'), 'AVAILABLE_NOW');
});
test('a capability the Privacy Gate would refuse for this request is BLOCKED; Self Repair degradation is UNAVAILABLE', () => {
 const c = createCapabilityManager({ connections: connections({ search: 'OK', fetch: 'OK' }, { egress: { search: { providerId: 'fixture', region: 'eu' } } }) });
 assert.equal(statusOf(c.decisionView('h', { text: 'Investiga la normativa europea de datos', privacyPolicy: POLICY }), 'web.search'), 'AVAILABLE_NOW');
 for (const text of ['Busca información de ana@example.org', 'Busca el expediente del DNI 12345678Z', 'Investiga el tratamiento de mi depresión'])
  assert.equal(statusOf(c.decisionView('h', { text, privacyPolicy: POLICY }), 'web.search'), 'BLOCKED', text);
 // Default policy (no provider approved for anything but public text).
 assert.equal(statusOf(c.decisionView('h', { text: 'Busca información de ana@example.org' }), 'web.search'), 'BLOCKED');
 const degraded = c.decisionView('h', { text: 'x', privacyPolicy: POLICY, degraded: id => id === 'research.web' });
 assert.equal(statusOf(degraded, 'research.web'), 'UNAVAILABLE');
});
test('only AVAILABLE_NOW, AVAILABLE_WITH_APPROVAL and NEEDS_CONNECTION are plannable, and only existing primitives', () => {
 const c = createCapabilityManager({ connections: connections({ search: 'OK', fetch: 'OK', storage: 'OK' }, { connectable: ['calendar'] }) });
 const v = c.decisionView('h', { text: 'x', privacyPolicy: POLICY });
 const plannable = new Set(['AVAILABLE_NOW', 'AVAILABLE_WITH_APPROVAL', 'NEEDS_CONNECTION']);
 assert.deepEqual(v.plannable, v.capabilities.filter(r => plannable.has(r.status)).map(r => r.id));
 for (const id of v.plannable) assert.ok(c.definitions[id], id);
 for (const id of ['memory.remember', 'external.write', 'drive.read', 'gmail.read']) assert.ok(!v.plannable.includes(id), id);
 assert.ok(v.plannable.includes('calendar.read') && v.plannable.includes('storage.propose'));
 // The view is frozen information: no field grants execution.
 assert.ok(Object.isFrozen(v));
 assert.ok(v.capabilities.every(r => Object.keys(r).every(k => ['id', 'status'].includes(k))));
});
test('without the runtime view the planner is offered nothing', async () => {
 let seen = null;
 const c = createCapabilityManager({ connections: connections({}), planner: async input => { seen = input; return [{ key: 'a', capability: 'memory.search', dependsOn: [] }]; } });
 await c.interpret('Resuelve xyzzy', {});
 assert.deepEqual(seen.capabilities, []);
 assert.deepEqual(seen.capabilityStatus, []);
});
