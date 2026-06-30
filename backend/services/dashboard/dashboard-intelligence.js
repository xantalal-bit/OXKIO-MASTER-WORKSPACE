const { getGreeting } = require("./providers/greeting-provider");
const { getExecutiveStatus } = require("./providers/executive-status-provider");
const { getAgenda } = require("./providers/agenda-provider");
const { getGmail } = require("./providers/gmail-provider");
const { getMemory } = require("./providers/memory-provider");
const { getAutomations } = require("./providers/automations-provider");
const { buildExecutiveSummary } = require("./executive-summary-builder");

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

  return {
    ...dashboardState,
    executiveSummary: buildExecutiveSummary(dashboardState)
  };
}

module.exports = {
  getDashboardState
};
