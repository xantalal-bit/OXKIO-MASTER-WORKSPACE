function getAgenda(timestamp) {
  return {
    today: [
      {
        id: "agenda-mock-1",
        title: "Revisar prioridades ejecutivas",
        startsAt: null,
        status: "pending",
        source: "mock"
      }
    ],
    next: [],
    summary: {
      totalToday: 1,
      pending: 1,
      blocked: 0
    },
    updatedAt: timestamp,
    source: "mock"
  };
}

module.exports = {
  getAgenda
};
