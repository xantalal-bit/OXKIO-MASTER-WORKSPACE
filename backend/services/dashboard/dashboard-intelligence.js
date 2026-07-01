const { getGreeting } = require("./providers/greeting-provider");
const { getExecutiveStatus } = require("./providers/executive-status-provider");
const { getAgenda } = require("./providers/agenda-provider");
const { getGmail } = require("./providers/gmail-provider");
const { getMemory } = require("./providers/memory-provider");
const { getAutomations } = require("./providers/automations-provider");
const { buildExecutiveSummary } = require("./executive-summary-builder");
const { buildExecutiveState } = require("../executive/executive-orchestrator");
const { discoverTopLevelFolders } = require("../knowledge/connectors/onedrive-connector");
const { discoverAndRecognizeFolders } = require("../knowledge/discovery-engine");
const { buildKnowledgeInventory } = require("../knowledge/knowledge-inventory");
const { getExecutiveBrain } = require("../../runtime/executive-runtime");

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
  const folders = discoverTopLevelFolders().folders;
  const discoveryResult = discoverAndRecognizeFolders(folders);
  const knowledgeInventory = buildKnowledgeInventory(discoveryResult);

  return {
    ...dashboardStateWithSummary,
    executiveBriefing,
    knowledgeInventory
  };
}

module.exports = {
  getDashboardState
};
