// OXKIO MULTIAGENT SYSTEM V1

const AgentRegistry = require("./base/agentRegistry");
const SupervisorAgent = require("./executive/supervisorAgent");
const EmailAgent = require("./emailAgent");

const MCPToolsRegistry = require("../mcp/mcpToolsRegistry");
const defaultTools = require("../mcp/defaultTools");
const ToolExecutor = require("../mcp/toolExecutor");
const MemoryAgent = require("./tools/memoryAgent");

const CalendarAgent = require("./tools/calendarAgent");

function createAgentSystem() {
  const registry = new AgentRegistry();

  const toolsRegistry = new MCPToolsRegistry();
  defaultTools.forEach(tool => toolsRegistry.register(tool));

  const toolExecutor = new ToolExecutor(toolsRegistry);

  const emailAgent = new EmailAgent();
  const memoryAgent = new MemoryAgent(toolExecutor);

const calendarAgent = new CalendarAgent(toolExecutor);

  registry.register(emailAgent);
  registry.register(memoryAgent);
registry.register(calendarAgent);

  const supervisorAgent = new SupervisorAgent(registry);

  return {
    registry,
    toolsRegistry,
    toolExecutor,
    supervisorAgent,
    agents: {
  emailAgent,
  memoryAgent,
  calendarAgent
},
    status: supervisorAgent.getStatus(),
    listAgents: () => supervisorAgent.listAgents(),
    listTools: () => toolsRegistry.getNames()
  };
}

module.exports = createAgentSystem;