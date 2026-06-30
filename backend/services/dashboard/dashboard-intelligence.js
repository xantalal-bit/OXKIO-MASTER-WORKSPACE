const { getGreeting } = require("./providers/greeting-provider");
const { getExecutiveStatus } = require("./providers/executive-status-provider");
const { getAgenda } = require("./providers/agenda-provider");
const { getGmail } = require("./providers/gmail-provider");
const { getMemory } = require("./providers/memory-provider");
const { getAutomations } = require("./providers/automations-provider");
const { buildExecutiveSummary } = require("./executive-summary-builder");
const OxkioSystem = require("../../core/system");
const IntentAnalyzer = require("../../core/intentAnalyzer");
const RuleEngine = require("../../core/ruleEngine");
const ExecutiveBrain = require("../../core/executiveBrain");
const { buildExecutiveState } = require("../executive/executive-orchestrator");

let executiveBrainInstance = null;

function getExecutiveBrain() {
  if (!executiveBrainInstance) {
    const system = new OxkioSystem();
    system.boot();

    executiveBrainInstance = new ExecutiveBrain(
      system.memory,
      new IntentAnalyzer(),
      new RuleEngine()
    );
  }

  return executiveBrainInstance;
}

async function getDashboardState() {
  const timestamp = new Date().toISOString();
  const [
    greeting,
    executiveStatus,
    agenda,
    gmail,
    memory,
    automations
  ] = await Promise.all([
    getGreeting(timestamp),
    getExecutiveStatus(timestamp),
    getAgenda(timestamp),
    getGmail(timestamp),
    getMemory(timestamp),
    getAutomations(timestamp)
  ]);

  const dashboardState = {
    greeting,
    executiveStatus,
    agenda,
    gmail,
    memory,
    automations
  };
  const executiveSummary = buildExecutiveSummary(dashboardState);
  const dashboardStateWithSummary = {
    ...dashboardState,
    executiveSummary
  };
  const { executiveBriefing } = await buildExecutiveState({
    executiveBrain: getExecutiveBrain(),
    dashboardState: dashboardStateWithSummary
  });

  return {
    ...dashboardStateWithSummary,
    executiveBriefing
  };
}

module.exports = {
  getDashboardState
};
