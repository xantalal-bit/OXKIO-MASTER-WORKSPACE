'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_REASON,
  MAX_TITLE,
  buildExecutiveActionProposal,
} = require('./executive-action-proposal-engine');

function summary(overrides = {}) {
  return {
    status: 'ready',
    headline: 'Hay prioridades que requieren atención.',
    priorities: [],
    recommendation: 'Revisar la prioridad principal.',
    sourcesUsed: [],
    generatedAt: '2026-07-23T16:00:00.000Z',
    ...overrides,
  };
}

test('returns none without a summary or for unavailable data', () => {
  assert.equal(buildExecutiveActionProposal().status, 'none');
  assert.equal(buildExecutiveActionProposal(summary({ status: 'unavailable' })).actionType, 'none');
  assert.equal(buildExecutiveActionProposal(summary({ status: 'invalid' })).actionType, 'none');
});

test('proposes preparing an email draft for clear priority mail evidence', () => {
  const result = buildExecutiveActionProposal(summary({
    priorities: ['Un correo importante requiere atención.'],
    sourcesUsed: ['Correo'],
  }));
  assert.equal(result.actionType, 'prepare-email-draft');
});

test('proposes preparing a calendar event only when organization is explicit', () => {
  const result = buildExecutiveActionProposal(summary({
    priorities: ['Un compromiso próximo requiere organización.'],
    sourcesUsed: ['Agenda'],
  }));
  assert.equal(result.actionType, 'prepare-calendar-event');
});

test('proposes each safe readonly review from explicit evidence', () => {
  const cases = [
    ['Business', 'Hay una oportunidad comercial prioritaria.', 'review-business'],
    ['Conocimiento', 'Falta conocimiento para completar la decisión.', 'review-knowledge'],
    ['Memoria', 'La memoria contiene contexto previo relevante.', 'review-memory'],
  ];
  cases.forEach(([source, priority, expected]) => {
    assert.equal(buildExecutiveActionProposal(summary({
      priorities: [priority],
      sourcesUsed: [source],
    })).actionType, expected);
  });
});

test('returns none for weak, mismatched or ambiguous evidence', () => {
  const cases = [
    summary({ priorities: ['Conviene continuar.'], sourcesUsed: ['Correo'] }),
    summary({ priorities: ['Un correo importante requiere atención.'], sourcesUsed: ['Agenda'] }),
    summary({
      priorities: ['Un correo comercial importante representa una oportunidad pendiente.'],
      sourcesUsed: ['Correo', 'Business'],
    }),
  ];
  cases.forEach((input) => assert.equal(buildExecutiveActionProposal(input).status, 'none'));
});

test('uses only the first clear priority when several actions are evidenced', () => {
  const result = buildExecutiveActionProposal(summary({
    priorities: ['Un correo pendiente requiere atención.', 'La memoria aporta contexto histórico.'],
    sourcesUsed: ['Correo', 'Memoria'],
  }));
  assert.equal(result.actionType, 'prepare-email-draft');
});

test('returns exactly one bounded non-executable proposal', () => {
  const result = buildExecutiveActionProposal(summary({
    priorities: ['Un correo pendiente requiere atención.', 'Otro correo importante requiere atención.'],
    sourcesUsed: ['Correo'],
  }));
  assert.deepEqual(Object.keys(result), [
    'status', 'actionType', 'title', 'reason', 'risk', 'requiresApproval', 'executionEnabled',
  ]);
  assert.equal(result.status, 'proposed');
  assert.ok(result.title.length <= MAX_TITLE);
  assert.ok(result.reason.length <= MAX_REASON);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.executionEnabled, false);
});

test('never creates payloads or invents recipients, dates or attendees', () => {
  const result = buildExecutiveActionProposal(summary({
    priorities: ['Un compromiso próximo requiere organización.'],
    sourcesUsed: ['Agenda'],
  }));
  const serialized = JSON.stringify(result);
  ['payload', 'executionPayload', 'recipient', 'attendee', 'date', 'time', 'operationId', 'worker']
    .forEach((value) => assert.equal(Object.hasOwn(result, value), false));
  assert.doesNotMatch(serialized, /@|https?:|[A-Za-z]:\\/);
});

test('is pure, deterministic, immutable and leaves input unchanged', () => {
  const input = summary({
    priorities: ['La memoria aporta contexto histórico relevante.'],
    sourcesUsed: ['Memoria'],
  });
  const before = JSON.stringify(input);
  const first = buildExecutiveActionProposal(input);
  const second = buildExecutiveActionProposal(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(first), true);
});

test('has no provider, worker, queue, persistence or external-call dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, 'executive-action-proposal-engine.js'), 'utf8');
  assert.doesNotMatch(source, /OperationsCoordinator|runCalendar|runGmail|fetch\(|https?:|approvalQueue|ProposalEngine|save|writeFile|setInterval|setTimeout/);
  assert.doesNotMatch(source, /require\(['"][^'"]+['"]\)/);
});
