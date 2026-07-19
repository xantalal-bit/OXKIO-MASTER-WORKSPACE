'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getAgenda } = require('./agenda-provider');
const { getExecutiveStatus } = require('./executive-status-provider');
const { buildExecutiveSummary } = require('../executive-summary-builder');
const { buildMorningBriefing } = require('../../executive/morning-briefing');

function reader(events) {
  return async () => ({ privatePayload: { source: 'calendar', events } });
}

function failure(code, status) {
  return async () => {
    const error = new Error('sensitive provider detail');
    error.code = code;
    error.status = status;
    error.stack = 'sensitive stack';
    throw error;
  };
}

test('returns a real readonly Calendar contract, sorted and limited to ten events', async () => {
  const events = Array.from({ length: 12 }, (_, index) => ({
    id: `event-${index}`,
    title: `Event\n${index}`,
    start: new Date(Date.UTC(2026, 6, 20, 20 - index)).toISOString(),
    end: new Date(Date.UTC(2026, 6, 20, 21 - index)).toISOString(),
    allDay: index === 0,
    location: `Room\r${index}`,
    attendees: [{ email: 'private@example.test' }],
    description: 'private description',
    conferenceData: { secret: true },
    raw: { private: true },
  }));

  const result = await getAgenda(null, reader(events));

  assert.equal(result.source, 'calendar');
  assert.equal(result.available, true);
  assert.equal(result.stale, false);
  assert.equal(result.errorCode, null);
  assert.equal(result.count, 10);
  assert.equal(result.events.length, 10);
  assert.equal(result.events[0].id, 'event-11');
  assert.equal(result.events[0].title.includes('\n'), false);
  assert.equal(result.events[0].location.includes('\r'), false);
  assert.deepEqual(Object.keys(result.events[0]), [
    'id', 'title', 'start', 'end', 'allDay', 'location',
  ]);
  const serialized = JSON.stringify(result);
  ['attendees', 'description', 'conferenceData', 'raw', 'private@example.test']
    .forEach((term) => assert.equal(serialized.includes(term), false));
});

test('normalizes absent fields, invalid dates, strings and all-day metadata', async () => {
  const longTitle = `  Hello\n${'x'.repeat(250)}  `;
  const result = await getAgenda(null, reader([
    { id: '', title: '', start: 'invalid', end: null, location: '', allDay: false },
    { id: 'event-2', title: longTitle, start: '2026-07-20', allDay: true, location: ' A\r\nB ' },
  ]));

  assert.deepEqual(result.events[1], {
    id: null,
    title: 'Evento sin título',
    start: null,
    end: null,
    allDay: false,
    location: null,
  });
  assert.equal(result.events[0].allDay, true);
  assert.equal(result.events[0].title.length, 200);
  assert.equal(result.events[0].location, 'A B');
});

test('maps Calendar and OAuth failures without leaking provider details', async () => {
  const cases = [
    ['google_oauth_not_configured', undefined, 'calendar_oauth_not_configured'],
    ['oauth_token_missing', undefined, 'calendar_token_unavailable'],
    [undefined, 401, 'calendar_unauthorized'],
    [undefined, 403, 'calendar_unauthorized'],
    [undefined, 429, 'calendar_rate_limited'],
    [undefined, 503, 'calendar_service_error'],
    ['unexpected', undefined, 'calendar_unavailable'],
  ];

  for (const [code, status, expected] of cases) {
    const result = await getAgenda(null, failure(code, status));
    assert.deepEqual(result, {
      title: 'Agenda', events: [], count: 0, source: 'unavailable',
      available: false, stale: false, errorCode: expected,
    });
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  }
});

test('times out locally and rejects invalid provider responses without fallback', async () => {
  const timedOut = await getAgenda(null, () => new Promise(() => {}), { timeoutMs: 5 });
  const invalid = await getAgenda(null, async () => ({ privatePayload: { events: null } }));
  const missing = await getAgenda(null, null);

  assert.equal(timedOut.errorCode, 'calendar_timeout');
  assert.equal(invalid.errorCode, 'calendar_invalid_response');
  assert.equal(missing.errorCode, 'calendar_unavailable');
  [timedOut, invalid, missing].forEach((result) => {
    assert.equal(result.source, 'unavailable');
    assert.equal(result.events.length, 0);
    assert.equal(result.stale, false);
  });
});

test('fallback and unavailable agenda are never represented as real briefing facts', () => {
  const degraded = {
    source: 'fallback', available: false, stale: true,
    events: [{ title: 'Synthetic event' }], summary: 'Synthetic priority',
  };
  const real = {
    source: 'calendar', available: true, stale: false,
    events: [{ title: 'Real event' }],
  };

  assert.equal(buildExecutiveSummary({ agenda: degraded }).priority, null);
  assert.equal(buildExecutiveSummary({ agenda: real }).priority, 'Revisar agenda.');
  assert.deepEqual(buildMorningBriefing({ agenda: degraded }).priorities, []);
  assert.deepEqual(buildMorningBriefing({ agenda: real }).priorities, [{
    type: 'calendar',
    title: 'Revisar agenda',
    detail: '1 evento próximo.',
    source: 'calendar',
    confidence: 'high',
  }]);
  assert.equal(getExecutiveStatus({ operational: true, sources: [degraded] }).health, 'warning');
  assert.equal(getExecutiveStatus({
    operational: true,
    sources: [{ source: 'unavailable', available: false }],
  }).health, 'warning');
});

test('Dashboard frontend renders Calendar states through DOM text APIs only', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../../../app/executive-dashboard.html'),
    'utf8',
  );
  const agendaRenderer = html.slice(
    html.indexOf('function renderAgendaWidget'),
    html.indexOf('function updateSimpleItem'),
  );

  assert.match(agendaRenderer, /Google Calendar/);
  assert.match(agendaRenderer, /Datos de respaldo/);
  assert.match(agendaRenderer, /Agenda no disponible/);
  assert.match(agendaRenderer, /textContent/);
  assert.match(agendaRenderer, /replaceChildren/);
  assert.doesNotMatch(agendaRenderer, /innerHTML/);
  assert.doesNotMatch(agendaRenderer, /<button|addEventListener|fetch\s*\(/i);
});
