function approveAction(action) {
  return {
    ...action,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvalStatus: "approved"
  };
}

function rejectAction(action, reason = "Sin motivo especificado") {
  return {
    ...action,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    approvalStatus: "rejected",
    rejectionReason: reason
  };
}

module.exports = {
  approveAction,
  rejectAction
};