const { getCalendarClient } = require("../googleOAuth");

function normalizeEvent(event) {
  return {
    id: event.id,
    title: event.summary || "Sin titulo",
    start: (event.start && (event.start.dateTime || event.start.date)) || null,
    end: (event.end && (event.end.dateTime || event.end.date)) || null,
    location: event.location || null,
    source: "google-calendar"
  };
}

async function listUpcomingEvents(options = {}) {
  const calendar = getCalendarClient();
  const response = await calendar.events.list({
    calendarId: options.calendarId || "primary",
    timeMin: options.timeMin || new Date().toISOString(),
    timeMax: options.timeMax,
    maxResults: options.maxResults || 10,
    singleEvents: true,
    orderBy: "startTime"
  });

  return (response.data.items || []).map(normalizeEvent);
}

module.exports = {
  listUpcomingEvents
};
