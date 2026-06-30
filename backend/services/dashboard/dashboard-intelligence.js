function getCurrentTimestamp() {
  return new Date().toISOString();
}

function createGreeting(timestamp) {
  return {
    text: "Buenos dias. Oxkio Dashboard Intelligence esta operativo.",
    generatedAt: timestamp,
    source: "mock"
  };
}

function createExecutiveStatus(timestamp) {
  return {
    mode: "SAFE_AGGREGATION_ONLY",
    health: "READY",
    focus: "Preparar capa de inteligencia del dashboard",
    risks: [],
    updatedAt: timestamp,
    source: "mock"
  };
}

function createAgenda(timestamp) {
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

function createGmail(timestamp) {
  return {
    inbox: {
      unread: 0,
      priority: 0,
      requiresReview: 0
    },
    highlights: [],
    updatedAt: timestamp,
    source: "mock"
  };
}

function createMemory(timestamp) {
  return {
    summary: "Memoria preparada para agregacion futura sin lectura real.",
    signals: [],
    counters: {
      shortTermItems: 0,
      strategicItems: 0
    },
    updatedAt: timestamp,
    source: "mock"
  };
}

function createAutomations(timestamp) {
  return {
    active: [],
    pendingApproval: 0,
    lastExecution: null,
    updatedAt: timestamp,
    source: "mock"
  };
}

function getDashboardState() {
  const timestamp = getCurrentTimestamp();

  return {
    greeting: createGreeting(timestamp),
    executiveStatus: createExecutiveStatus(timestamp),
    agenda: createAgenda(timestamp),
    gmail: createGmail(timestamp),
    memory: createMemory(timestamp),
    automations: createAutomations(timestamp)
  };
}

module.exports = {
  getDashboardState
};
