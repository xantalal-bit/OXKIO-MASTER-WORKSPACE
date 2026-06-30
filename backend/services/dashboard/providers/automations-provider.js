function getAutomations(timestamp) {
  return {
    active: [],
    pendingApproval: 0,
    lastExecution: null,
    updatedAt: timestamp,
    source: "mock"
  };
}

module.exports = {
  getAutomations
};
