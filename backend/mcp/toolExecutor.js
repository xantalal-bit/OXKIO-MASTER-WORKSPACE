// OXKIO MCP TOOL EXECUTOR V1

class ToolExecutor {

  constructor(toolsRegistry) {
    this.toolsRegistry = toolsRegistry;
  }

  execute(toolName, payload = {}) {
    const tool = this.toolsRegistry.get(toolName);

    if (!tool) {
      return {
        ok: false,
        error: `Tool no encontrada: ${toolName}`
      };
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