'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildExecutiveSummary } = require('./executive-summary-builder');

test('Executive Summary uses only real sources and never turns degradation into priorities', () => {
  const unavailable = buildExecutiveSummary({
    agenda: { source: 'fallback', available: false, events: [{ title: 'Mock' }] },
    gmail: { source: 'unavailable', available: false, unread: 8, important: 2 },
    automations: { source: 'unavailable', available: false, failed: 3 },
  });
  assert.deepEqual(unavailable, { priority: null, recommendation: null, alerts: [] });

  const real = buildExecutiveSummary({
    agenda: { source: 'calendar', available: true, events: [{ title: 'Event' }] },
    gmail: { source: 'gmail', available: true, unread: 1, important: 0 },
    automations: { source: 'approval-queue', available: true, failed: 1 },
  });
  assert.deepEqual(real, {
    priority: 'Revisar agenda.',
    recommendation: 'Revisar correo.',
    alerts: ['Hay compromisos con ejecución fallida.'],
  });
});
