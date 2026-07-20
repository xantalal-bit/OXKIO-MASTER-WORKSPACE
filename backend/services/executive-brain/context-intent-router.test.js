'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeContextQuery, selectExecutiveContext } = require('./context-intent-router');

function selected(query) {
  const result = selectExecutiveContext(query);
  return Object.fromEntries(['gmail', 'calendar', 'dashboard', 'memory', 'approvals'].map((key) => [key, result[key]]));
}

test('normalizes case, accents, punctuation, and whitespace deterministically', () => {
  assert.equal(normalizeContextQuery('  ¿QUÉ   REUNIÓN tengo MAÑANA?  '), 'que reunion tengo manana');
  assert.deepEqual(selectExecutiveContext('¿Qué correos tengo?'), selectExecutiveContext(' QUE CORREOS TENGO '));
});

test('selects each readonly source with minimum context', () => {
  assert.deepEqual(selected('¿Qué correos tengo pendientes?'), { gmail: true, calendar: false, dashboard: false, memory: false, approvals: false });
  assert.deepEqual(selected('¿Qué reuniones tengo hoy?'), { gmail: false, calendar: true, dashboard: false, memory: false, approvals: false });
  assert.deepEqual(selected('¿Cómo está mi día?'), { gmail: false, calendar: false, dashboard: true, memory: false, approvals: false });
  assert.deepEqual(selected('¿Qué tengo pendiente de aprobar?'), { gmail: false, calendar: false, dashboard: false, memory: false, approvals: true });
  assert.deepEqual(selected('¿Qué recuerdas de nuestras últimas decisiones?'), { gmail: false, calendar: false, dashboard: false, memory: true, approvals: false });
});

test('selects Gmail and Calendar together only for an explicit combined query', () => {
  const result = selectExecutiveContext('Resume mis correos y reuniones de hoy.');
  assert.deepEqual(selected('Resume mis correos y reuniones de hoy.'), { gmail: true, calendar: true, dashboard: false, memory: false, approvals: false });
  assert.equal(result.reason, 'combined_query');
});

test('does not activate private sources for educational or general queries', () => {
  assert.deepEqual(selected('Explícame qué es un correo electrónico.'), { gmail: false, calendar: false, dashboard: false, memory: false, approvals: false });
  assert.deepEqual(selected('Explícame qué es una agenda digital.'), { gmail: false, calendar: false, dashboard: false, memory: false, approvals: false });
  assert.equal(selectExecutiveContext('Dame una idea general.').reason, 'general_query');
});

test('loads action context only when a safe real-world reference is required', () => {
  assert.equal(selectExecutiveContext('Prepara un borrador de respuesta.').gmail, false);
  assert.equal(selectExecutiveContext('Prepara una respuesta al último correo.').gmail, true);
  assert.equal(selectExecutiveContext('Programa una reunión.').calendar, false);
  assert.equal(selectExecutiveContext('Programa una reunión según mi disponibilidad.').calendar, true);
});

test('negated actions do not select context', () => {
  for (const query of ['No prepares un borrador.', 'No programes una reunión.', 'No crees una tarea.']) {
    assert.deepEqual(selected(query), { gmail: false, calendar: false, dashboard: false, memory: false, approvals: false });
  }
});
