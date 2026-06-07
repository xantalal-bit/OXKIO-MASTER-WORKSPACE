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
    nextStep: advisor.nextStep,
    approvalStatus: "pending"
  };
}

function addExecutiveAction(advisor) {
  const action =
    createExecutiveAction(advisor);

  queue.unshift(action);

  return action;
}

function approveQueuedAction(id) {
  const action =
    queue.find(item => item.id === Number(id));

  if (!action) {
    return null;
  }

  action.status = "approved";
  action.approvalStatus = "approved";
  action.approvedAt = new Date().toISOString();

  return action;
}

function rejectQueuedAction(id, reason = "Sin motivo especificado") {
  const action =
    queue.find(item => item.id === Number(id));

  if (!action) {
    return null;
  }

  action.status = "rejected";
  action.approvalStatus = "rejected";
  action.rejectedAt = new Date().toISOString();
  action.rejectionReason = reason;

  return action;
}

function getExecutiveQueue() {
  return {
    queueStatus: "Executive Action Queue v1 activa",
    totalActions: queue.length,
    pendingActions: queue.filter(item => item.status === "pending_approval").length,
    approvedActions: queue.filter(item => item.status === "approved").length,
    rejectedActions: queue.filter(item => item.status === "rejected").length,
    actions: queue
  };
}

module.exports = {
  addExecutiveAction,
  approveQueuedAction,
  rejectQueuedAction,
  getExecutiveQueue
};