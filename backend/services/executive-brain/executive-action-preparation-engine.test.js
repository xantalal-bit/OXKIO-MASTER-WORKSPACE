'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_BODY,
  buildExecutiveActionPreparation,
} = require('./executive-action-preparation-engine');

function proposal(actionType, risk = 'low') {
  return { status: 'proposed', actionType, risk, requiresApproval: true, executionEnabled: false };
}

function input(actionType, dashboard = {}, executiveSummary = {}) {
  return {
    proposal: proposal(actionType, actionType.startsWith('prepare-') ? 'medium' : 'low'),
    executiveSummary: {
      status: 'ready',
      headline: 'Hay información útil para revisar.',
      recommendation: 'Revisar la información antes de avanzar.',
      ...executiveSummary,
    },
    dashboard,
  };
}

test('without a proposal or with an ambiguous proposal it is not ready', () => {
  assert.equal(buildExecutiveActionPreparation().status, 'not_ready');
  assert.equal(buildExecutiveActionPreparation(input('unknown')).preparationType, 'none');
});

test('email without a safe recipient is not ready and invents nothing', () => {
  const value = buildExecutiveActionPreparation(input('prepare-email-draft', {
    gmail: { recent: [{ subject: 'Contrato' }] },
  }));
  assert.equal(value.status, 'not_ready');
  assert.deepEqual(value.fields, { subjectPreview: 'Re: Contrato' });
  assert.ok(value.missingFields.includes('recipientLabel'));
  assert.ok(value.missingFields.includes('bodyPreview'));
});

test('email with safe data creates a bounded preview and masks an address-only label', () => {
  const value = buildExecutiveActionPreparation(input('prepare-email-draft', {
    gmail: { recent: [{ from: 'cliente@example.com', subject: `Acuerdo ${'x'.repeat(400)}` }] },
  }, { recommendation: 'Confirmar los siguientes pasos. '.repeat(30) }));
  assert.equal(value.status, 'prepared');
  assert.equal(value.fields.recipientLabel, 'cl***@e***');
  assert.ok(value.fields.bodyPreview.length <= MAX_BODY);
  assert.ok(value.fields.subjectPreview.length <= 200);
  assert.doesNotMatch(value.fields.bodyPreview, /cliente@example\.com/);
});

test('calendar without date or time is not ready', () => {
  const value = buildExecutiveActionPreparation(input('prepare-calendar-event', {
    agenda: { events: [{ title: 'Reunión' }] },
  }));
  assert.equal(value.status, 'not_ready');
  assert.deepEqual(value.missingFields, ['datePreview', 'timePreview']);
});

test('calendar with safe data creates a preview without inventing attendees', () => {
  const value = buildExecutiveActionPreparation(input('prepare-calendar-event', {
    agenda: { events: [{
      title: 'Reunión de seguimiento',
      start: '2026-08-01T10:30:00.000Z',
      end: '2026-08-01T11:30:00.000Z',
      location: 'Sala Norte',
    }] },
  }));
  assert.equal(value.status, 'prepared');
  assert.deepEqual(value.fields, {
    titlePreview: 'Reunión de seguimiento',
    datePreview: '2026-08-01',
    timePreview: '10:30',
    durationPreview: '1 h',
    locationPreview: 'Sala Norte',
  });
  assert.equal(Object.hasOwn(value.fields, 'attendeeLabels'), false);
});

test('prepares business, knowledge and memory reviews from existing public data', () => {
  const cases = [
    ['review-business', { worker: 'business-hunter-readonly', result: {
      opportunities: [{ objective: 'Evaluar oportunidad', sector: 'Salud', location: 'Galicia', limits: ['Sin contacto'] }],
    } }, 'business-review-preview'],
    ['review-knowledge', { worker: 'knowledge-readonly', result: {
      objective: 'Revisar gobernanza', topics: ['Gobernanza'], limits: ['Solo inventario local'],
    } }, 'knowledge-review-preview'],
    ['review-memory', { worker: 'memory-readonly', result: {
      objective: 'Revisar decisiones', topics: ['Decisiones'], limits: ['Solo lectura'],
    } }, 'memory-review-preview'],
  ];
  cases.forEach(([actionType, operation, expected]) => {
    const value = buildExecutiveActionPreparation(input(actionType, {
      operations: { businessHunter: { recentOperations: [{ status: 'completed', ...operation }] } },
    }));
    assert.equal(value.status, 'prepared');
    assert.equal(value.preparationType, expected);
  });
});

test('returns the exact immutable non-executable contract', () => {
  const source = input('review-knowledge', {
    operations: { businessHunter: { recentOperations: [{
      status: 'completed', worker: 'knowledge-readonly',
      result: { objective: 'Revisar', topics: ['Tema'] },
    }] } },
  });
  const before = JSON.stringify(source);
  const first = buildExecutiveActionPreparation(source);
  const second = buildExecutiveActionPreparation(source);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    'status', 'preparationType', 'title', 'summary', 'fields', 'missingFields',
    'risk', 'requiresApproval', 'executionEnabled',
  ]);
  assert.equal(first.requiresApproval, true);
  assert.equal(first.executionEnabled, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.fields), true);
  assert.equal(Object.isFrozen(first.missingFields), true);
  assert.equal(JSON.stringify(source), before);
});

test('has no external calls, persistence, operational imports, queues or real actions', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'executive-action-preparation-engine.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /require\(['"][^'"]+['"]\)/);
  assert.doesNotMatch(source, /fetch\(|https?:|googleapis|firebase|ApprovalQueue|approvalQueue/);
  assert.doesNotMatch(source, /writeFile|save|persist|setInterval|setTimeout|createDraft|sendMail|insertEvent/);
});
