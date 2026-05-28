const analyzeAsCEO = require("./ceoAgent");
const analyzeRisk = require("./riskAgent");
const analyzeMarketing = require("./marketingAgent");
const analyzeFinance = require("./financeAgent");


function runAgents(simulation) {

  return {
    agents: [
      analyzeAsCEO(simulation),
      analyzeRisk(simulation),
      analyzeMarketing(simulation),
      analyzeFinance(simulation)
    ]
  };

}

module.exports = runAgents;