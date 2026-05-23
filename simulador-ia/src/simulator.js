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

function exportSimulation(data) {

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
  data
};

fs.writeFileSync(
  exportPath,
  JSON.stringify(exportData, null, 2)
);

  console.log("Simulación exportada:");
  console.log(exportPath);
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

  console.log(result);

  exportSimulation(result);

} else {

  console.log({
    error: "No se pudo detectar un escenario válido"
  });

}

}
