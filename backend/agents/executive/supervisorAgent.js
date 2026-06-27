// OXKIO SUPERVISOR AGENT V2

const { readGovernanceSummary } = require("../../governance/governanceReader");
const executiveAgenda = require("../../executive/executiveAgenda");
const policyEngine = require("../../governance/policyEngine");
const { ExecutiveStrategicMemory } = require("../../executive/strategicMemory");
const { KnowledgeScheduler } = require("../../knowledge/knowledgeScheduler");
const { KnowledgeAcquisitionEngine } = require("../../knowledge/knowledgeAcquisitionEngine");
const ProjectFolderConnector = require("../../knowledge/connectors/projectFolderConnector");
const { ProjectRegistry } = require("../../projects/projectRegistry");
const { SecurityInventory } = require("../../security/securityInventory");

class SupervisorAgent {

  constructor(registry) {
    this.name = "SupervisorAgent";
    this.version = "2.0";
    this.registry = registry;
    this.strategicMemory = new ExecutiveStrategicMemory();
    this.knowledgeScheduler = new KnowledgeScheduler();
    this.knowledgeAcquisitionEngine = new KnowledgeAcquisitionEngine();
    this.projectRegistry = new ProjectRegistry();
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

  registerDefaultKnowledgeSources(config) {
    return this.knowledgeAcquisitionEngine.registerDefaultConnectors(config);
  }

  runKnowledgeAcquisition() {
    return this.knowledgeAcquisitionEngine.runAll();
  }

  getKnowledgeAcquisitionStatus() {
    return this.knowledgeAcquisitionEngine.getStatus();
  }

  registerProject(project) {
    return this.projectRegistry.registerProject(project);
  }

  listRegisteredProjects() {
    return this.projectRegistry.listProjects();
  }

  getRegisteredProject(name) {
    return this.projectRegistry.getProject(name);
  }

  updateRegisteredProject(name, data) {
    return this.projectRegistry.updateProject(name, data);
  }

  removeRegisteredProject(name) {
    return this.projectRegistry.removeProject(name);
  }

  getProjectRegistryStatus() {
    return this.projectRegistry.getStatus();
  }

  prepareProjectLearning(input) {
    const data = input || {};

    if (!data.projectName) {
      return {
        ok: false,
        error: "projectName is required.",
        requiresApproval: false
      };
    }

    if (!data.projectPath) {
      return {
        ok: false,
        error: "projectPath is required.",
        requiresApproval: false
      };
    }

    return {
      ok: true,
      requiresApproval: true,
      action: "learn_project",
      projectName: data.projectName,
      projectPath: data.projectPath,
      preparedAt: new Date().toISOString()
    };
  }

  prepareRegisteredProjectLearning(projectName) {
    const project = this.getRegisteredProject(projectName);

    if (!project) {
      return {
        ok: false,
        error: "Project not found.",
        requiresApproval: false
      };
    }

    if (!project.path) {
      return {
        ok: false,
        error: "Project path is not configured.",
        requiresApproval: false
      };
    }

    return this.prepareProjectLearning({
      projectName: project.name,
      projectPath: project.path
    });
  }

  prepareMultipleProjectLearning(projects) {
    const items = Array.isArray(projects) ? projects : [];
    const proposals = items.map((project) => this.prepareProjectLearning(project));
    const preparedProjects = proposals.filter((proposal) => proposal.ok === true);
    const rejectedProjects = proposals.filter((proposal) => proposal.ok !== true);

    return {
      ok: rejectedProjects.length === 0,
      totalProjects: items.length,
      preparedProjects: preparedProjects.length,
      rejectedProjects: rejectedProjects.length,
      proposals,
      preparedAt: new Date().toISOString()
    };
  }

  detectProjectsToLearn(projects) {
    let projectList = projects;

    if (typeof projectList === "undefined") {
      projectList = this.listRegisteredProjects().map((product) => {
        return {
          projectName: product.name,
          projectPath: product.path || null,
          enabled: true
        };
      });
    }

    if (!Array.isArray(projectList)) {
      return {
        ok: false,
        totalProjects: 0,
        candidates: 0,
        rejectedProjects: 0,
        hasRejections: false,
        rejectedProjectsList: [],
        proposals: [],
        error: "projects must be an array.",
        detectedAt: new Date().toISOString()
      };
    }

    const disabledProjects = projectList
      .filter((project) => {
        return !project || project.enabled === false;
      })
      .map((project) => {
        return {
          projectName: project && project.projectName ? project.projectName : null,
          projectPath: project && project.projectPath ? project.projectPath : null,
          reason: "Project disabled."
        };
      });
    const enabledProjects = projectList.filter((project) => {
      return project && project.enabled !== false;
    });
    const prepared = this.prepareMultipleProjectLearning(enabledProjects);
    const invalidProjects = prepared.proposals
      .map((proposal, index) => ({ proposal, index }))
      .filter((item) => item.proposal.ok !== true)
      .map((item) => {
        const project = enabledProjects[item.index] || {};

        return {
          projectName: project.projectName || null,
          projectPath: project.projectPath || null,
          reason: item.proposal.error || "Invalid project."
        };
      });
    const rejectedProjectsList = disabledProjects.concat(invalidProjects);

    return {
      ok: prepared.preparedProjects > 0,
      totalProjects: projectList.length,
      candidates: prepared.preparedProjects,
      rejectedProjects: rejectedProjectsList.length,
      hasRejections: rejectedProjectsList.length > 0,
      rejectedProjectsList,
      proposals: prepared.proposals,
      detectedAt: new Date().toISOString()
    };
  }

  learnProject(projectName, projectPath) {
    if (!projectName || !projectPath) {
      return {
        ok: false,
        projectName: projectName || null,
        projectPath: projectPath || null,
        error: "projectName and projectPath are required.",
        learnedAt: new Date().toISOString()
      };
    }

    const connector = new ProjectFolderConnector({
      projectPath
    });

    this.knowledgeAcquisitionEngine.registerConnector(connector);

    return {
      ok: true,
      projectName,
      projectPath,
      result: this.knowledgeAcquisitionEngine.runConnector("ProjectFolderConnector"),
      learnedAt: new Date().toISOString()
    };
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
