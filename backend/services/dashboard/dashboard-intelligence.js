const { getGreeting } = require("./providers/greeting-provider");
const { getExecutiveStatus } = require("./providers/executive-status-provider");
const { getAgenda } = require("./providers/agenda-provider");
const { getGmail } = require("./providers/gmail-provider");
const { getMemory } = require("./providers/memory-provider");
const { getAutomations } = require("./providers/automations-provider");
const { buildExecutiveSummary } = require("./executive-summary-builder");

function getDashboardState() {
  const timestamp = new Date().toISOString();

  const dashboardState = {
    greeting: getGreeting(timestamp),
    executiveStatus: getExecutiveStatus(timestamp),
    agenda: getAgenda(timestamp),
    gmail: getGmail(timestamp),
    memory: getMemory(timestamp),
    automations: getAutomations(timestamp)
  };

  return {
    ...dashboardState,
    executiveSummary: buildExecutiveSummary(dashboardState)
  };
}

module.exports = {
  getDashboardState
};
