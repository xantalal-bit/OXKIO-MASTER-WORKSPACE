const { buildExecutiveContext } = require("../dashboard/executive-context");
const { buildExecutiveBriefing } = require("./executive-briefing");

async function buildExecutiveState({ executiveBrain, dashboardState }) {
  const executiveContext = buildExecutiveContext(dashboardState);
  const executiveBriefing = await buildExecutiveBriefing({
    executiveBrain,
    executiveContext
  });

  return {
    executiveContext,
    executiveBriefing
  };
}

module.exports = {
  buildExecutiveState
};
