// OXKIO SUPERVISOR AGENT V2

const { readGovernanceSummary } = require("../../governance/governanceReader");
const executiveAgenda = require("../../executive/executiveAgenda");
const policyEngine = require("../../governance/policyEngine");
const { ExecutiveStrategicMemory } = require("../../executive/strategicMemory");
const { KnowledgeScheduler } = require("../../knowledge/knowledgeScheduler");
const { SecurityInventory } = require("../../security/securityInventory");

class SupervisorAgent {

  constructor(registry) {
    this.name = "SupervisorAgent";
    this.version = "2.0";
    this.registry = registry;
    this.strategicMemory = new ExecutiveStrategicMemory();
    this.knowledgeScheduler = new KnowledgeScheduler();
    this.securityInventory = new SecurityInventory();
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

  validateDecision(context) {
    return policyEngine.validateDecision(context);
  }

  getStrategicMemory() {
    return this.strategicMemory.listAll();
  }

  searchStrategicMemory(query) {
    return this.strategicMemory.search(query);
  }

  addStrategicDecision(input) {
    return this.strategicMemory.addDecision(input);
  }

  addStrategicLaw(input) {
    return this.strategicMemory.addLaw(input);
  }

  addStrategicMilestone(input) {
    return this.strategicMemory.addMilestone(input);
  }

  addStrategicArchitectureNote(input) {
    return this.strategicMemory.addArchitectureNote(input);
  }

  registerKnowledgePipeline(name, pipeline) {
    return this.knowledgeScheduler.registerPipeline(name, pipeline);
  }

  runKnowledgePipeline(name) {
    return this.knowledgeScheduler.run(name);
  }

  runAllKnowledgePipelines() {
    return this.knowledgeScheduler.runAll();
  }

  getKnowledgeSchedulerStatus() {
    return this.knowledgeScheduler.getStatus();
  }

  addSecurityAsset(asset) {
    return this.securityInventory.addAsset(asset);
  }

  listSecurityAssets() {
    return this.securityInventory.listAssets();
  }

  searchSecurityAssets(query) {
    return this.securityInventory.searchAssets(query);
  }

  getSecurityStatus() {
    return this.securityInventory.getStatus();
  }

  getHighRiskSecurityAssets() {
    return this.securityInventory.getHighRiskAssets();
  }

}

module.exports = SupervisorAgent;
