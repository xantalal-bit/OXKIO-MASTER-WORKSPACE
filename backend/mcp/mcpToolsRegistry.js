// OXKIO MCP TOOLS REGISTRY V1

class MCPToolsRegistry {

  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    this.tools.set(tool.name, tool);

    console.log(`Tool registrada: ${tool.name}`);
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  getNames() {
    return this.getAll().map(tool => tool.name);
  }

}

module.exports = MCPToolsRegistry;