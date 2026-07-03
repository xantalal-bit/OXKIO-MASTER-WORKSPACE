'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_EVENTS,
  buildCalendarPrivateContext,
  normalizeCalendarEvent,
  resolveCalendarRange,
} = require('./calendar-private-provider');
const { preparePrivateContextAdapter } = require('./private-context-adapter');

function buildProviderInput(overrides = {}) {
  return {
    clientId: 'client-alpha',
    userId: 'user-alpha',
    expectedClientId: 'client-alpha',
    authorization: { status: 'granted' },
    sourceId: 'calendar-source-alpha',
    range: 'next24Hours',
    now: '2026-07-03T08:00:00.000Z',
    maxResults: 5,
    ...overrides,
  };
}

test('builds readonly Calendar private context with explicit range', async () => {
  let calledWith = null;
  const context = await buildCalendarPrivateContext(buildProviderInput(), {
    listUpcomingEvents(options) {
      calledWith = options;

      return [
        {
          id: 'event-1',
          title: 'Reunion ficticia',
          start: '2026-07-03T10:00:00.000Z',
          end: '2026-07-03T11:00:00.000Z',
        },
      ];
    },
  });

  assert.deepEqual(calledWith, {
    calendarId: 'primary',
    timeMin: '2026-07-03T08:00:00.000Z',
    timeMax: '2026-07-04T08:00:00.000Z',
    maxResults: 5,
  });
  assert.equal(context.privateContextMetadata.scope, 'private:user');
  assert.equal(context.privateContextMetadata.sensitivity, 'confidential');
  assert.equal(context.privateContextMetadata.sourceType, 'calendar');
  assert.equal(context.privateContextMetadata.purpose, 'executive-briefing');
  assert.equal(context.privateContextMetadata.promotionPolicy, 'NEVER_PROMOTE');
  assert.equal(context.privatePayload.source, 'calendar');
  assert.equal(context.privatePayload.events.length, 1);
});

test('Calendar private context passes through G004/G005 adapter', async () => {
  const context = await buildCalendarPrivateContext(buildProviderInput(), {
    listUpcomingEvents() {
      return [
        {
          id: 'event-1',
          title: 'Reunion ficticia',
          start: '2026-07-03T10:00:00.000Z',
        },
      ];
    },
  });

  const adapted = preparePrivateContextAdapter({
    privateContext: context.privateContextMetadata,
    expectedClientId: context.expectedClientId,
    payload: context.privatePayload,
    requiredPurpose: 'executive-briefing',
  });

  assert.equal(adapted.private, true);
  assert.equal(adapted.persistable, false);
  assert.equal(adapted.promotable, false);
  assert.equal(adapted.promotionPolicy, 'NEVER_PROMOTE');
  assert.equal(adapted.payload.events.length, 1);
});

test('rejects incompatible clientId through G004/G005 adapter', async () => {
  const context = await buildCalendarPrivateContext(buildProviderInput({
    expectedClientId: 'client-beta',
  }), {
    listUpcomingEvents() {
      return [];
    },
  });

  assert.throws(
    () => preparePrivateContextAdapter({
      privateContext: context.privateContextMetadata,
      expectedClientId: context.expectedClientId,
      payload: context.privatePayload,
    }),
    /does not match/,
  );
});

test('normalizes Calendar events by whitelist', () => {
  const event = normalizeCalendarEvent({
    id: 'event-1',
    summary: 'Compromiso ficticio',
    start: '2026-07-03T10:00:00.000Z',
    end: '2026-07-03T11:00:00.000Z',
    description: 'secreto',
    htmlLink: 'https://calendar.example',
    token: 'secret-token',
    credentials: 'secret-credentials',
    attendees: [{ email: 'private@example.test' }],
  });

  assert.deepEqual(Object.keys(event), ['id', 'title', 'start', 'end']);
  assert.equal(event.title, 'Compromiso ficticio');
  assert.equal(JSON.stringify(event).includes('secret-token'), false);
  assert.equal(JSON.stringify(event).includes('private@example.test'), false);
});

test('handles event without title safely', () => {
  const event = normalizeCalendarEvent({
    id: 'event-1',
    start: '2026-07-03',
  });

  assert.equal(event.title, 'Evento sin titulo');
});

test('limits calendar range to seven days', () => {
  assert.throws(
    () => resolveCalendarRange({
      range: 'custom',
      timeMin: '2026-07-03T00:00:00.000Z',
      timeMax: '2026-07-11T00:00:00.000Z',
    }),
    /7 days or less/,
  );
});

test('resolves next7Days range for weekly agenda', () => {
  const range = resolveCalendarRange({
    range: 'next7Days',
    now: '2026-07-03T08:00:00.000Z',
  });

  assert.deepEqual(range, {
    preset: 'next7Days',
    timeMin: '2026-07-03T08:00:00.000Z',
    timeMax: '2026-07-10T08:00:00.000Z',
  });
});

test('clamps max events to provider limit', async () => {
  let requestedMaxResults = null;
  const events = Array.from({ length: MAX_EVENTS + 5 }, (_, index) => ({
    id: `event-${index}`,
    title: `Evento ${index}`,
  }));
  const context = await buildCalendarPrivateContext(buildProviderInput({ maxResults: 100 }), {
    listUpcomingEvents(options) {
      requestedMaxResults = options.maxResults;
      return events;
    },
  });

  assert.equal(requestedMaxResults, MAX_EVENTS);
  assert.equal(context.privatePayload.events.length, MAX_EVENTS);
});
