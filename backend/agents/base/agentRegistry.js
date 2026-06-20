// OXKIO AGENT REGISTRY V1

class AgentRegistry {

  constructor() {
    this.agents = new Map();
  }

  register(agent) {
    this.agents.set(agent.name, agent);
    console.log(`Agente registrado: ${agent.name}`);
  }

  get(name) {
    return this.agents.get(name);
  }

  getAll() {
    return Array.from(this.agents.values());
  }

  getStatus() {
    return this.getAll().map(agent => {
      if (typeof agent.getStatus === "function") {
        return agent.getStatus();
      }

      return {
        name: agent.name || "Unknown",
        status: "UNKNOWN"
      };
    });
  }

}

module.exports = AgentRegistry;