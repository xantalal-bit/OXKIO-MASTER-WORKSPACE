const scenarios = require("./scenarios");
const fs = require("fs");
const path = require("path");

function detectScenario(text) {

  const input = text.toLowerCase();

  if (
    input.includes("restaurante") ||
    input.includes("restaurant")
  ) {
    return "restaurant";
  }

  if (
    input.includes("tienda") ||
    input.includes("ecommerce")
  ) {
    return "ecommerce";
  }

  if (
    input.includes("saas") ||
    input.includes("software")
  ) {
    return "saas";
  }

  return null;
}

function exportSimulation(data, originalPrompt) {

  const fileName =
    `simulation-${Date.now()}.json`;

  const exportPath = path.join(
    __dirname,
    "..",
    "exports",
    fileName
  );

  const exportData = {
  simulationId: Date.now(),
  createdAt: new Date().toISOString(),
  simulatorVersion: "0.1.0",
  originalPrompt,
  detectedScenario: data.project,
  data
};

fs.writeFileSync(
  exportPath,
  JSON.stringify(exportData, null, 2),
  "utf8"
);
}

function simulateBusiness(type) {

  const scenario = scenarios[type];

  if (!scenario) {
    return {
      error: "Escenario no encontrado"
    };
  }

  return {
    project: type,
    estimatedInvestment: scenario.investment,
    difficulty: scenario.difficulty,
    risk: scenario.risk,
    estimatedTime: scenario.time,
    recommendedStrategies: scenario.strategies,

viabilityScore: scenario.viabilityScore,
riskScore: scenario.riskScore,
scalabilityScore: scenario.scalabilityScore,

conclusion:
  "Proyecto viable con planificación y supervisión adecuada."
  };
}

const userInput = process.argv[2];
const detectedScenario = detectScenario(userInput || "");

if (!userInput) {
  console.log("Debes indicar un tipo de simulación.");
} else {
  if (detectedScenario) {

  const result =
    simulateBusiness(detectedScenario);

 console.log("\n===== SIMULACIÓN IA =====\n");

console.log("Proyecto:", result.project);

console.log(
  "Inversión estimada:",
  result.estimatedInvestment
);

console.log(
  "\nViabilidad:",
  result.viabilityScore + "/100"
);

console.log(
  "Riesgo estratégico:",
  result.riskScore + "/100"
);

console.log(
  "Escalabilidad:",
  result.scalabilityScore + "/100"
);

console.log(
  "Dificultad:",
  result.difficulty
);

console.log(
  "Riesgo:",
  result.risk
);

console.log(
  "Tiempo estimado:",
  result.estimatedTime
);

console.log("\nEstrategias:");

result.recommendedStrategies.forEach(
  strategy => {
    console.log("-", strategy);
  }
);

console.log(
  "\nConclusión:",
  result.conclusion
);

console.log("\n=========================\n");

  exportSimulation(result, userInput);

} else {

  console.log({
    error: "No se pudo detectar un escenario válido"
  });

}

}
