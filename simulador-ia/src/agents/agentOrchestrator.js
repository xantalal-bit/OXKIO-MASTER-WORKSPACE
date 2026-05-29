const analyzeAsCEO = require("./ceoAgent");
const analyzeRisk = require("./riskAgent");
const analyzeMarketing = require("./marketingAgent");
const analyzeFinance = require("./financeAgent");

async function runAgents(
  simulation,
  prompt
) {

  return {

    agents: [

      await analyzeAsCEO(
        simulation,
        prompt
      ),

      analyzeRisk(simulation),

      analyzeMarketing(simulation),

      analyzeFinance(simulation)

    ]

  };

}

module.exports = runAgents;