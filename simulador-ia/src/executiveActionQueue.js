const queue = [];

function createExecutiveAction(advisor) {
  return {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    status: "pending_approval",
    priority: advisor.priority,
    title: advisor.recommendedAction,
    justification: advisor.justification,
    strategicFocus: advisor.strategicFocus,
    confidence: advisor.confidence,
    horizon: advisor.horizon,
    nextStep: advisor.nextStep
  };
}

function addExecutiveAction(advisor) {
  const action =
    createExecutiveAction(advisor);

  queue.unshift(action);

  return action;
}

function getExecutiveQueue() {
  return {
    queueStatus: "Executive Action Queue v1 activa",
    totalActions: queue.length,
    actions: queue
  };
}

module.exports = {
  addExecutiveAction,
  getExecutiveQueue
};