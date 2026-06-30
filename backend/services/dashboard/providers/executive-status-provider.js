function getExecutiveStatus(timestamp) {
  return {
    mode: "SAFE_AGGREGATION_ONLY",
    health: "READY",
    focus: "Preparar capa de inteligencia del dashboard",
    risks: [],
    updatedAt: timestamp,
    source: "mock"
  };
}

module.exports = {
  getExecutiveStatus
};
