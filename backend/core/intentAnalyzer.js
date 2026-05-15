class IntentAnalyzer {
  analyze(message = "") {
    const text = message.toLowerCase();

    let intent = "general";
    let urgency = "low";
    let actionType = "inform";

    if (text.includes("urgente") || text.includes("prioridad") || text.includes("importante")) {
      urgency = "high";
    }

    if (text.includes("reunión") || text.includes("reunion") || text.includes("cita")) {
      intent = "meeting";
      actionType = "propose_meeting";
    } else if (text.includes("email") || text.includes("correo")) {
      intent = "email";
      actionType = "propose_email";
    } else if (text.includes("tarea") || text.includes("pendiente")) {
      intent = "task";
      actionType = "create_task_proposal";
    } else if (text.includes("documento") || text.includes("pdf") || text.includes("archivo")) {
      intent = "document";
      actionType = "review_document";
    }

    return {
      originalMessage: message,
      intent,
      urgency,
      actionType,
      requiresApproval: actionType !== "inform",
      status: "ANALYZED"
    };
  }
}

module.exports = IntentAnalyzer;