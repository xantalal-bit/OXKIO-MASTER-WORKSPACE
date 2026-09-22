'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveReference } = require('./reference-resolver');

const messages = [
  { ref: '1', from: 'Ana <ana@example.com>', subject: 'Propuesta', unread: true, important: true },
  { ref: '2', from: 'Bob <bob@example.com>', subject: 'Factura', unread: false, important: false },
  { ref: '3', from: 'Carla <carla@example.com>', subject: 'Seguimiento', unread: true, important: false },
];

test('"el primero" resolves to item 1', () => {
  const result = resolveReference('¿Y el primero?', { entities: messages });
  assert.equal(result.resolved, true);
  assert.equal(result.item.ref, '1');
});

test('"el segundo" resolves to item 2', () => {
  const result = resolveReference('Cuéntame del segundo', { entities: messages });
  assert.equal(result.resolved, true);
  assert.equal(result.item.ref, '2');
});

test('"el último" resolves to the last item', () => {
  const result = resolveReference('¿Qué dice el último?', { entities: messages });
  assert.equal(result.resolved, true);
  assert.equal(result.item.ref, '3');
});

test('"el más importante" resolves to the item flagged important', () => {
  const result = resolveReference('Prepárame una respuesta al más importante', { entities: messages });
  assert.equal(result.resolved, true);
  assert.equal(result.item.ref, '1');
  assert.equal(result.via, 'most_important');
});

test('"ese correo" uses the recent selection when one exists', () => {
  const result = resolveReference('Respóndele a ese correo', {
    entities: messages,
    selection: { ref: '3' },
  });
  assert.equal(result.resolved, true);
  assert.equal(result.item.ref, '3');
});

test('an ambiguous reference with no usable selection is never guessed', () => {
  const result = resolveReference('Respóndele', { entities: messages, selection: null });
  assert.equal(result.resolved, false);
  assert.equal(result.ambiguous, true);
});

test('reference language with an empty list is reported as ambiguous, not silently ignored', () => {
  const result = resolveReference('¿Qué dice el primero?', { entities: [] });
  assert.equal(result.resolved, false);
  assert.equal(result.ambiguous, true);
});

test('a query with no reference language at all is not ambiguous', () => {
  const result = resolveReference('Revisa mi correo', { entities: messages });
  assert.equal(result.resolved, false);
  assert.equal(result.ambiguous, false);
});
