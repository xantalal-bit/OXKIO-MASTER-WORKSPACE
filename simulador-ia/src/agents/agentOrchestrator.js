const analyzeAsCEO = require("./ceoAgent");
const analyzeRisk = require("./riskAgent");

function runAgents(simulation) {

  return {
    agents: [
      analyzeAsCEO(simulation),
      analyzeRisk(simulation)
    ]
  };
}

module.exports = runAgents;