'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  createCalendarReadonlyService,
  MAX_EVENTS,
} = require('./calendar-readonly-service');

const IDENTITY = Object.freeze({
  clientId: 'cliente-cero',
  expectedClientId: 'cliente-cero',
  userId: 'owner',
  authorization: Object.freeze({ status: 'granted', provider: 'google-oauth' }),
});

function event(title, start, end, extra = {}) {
  return { id: `private-${title}`, title, start, end, description: 'private body', attendees: ['person@example.com'], ...extra };
}

test('uses the existing Calendar reader with one fixed safe window and returns limited sanitized results', async () => {
  let providerInput;
  let cleanupCalls = 0;
  const nowMs = Date.parse('2026-07-23T08:00:00Z');
  const timeMin = new Date(nowMs);
  timeMin.setHours(0, 0, 0, 0);
  const service = createCalendarReadonlyService({
    nowMs,
    createExecutiveRuntime(options) {
      assert.deepEqual(options, { mode: 'sandbox' });
      return { cleanup() { cleanupCalls += 1; } };
    },
    async buildCalendarPrivateContext(input) {
      providerInput = input;
      return {
        privatePayload: {
          events: [
            event('Reunión <script>', '2026-07-23T10:00:00Z', '2026-07-23T11:00:00Z', { location: 'Sala 1 https://private.test' }),
            event('Solapada', '2026-07-23T10:30:00Z', '2026-07-23T11:30:00Z'),
            ...Array.from({ length: 10 }, (_, index) => event(`Evento ${index}`, `2026-07-${24 + index}T10:00:00Z`, `2026-07-${24 + index}T11:00:00Z`)),
          ],
        },
      };
    },
  });
  const result = await service.runCalendarReadonly({
    operationId: 'op-1',
    interactionId: 'int-1',
    identity: IDENTITY,
  });

  assert.deepEqual(providerInput, {
    ...IDENTITY,
    range: 'custom',
    timeMin: timeMin.toISOString(),
    timeMax: new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    maxResults: MAX_EVENTS,
  });
  assert.equal(result.worker, 'calendar-readonly');
  assert.equal(result.eventsCount, 10);
  assert.equal(result.relevantItems.length, 5);
  assert.ok(result.relevantItems.some((item) => item.conflict));
  assert.ok(result.recommendations.length <= 3);
  assert.equal(cleanupCalls, 1);
  const serialized = JSON.stringify(result);
  ['private-', 'description', 'attendees', 'person@example.com', 'https://', '"id"'].forEach((value) => {
    assert.equal(serialized.includes(value), false);
  });
});

test('reports unavailable without inventing events and releases cleanup', async () => {
  let cleanupCalls = 0;
  const service = createCalendarReadonlyService({
    createExecutiveRuntime() { return { cleanup() { cleanupCalls += 1; } }; },
    async buildCalendarPrivateContext() { return { privatePayload: { events: [] } }; },
  });
  const result = await service.runCalendarReadonly({ operationId: 'op', interactionId: 'int', identity: IDENTITY });
  assert.equal(result.sourceStatus, 'unavailable');
  assert.equal(result.eventsCount, 0);
  assert.deepEqual(result.relevantItems, []);
  assert.equal(cleanupCalls, 1);
});

test('times out safely, enforces its lock and always cleans up', async () => {
  let cleanupCalls = 0;
  const service = createCalendarReadonlyService({
    createExecutiveRuntime() { return { cleanup() { cleanupCalls += 1; } }; },
    buildCalendarPrivateContext() { return new Promise(() => {}); },
  });
  const pending = service.runCalendarReadonly({
    operationId: 'op-1', interactionId: 'int-1', identity: IDENTITY, timeoutMs: 10,
  });
  await assert.rejects(
    service.runCalendarReadonly({ operationId: 'op-2', interactionId: 'int-2', identity: IDENTITY }),
    { code: 'calendar_operation_in_progress' },
  );
  await assert.rejects(pending, { code: 'calendar_review_timeout' });
  assert.equal(cleanupCalls, 1);
});

test('keeps earlier-today and all-day events when optional end and location are absent', async () => {
  const service = createCalendarReadonlyService({
    nowMs: Date.parse('2026-07-23T16:00:00Z'),
    createExecutiveRuntime() { return { cleanup() {} }; },
    async buildCalendarPrivateContext() {
      return {
        privatePayload: {
          events: [
            { title: 'Anterior hoy', start: '2026-07-23T08:00:00Z' },
            { title: 'Todo el día', start: '2026-07-23', allDay: true },
          ],
        },
      };
    },
  });

  const result = await service.runCalendarReadonly({
    operationId: 'op-day',
    interactionId: 'int-day',
    identity: IDENTITY,
  });

  assert.equal(result.eventsCount, 2);
  assert.ok(result.relevantItems.some((item) => item.time === 'Todo el día'));
  assert.ok(result.relevantItems.every((item) => item.location === 'Ubicación no indicada'));
});

test('contains no Calendar mutation capability', () => {
  const source = fs.readFileSync(path.join(__dirname, 'calendar-readonly-service.js'), 'utf8');
  assert.doesNotMatch(source, /events\.(insert|update|patch|delete|move|watch)|calendarList\.(insert|update|delete)|freebusy|attendeesOmitted|sendUpdates|sendNotifications|conferenceDataVersion/);
  assert.doesNotMatch(source, /\b(create|update|delete|cancel|respond|invite|notify)(Event|Invitation|Attendee)?\b/);
});
