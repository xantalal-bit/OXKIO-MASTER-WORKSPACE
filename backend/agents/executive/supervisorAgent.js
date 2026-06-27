// OXKIO SUPERVISOR AGENT V2

const { readGovernanceSummary } = require("../../governance/governanceReader");
const executiveAgenda = require("../../executive/executiveAgenda");

class SupervisorAgent {

  constructor(registry) {
    this.name = "SupervisorAgent";
    this.version = "2.0";
    this.registry = registry;
    executiveAgenda.initializeAgendaFromGovernance();
  }

  getGovernance() {
    return readGovernanceSummary();
  }

  getCurrentPriority() {
    const governance = this.getGovernance();
    const priorities = Array.isArray(governance.priorities) ? governance.priorities : [];

    return priorities.find((priority) => Number(priority.priority) === 1) || null;
  }

  getProducts() {
    const governance = this.getGovernance();

    return Array.isArray(governance.products) ? governance.products : [];
  }

  getGovernanceStatus() {
    const governance = this.getGovernance();
    const agents = Array.isArray(governance.agents) ? governance.agents : [];
    const products = Array.isArray(governance.products) ? governance.products : [];
    const decisions = Array.isArray(governance.decisions) ? governance.decisions : [];

    return {
      ecosystem: governance.ecosystem,
      version: governance.version,
      owner: governance.owner,
      loadedAt: governance.loadedAt,
      totalAgents: agents.length,
      totalProducts: products.length,
      totalDecisions: decisions.length
    };
  }

  getStrategicAgenda() {
    return executiveAgenda.listInitiatives();
  }

  getCurrentFocus() {
    return executiveAgenda.getCurrentFocus();
  }

  recommendNextInitiative() {
    const governance = this.getGovernance();
    const priorities = Array.isArray(governance.priorities) ? governance.priorities : [];

    return executiveAgenda.getNextRecommendedInitiative(priorities);
  }

  getStatus() {
    const governance = this.getGovernance();

    return {
      name: this.name,
      version: this.version,
      managedAgents: this.registry.getAll().length,
      governanceVersion: governance.version,
      owner: governance.owner,
      priority1: this.getCurrentPriority()
    };
  }

  listAgents() {
    return this.registry.getStatus();
  }

}

module.exports = SupervisorAgent;
