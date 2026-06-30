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

function getAgenda() {
  return getMockAgenda();
}

module.exports = {
  getMockAgenda,
  getAgenda
};
