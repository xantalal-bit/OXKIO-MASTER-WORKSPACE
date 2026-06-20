// OXKIO MULTIAGENT SYSTEM V1

const AgentRegistry = require("./base/agentRegistry");
const SupervisorAgent = require("./executive/supervisorAgent");
const EmailAgent = require("./emailAgent");

function createAgentSystem() {
  const registry = new AgentRegistry();

  const emailAgent = new EmailAgent();
  registry.register(emailAgent);

  const supervisorAgent = new SupervisorAgent(registry);

  return {
    registry,
    supervisorAgent,
    agents: {
      emailAgent
    },
    status: supervisorAgent.getStatus(),
    listAgents: () => supervisorAgent.listAgents()
  };
}

module.exports = createAgentSystem;