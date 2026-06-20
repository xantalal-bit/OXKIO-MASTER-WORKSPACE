// OXKIO SUPERVISOR AGENT V1

class SupervisorAgent {

  constructor(registry) {
    this.name = "SupervisorAgent";
    this.version = "1.0";
    this.registry = registry;
  }

  getStatus() {
    return {
      name: this.name,
      version: this.version,
      managedAgents: this.registry.getAll().length
    };
  }

  listAgents() {
    return this.registry.getStatus();
  }

}

module.exports = SupervisorAgent;