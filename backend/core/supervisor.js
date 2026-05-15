// OXKIO SUPERVISOR V2
// Control humano y autorización de acciones

class OxkioSupervisor {

  constructor() {
    this.mode = "HUMAN_IN_THE_LOOP";
    this.pendingApprovals = [];
    this.approvedActions = [];
    this.rejectedActions = [];
  }

  requestApproval(action) {
    const approvalRequest = {
      id: Date.now(),
      action,
      status: "PENDING",
      createdAt: new Date().toISOString()
    };

    this.pendingApprovals.push(approvalRequest);

    return approvalRequest;
  }

  approveAction(id) {
    const request = this.pendingApprovals.find(item => item.id === id);

    if (!request) {
      return { ok: false, message: "Solicitud no encontrada" };
    }

    request.status = "APPROVED";
    this.approvedActions.push(request);
    this.pendingApprovals = this.pendingApprovals.filter(item => item.id !== id);

    return { ok: true, message: "Acción aprobada", action: request.action };
  }

  rejectAction(id, reason = "") {
    const request = this.pendingApprovals.find(item => item.id === id);

    if (!request) {
      return { ok: false, message: "Solicitud no encontrada" };
    }

    request.status = "REJECTED";
    request.reason = reason;
    this.rejectedActions.push(request);
    this.pendingApprovals = this.pendingApprovals.filter(item => item.id !== id);

    return { ok: true, message: "Acción rechazada", reason };
  }

  getStatus() {
    return {
      mode: this.mode,
      pending: this.pendingApprovals.length,
      approved: this.approvedActions.length,
      rejected: this.rejectedActions.length
    };
  }

}

module.exports = OxkioSupervisor;