// OXKIO ORCHESTRATOR V2
// Coordinador principal de agentes

class OxkioOrchestrator {

  constructor() {

    this.agents = [];

    this.activeWorkflows = [];

  }

  registerAgent(agent) {

    this.agents.push(agent);

    console.log("Agente registrado:", agent.name);

  }

  startWorkflow(workflow) {

    this.activeWorkflows.push(workflow);

    console.log("Workflow iniciado:", workflow.name);

  }

  getSystemOverview() {

    return {

      agents: this.agents.length,

      workflows: this.activeWorkflows.length

    };

  }

}

module.exports = OxkioOrchestrator;