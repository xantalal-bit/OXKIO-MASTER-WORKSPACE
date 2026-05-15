// OXKIO EMAIL AGENT V1
// Agente especializado en correo ejecutivo

class EmailAgent {

  constructor() {
    this.name = "EmailAgent";
    this.version = "1.0";
    this.status = "READY";
    this.permissions = {
      readEmails: false,
      draftReplies: false,
      sendEmails: false
    };
  }

  analyzeEmail(email) {
    return {
      subject: email.subject || "",
      from: email.from || "",
      priority: this.detectPriority(email),
      summary: this.summarize(email),
      suggestedAction: this.suggestAction(email)
    };
  }

  detectPriority(email) {
    const text = `${email.subject || ""} ${email.body || ""}`.toLowerCase();

    if (text.includes("urgente") || text.includes("importante")) {
      return "HIGH";
    }

    if (text.includes("reunión") || text.includes("factura") || text.includes("contrato")) {
      return "MEDIUM";
    }

    return "LOW";
  }

  summarize(email) {
    return `Correo de ${email.from || "desconocido"} sobre: ${email.subject || "sin asunto"}`;
  }

  suggestAction(email) {
    const priority = this.detectPriority(email);

    if (priority === "HIGH") {
      return "Revisar y responder hoy";
    }

    if (priority === "MEDIUM") {
      return "Programar revisión";
    }

    return "Archivar o revisar más tarde";
  }
  generateReplyProposal(email) {
    const priority = this.detectPriority(email);

    if (priority === "HIGH") {
      return {
        tone: "directo y prioritario",
        draft: "Gracias por tu mensaje. Lo reviso con prioridad y te respondo lo antes posible.",
        requiresApproval: true
      };
    }

    if (priority === "MEDIUM") {
      return {
        tone: "profesional",
        draft: "Gracias por la información. Lo reviso y te confirmo próximos pasos.",
        requiresApproval: true
      };
    }

    return {
      tone: "breve",
      draft: "Recibido, gracias. Lo reviso cuando sea posible.",
      requiresApproval: true
    };
  }
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      status: this.status,
      permissions: this.permissions
    };
  }

}

module.exports = EmailAgent;