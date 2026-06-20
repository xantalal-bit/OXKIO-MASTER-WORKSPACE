// OXKIO MCP TOOL EXECUTOR V1

const GmailToolBridge = require("./gmailToolBridge");

class ToolExecutor {

  constructor(toolsRegistry) {
    this.toolsRegistry = toolsRegistry;
    this.gmailToolBridge = new GmailToolBridge();
  }

  async execute(toolName, payload = {}) {
    const tool = this.toolsRegistry.get(toolName);

    if (!tool) {
      return {
        ok: false,
        error: `Tool no encontrada: ${toolName}`
      };
    }

    if (toolName === "gmail.draft") {
      if (!payload.approved) {
        return {
          ok: false,
          requiresApproval: true,
          tool: tool.name,
          status: tool.status,
          message: "Gmail draft requiere aprobación antes de crear borrador real.",
          payload
        };
      }

      return await this.gmailToolBridge.createDraft(payload);
    }

    if (tool.requiresApproval) {
      return {
        ok: false,
        requiresApproval: true,
        tool: tool.name,
        status: tool.status,
        message: "Esta herramienta requiere aprobación supervisada antes de ejecutarse.",
        payload
      };
    }

    return {
      ok: true,
      tool: tool.name,
      status: tool.status,
      message: "Tool ejecutada en modo seguro simulado.",
      payload
    };
  }

}

module.exports = ToolExecutor;