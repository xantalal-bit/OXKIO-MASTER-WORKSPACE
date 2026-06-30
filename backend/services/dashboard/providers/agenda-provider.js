const { listUpcomingEvents } = require("../../../integrations/calendar/connector");

function createMockEvent() {
  return {
    id: "agenda-mock-1",
    title: "Revisar prioridades ejecutivas",
    start: null,
    end: null,
    location: null,
    source: "mock"
  };
}

function getMockAgenda() {
  const events = [createMockEvent()];

  return {
    title: "Agenda",
    summary: "Agenda preparada para integracion futura con eventos reales.",
    nextEvent: events[0] || null,
    events,
    source: "mock"
  };
}

async function getAgenda() {
  try {
    const events = await listUpcomingEvents();

    return {
      title: "Agenda",
      summary: "Agenda conectada con Google Calendar.",
      nextEvent: events[0] || null,
      events,
      source: "google-calendar"
    };
  } catch (error) {
    return getMockAgenda();
  }
}

module.exports = {
  getMockAgenda,
  getAgenda
};
