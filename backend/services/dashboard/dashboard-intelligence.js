const { getGreeting } = require("./providers/greeting-provider");
const { getExecutiveStatus } = require("./providers/executive-status-provider");
const { getAgenda } = require("./providers/agenda-provider");
const { getGmail } = require("./providers/gmail-provider");
const { getMemory } = require("./providers/memory-provider");
const { getAutomations } = require("./providers/automations-provider");
const { buildExecutiveSummary } = require("./executive-summary-builder");
const { buildExecutiveState } = require("../executive/executive-orchestrator");
const { buildMorningBriefing } = require("../executive/morning-briefing");
const { discoverKnowledge } = require("../knowledge/discovery-engine");
const { getExecutiveBrain } = require("../../runtime/executive-runtime");

async function getDashboardState(options = {}) {
  const timestamp = new Date().toISOString();
  const [
    greeting,
    agenda,
    gmail,
    memory,
    automations
  ] = await Promise.all([
    getGreeting(timestamp),
    getAgenda(timestamp),
    getGmail(timestamp),
    getMemory(timestamp),
    getAutomations(timestamp, options.approvalQueue)
  ]);
  const executiveStatus = getExecutiveStatus({
    operational: true,
    sources: [agenda, gmail, memory, automations]
  });

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
  const knowledgeInventory = discoverKnowledge();
  const dashboardStateWithIntelligence = {
    ...dashboardStateWithSummary,
    executiveBriefing,
    knowledgeInventory
  };
  const morningBriefing = buildMorningBriefing(dashboardStateWithIntelligence);

  return {
    ...dashboardStateWithIntelligence,
    morningBriefing
  };
}

module.exports = {
  getDashboardState
};
