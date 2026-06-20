// OXKIO GMAIL TOOL BRIDGE V1

const ActionExecutor = require("../core/actionExecutor");

class GmailToolBridge {

  constructor() {
    this.actionExecutor = new ActionExecutor();
  }

  async createDraft(payload = {}) {
    const approvalItem = {
      id: payload.approvalId || "mcp-gmail-draft-test",
      status: "approved",
      proposal: {
        type: "email_draft",
        to: payload.to || "",
        subject: payload.subject || "Borrador Oxkio",
        body: payload.body || "Borrador generado por Oxkio."
      }
    };

    return await this.actionExecutor.executeEmailDraft(
      approvalItem.proposal,
      approvalItem
    );
  }

}

module.exports = GmailToolBridge;