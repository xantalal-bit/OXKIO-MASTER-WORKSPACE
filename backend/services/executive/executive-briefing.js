async function buildExecutiveBriefing({ executiveBrain, executiveContext }) {
  if (!executiveBrain || typeof executiveBrain.think !== "function") {
    throw new Error("ExecutiveBrain invalido");
  }

  const brainResult = await executiveBrain.think("", executiveContext);

  return {
    executiveResponse: brainResult.executiveResponse,
    executiveMission: brainResult.executiveMission,
    executivePlan: brainResult.executivePlan
  };
}

module.exports = {
  buildExecutiveBriefing
};
